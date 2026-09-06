import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { topic } from "@/lib/realtime-topics";

export { topic };

/**
 * Thin wrapper around Supabase Realtime so KDS/order-status/table-status updates feel instant.
 * Kept behind this one function so swapping to Pusher/Ably or a self-hosted socket.io later (see
 * the plan doc's realtime decision) only touches this file and its client-side counterpart,
 * src/lib/realtime-client.ts — nothing that calls publish()/topic() needs to change.
 *
 * Channels are namespaced per tenant+branch so a channel name alone can never leak data across
 * tenants even if a client guessed another channel's name; the actual authorization boundary is
 * that the browser client is only ever given its own tenant's Supabase anon key + RLS-protected
 * subscription (menu items, orders, etc. still flow through RLS on the realtime replication path).
 */
// Constructed on first use, not at import. supabase-js throws outright when the URL or key is
// undefined, and Next.js imports every server module during `next build` — where Vercel does not
// expose Sensitive env vars at all. Building is not running, so this is not needed until a request
// actually arrives. See the note in src/lib/env.ts.
let serviceClient: ReturnType<typeof createClient> | undefined;
function getServiceClient() {
  serviceClient ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return serviceClient;
}

/**
 * Every message goes out on the same wire-level broadcast event ("update") with a `type` field
 * inside the payload distinguishing what actually happened (e.g. "order_created", "item_ready") —
 * Supabase broadcast listeners match on an exact event name, not a wildcard, so a single fixed
 * event name is simpler than trying to register one listener per message type.
 */
export async function publish(
  tenantId: string,
  branchId: string,
  channel: "kds" | "orders" | "tables",
  type: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  const ch = getServiceClient().channel(topic(tenantId, branchId, channel));
  await ch.send({ type: "broadcast", event: "update", payload: { type, ...payload } });
}
