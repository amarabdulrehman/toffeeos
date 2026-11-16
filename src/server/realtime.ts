import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { topic } from "@/lib/realtime-topics";

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
  // A live update is a nicety on top of an order that is already saved, and every screen also
  // polls. It must never hold up or fail the request that saved it. Unbounded, the library waited up
  // to 10 seconds per update when the realtime service didn't answer (as when the Supabase account
  // was over its quota in November 2026), and a payment sends several: a till could stall for half
  // a minute on every bill. So: a short limit, failures swallowed, and the channel let go after.
  const client = getServiceClient();
  const ch = client.channel(topic(tenantId, branchId, channel));
  try {
    await ch.send({ type: "broadcast", event: "update", payload: { type, ...payload } }, { timeout: PUBLISH_TIMEOUT_MS });
  } catch {
    // Nothing to do: the screens pick the change up on their next poll.
  } finally {
    void client.removeChannel(ch).catch(() => {});
  }
}

const PUBLISH_TIMEOUT_MS = 1_500;
