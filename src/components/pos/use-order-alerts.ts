"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useChannel } from "@/lib/realtime-client";
import { topic } from "@/lib/realtime-topics";
import { playChime, unlockChime } from "@/lib/chime";
import { formatPkr } from "@/lib/money";

/** The shape GET /api/orders/activity returns — see src/server/order-activity.ts. */
interface Activity {
  now: string;
  newOrders: {
    id: string;
    orderNumber: number;
    type: string;
    source: string;
    tableLabel: string | null;
    totalPaisa: number;
    itemCount: number;
    createdById: string | null;
    createdByName: string | null;
  }[];
  itemsAdded: {
    eventId: string;
    orderId: string;
    orderNumber: number;
    tableLabel: string | null;
    itemCount: number;
    addedById: string | null;
    addedByName: string | null;
  }[];
  readyOrders: {
    id: string;
    orderNumber: number;
    type: string;
    source: string;
    tableLabel: string | null;
    readyAt: string;
    createdById: string | null;
  }[];
  awaitingPayment: number;
}

/** Checked this often even when the live channel is quiet — in case it is down, not quiet. */
const POLL_MS = 15_000;

const TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
  SERVICE: "Service",
};

function where(o: { tableLabel: string | null; type: string }): string {
  return o.tableLabel ? `Table ${o.tableLabel}` : (TYPE_LABEL[o.type] ?? o.type);
}

function placedBy(o: { source: string; createdByName: string | null }): string {
  if (o.source === "ONLINE") return "online";
  if (o.source === "QR") return "QR code at the table";
  return o.createdByName ? `by ${o.createdByName}` : "";
}

/**
 * Tells the person at this till what they need to know about orders placed elsewhere:
 *
 * - Someone who takes payment hears about every new order, and every round added to a table, that
 *   they didn't punch themselves — a waiter's phone, an online order, a QR order.
 * - Whoever placed an order hears when the kitchen marks it ready. An online or QR order was placed
 *   by a customer, so its "ready" goes to the counter instead.
 *
 * Each is a pop-up with the order's number, where it is and who placed it, plus the chime if this
 * device has sound on. Nothing already shown is shown twice.
 *
 * The live channel says "something changed"; this then asks the server what, through the till's own
 * signed-in session — see /api/orders/activity. The timer covers the channel being down.
 */
export function useOrderAlerts({
  tenantId,
  branchId,
  userId,
  canTakePayment,
  soundOn,
  onOpenQueue,
  onActivity,
}: {
  tenantId: string;
  branchId: string;
  userId: string;
  /** Takes payment, so sees new orders and the count waiting to be paid. */
  canTakePayment: boolean;
  soundOn: boolean;
  onOpenQueue: () => void;
  /** Something changed — an open Order Queue should reload. */
  onActivity: () => void;
}): { awaitingPayment: number | null } {
  const [awaitingPayment, setAwaitingPayment] = useState<number | null>(null);
  const since = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const busy = useRef(false);
  const again = useRef(false);

  // The latest callbacks and settings, read at the moment an alert is shown.
  const latest = useRef({
    soundOn,
    onOpenQueue,
    onActivity,
    canTakePayment,
    userId,
  });
  useEffect(() => {
    latest.current = {
      soundOn,
      onOpenQueue,
      onActivity,
      canTakePayment,
      userId,
    };
  });

  const check = useCallback(async () => {
    // One look at a time; a message arriving mid-look earns exactly one more look afterwards.
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      do {
        again.current = false;
        await lookOnce();
      } while (again.current);
    } finally {
      busy.current = false;
    }

    async function lookOnce() {
      try {
        const url = since.current
          ? `/api/orders/activity?since=${encodeURIComponent(since.current)}`
          : "/api/orders/activity";
        const res = await fetch(url);
        if (!res.ok) return;
        const a = (await res.json()) as Activity;
        const firstLook = since.current === null;
        since.current = a.now;
        setAwaitingPayment(a.awaitingPayment);
        // The first look only sets the starting point: opening the till doesn't replay the morning.
        if (firstLook) return;

        const me = latest.current;
        let chime = false;
        let changed = false;
        const open = {
          label: "Open",
          onClick: () => latest.current.onOpenQueue(),
        };

        for (const o of a.newOrders) {
          const key = `new:${o.id}`;
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          changed = true;
          if (!me.canTakePayment || o.createdById === me.userId) continue;
          toast(`New order #${o.orderNumber}`, {
            description: [
              where(o),
              placedBy(o),
              `${o.itemCount} item${o.itemCount === 1 ? "" : "s"}`,
              formatPkr(o.totalPaisa),
            ]
              .filter(Boolean)
              .join(" · "),
            action: open,
            duration: 12_000,
          });
          chime = true;
        }

        for (const e of a.itemsAdded) {
          const key = `add:${e.eventId}`;
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          changed = true;
          if (!me.canTakePayment || e.addedById === me.userId) continue;
          toast(
            `${e.tableLabel ? `Table ${e.tableLabel}` : `Order #${e.orderNumber}`}: ${e.itemCount} more item${e.itemCount === 1 ? "" : "s"}`,
            {
              description: [`Order #${e.orderNumber}`, e.addedByName ? `added by ${e.addedByName}` : ""]
                .filter(Boolean)
                .join(" · "),
              action: open,
              duration: 10_000,
            },
          );
          chime = true;
        }

        for (const r of a.readyOrders) {
          // Keyed on when it became ready, so an order recalled and made ready again says so again.
          const key = `ready:${r.id}:${r.readyAt}`;
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          changed = true;
          const mine = r.createdById === me.userId;
          const customers = r.createdById === null && me.canTakePayment;
          if (!mine && !customers) continue;
          toast.success(`Order #${r.orderNumber} is ready`, {
            description: customers
              ? `${where(r)} · for the customer (${r.source === "QR" ? "QR order" : "online order"})`
              : where(r),
            duration: 15_000,
          });
          chime = true;
        }

        if (chime && me.soundOn) playChime();
        if (changed) me.onActivity();
      } catch {
        // Offline, or the server blinked: the next tick or message tries again.
      }
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await check();
    })();
    const timer = window.setInterval(() => void check(), POLL_MS);
    // Browsers only allow sound after a touch; the first tap on the till takes care of it.
    const unlock = () => unlockChime();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", unlock);
    };
  }, [check]);

  useChannel(topic(tenantId, branchId, "orders"), () => void check());

  return { awaitingPayment };
}
