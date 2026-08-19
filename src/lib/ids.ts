import { ulid } from "ulid";
import { randomUUID } from "node:crypto";

/**
 * Order and OrderLine IDs are ULIDs minted here rather than left to a DB default, specifically so
 * an offline POS tablet (Phase 4) can generate the real, final ID for an order before it has ever
 * talked to the server, and safely replay that order on reconnect — the ID already exists, so a
 * retry is naturally idempotent instead of creating a duplicate. ULIDs are also lexicographically
 * sortable by creation time, which is a free win for anything that lists orders by recency.
 */
export function newOrderId(): string {
  return `ord_${ulid()}`;
}

export function newOrderLineId(): string {
  return `oln_${ulid()}`;
}

/** Generic UUID for everything else (config rows, menu items, etc.) — no offline-replay need. */
export function newId(): string {
  return randomUUID();
}
