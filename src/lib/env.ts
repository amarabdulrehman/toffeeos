import { z } from "zod";

/**
 * Validates process.env once at import time so a missing/malformed env var fails fast and loud
 * at boot instead of surfacing as a confusing runtime error deep in a request handler.
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

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}\n\nCheck .env against .env.example.`);
  }
  return parsed.data;
}

export const env = loadEnv();
