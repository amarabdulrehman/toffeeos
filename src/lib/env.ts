import { z } from "zod";

/**
 * Validates process.env so a missing or malformed variable fails fast and loud rather than
 * surfacing as a confusing error deep inside a request handler.
 *
 * Validation is deliberately NOT done at import time. Next.js imports every route module during
 * `next build` to collect its config, and on Vercel the server secrets are marked Sensitive, which
 * makes them runtime-only — they genuinely do not exist during a build. Validating at import
 * therefore made compiling depend on credentials the build can never have, and the deploy failed
 * with all thirteen variables reported as `undefined`.
 *
 * Building is not running. A compile needs no database password. So:
 *   - during the production build phase, reads pass through unvalidated (nothing serves traffic,
 *     so nothing legitimately needs a real value);
 *   - everywhere else, the full schema is validated on first access and cached, which is still
 *     before the first request completes — the fail-fast guarantee is unchanged, it just happens
 *     at boot instead of at import.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  PLATFORM_DATABASE_URL: z.string().min(1),

  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.string().min(1).optional(),

  NEXT_PUBLIC_APP_URL: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Shared secret an external scheduler (Vercel Cron, cron-job.org, etc.) sends as
  // `Authorization: Bearer <secret>` to /api/cron/*. Optional — unset means those endpoints
  // reject every request rather than running unauthenticated.
  CRON_SECRET: z.string().min(1).optional(),

  // Optional — unset means src/server/email/adapter.ts falls back to its dev-stub (console.log)
  // instead of actually sending. Set both to activate real password-reset emails.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Next.js sets this for the duration of `next build`. It is the one context where these variables
 * are legitimately absent, because nothing is serving requests yet. */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}\n\nCheck .env against .env.example.`);
  }
  return parsed.data;
}

let cached: Env | undefined;

function resolve(): Env {
  if (cached) return cached;
  // Not cached during the build: a build-phase read must never poison the runtime value, since the
  // same module instance can be reused when the built server starts.
  if (isBuildPhase()) return process.env as unknown as Env;
  cached = loadEnv();
  return cached;
}

/**
 * Reads exactly like a plain object — `env.DATABASE_URL` — so no call site changes. The proxy only
 * defers *when* validation happens; it does not change what any consumer sees.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    return resolve()[prop as keyof Env];
  },
  has(_target, prop) {
    return prop in resolve();
  },
  ownKeys() {
    return Reflect.ownKeys(resolve());
  },
  getOwnPropertyDescriptor(_target, prop) {
    const value = resolve()[prop as keyof Env];
    return value === undefined ? undefined : { value, enumerable: true, configurable: true };
  },
});
