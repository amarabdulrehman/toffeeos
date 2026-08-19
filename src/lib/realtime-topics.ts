/** Pure topic-name formatting shared by the server publisher (src/server/realtime.ts) and the
 * client subscriber (src/lib/realtime-client.ts) — no "server-only", safe to import from either. */
export function topic(tenantId: string, branchId: string, channel: "kds" | "orders" | "tables"): string {
  return `tenant:${tenantId}:branch:${branchId}:${channel}`;
}
