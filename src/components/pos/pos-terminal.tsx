"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProductGrid } from "./product-grid";
import { CartPanel } from "./cart-panel";
import { VariantDialog } from "./variant-dialog";
import { PaymentDialog } from "./payment-dialog";
import { OrderQueuePanel } from "./order-queue-panel";
import { TablesDialog, ResumedOrderPanel } from "./tables-dialog";
import { OfflineBanner } from "./offline-banner";
import { useSync } from "@/lib/offline/use-sync";
import { cacheMenu, cacheOpenOrders, getCachedMenu, getCachedOpenOrders, listQueue, type CreateOrderAction } from "@/lib/offline/db";
import { queueCreateOrder, queuePayOrder, queueVoidOrder } from "@/lib/offline/queue";
import { newOrderId } from "@/lib/ids";
import type {
  CartLine,
  CustomerDto,
  Discount,
  MenuCategoryDto,
  MenuItemDto,
  OrderDto,
  OrderType,
  PaymentMethod,
  PreviewTotals,
  RestaurantTableDto,
} from "./types";

/** True only when fetch never reached the server at all — the signal that tells the POS to queue
 * the action locally instead of surfacing it as a business error. */
function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine);
}

export function PosTerminal({
  tenantId,
  branchId,
  canTakePayment,
  canApplyDiscount,
  canVoid,
}: {
  tenantId: string;
  branchId: string;
  canTakePayment: boolean;
  canApplyDiscount: boolean;
  canVoid: boolean;
}) {
  const sync = useSync();
  const [categories, setCategories] = useState<MenuCategoryDto[]>([]);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("DINE_IN");
  const [table, setTable] = useState<RestaurantTableDto | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [tablesOpen, setTablesOpen] = useState(false);
  const [resumed, setResumed] = useState<{ table: RestaurantTableDto; order: OrderDto } | null>(null);
  const [totals, setTotals] = useState<PreviewTotals | null>(null);
  const [variantItem, setVariantItem] = useState<MenuItemDto | null>(null);
  const [sending, setSending] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [queue, setQueue] = useState<OrderDto[]>([]);
  const [payingOrder, setPayingOrder] = useState<OrderDto | null>(null);
  const [paying, setPaying] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const localOrderCounter = useRef(-1);

  useEffect(() => {
    fetch("/api/menu")
      .then((r) => r.json())
      .then((d) => {
        const cats = d.categories ?? [];
        setCategories(cats);
        cacheMenu(cats);
      })
      .catch(async () => {
        const cached = await getCachedMenu();
        if (cached) setCategories(cached);
        else toast.error("Could not load the menu.");
      });
  }, []);

  // Merges the server's order queue with any locally-queued-but-not-yet-synced orders, so a
  // cashier who punched an order while offline can see it (and pay it) immediately instead of
  // waiting for a reconnect. Falls back to the last cached queue entirely when the fetch itself
  // fails (device is offline right now).
  const loadQueue = useCallback(async () => {
    const localCreates = (await listQueue()).filter(
      (a): a is CreateOrderAction => a.type === "createOrder" && a.status !== "conflict" && a.status !== "failed"
    );
    const localOrders = localCreates.map((a) => a.localOrder);

    try {
      const res = await fetch("/api/orders");
      const data = await res.json();
      const serverOrders: OrderDto[] = data.orders ?? [];
      await cacheOpenOrders(serverOrders);
      const serverIds = new Set(serverOrders.map((o) => o.id));
      setQueue([...serverOrders, ...localOrders.filter((o) => !serverIds.has(o.id))]);
    } catch {
      const cached = (await getCachedOpenOrders()) ?? [];
      const cachedIds = new Set(cached.map((o) => o.id));
      setQueue([...cached, ...localOrders.filter((o) => !cachedIds.has(o.id))]);
    }
  }, []);

  useEffect(() => {
    if (!showQueue) return;
    (async () => {
      await loadQueue();
    })();
  }, [showQueue, loadQueue]);

  // Refresh the queue view right after every sync pass, so a just-synced local order picks up its
  // real server status instead of lingering as "still local."
  useEffect(() => {
    if (!showQueue || sync.isSyncing) return;
    (async () => {
      await loadQueue();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.isSyncing]);

  // Live totals: recompute from the pricing engine whenever the cart or order type changes.
  // (When the cart is empty we simply skip fetching — displayedTotals below hides stale totals
  // rather than the effect reaching back to clear state synchronously.)
  useEffect(() => {
    if (lines.length === 0) return;
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch("/api/orders/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          type: orderType,
          lines: lines.map((l) => ({ unitPricePaisa: l.unitPricePaisa, quantity: l.quantity, discount: l.discount })),
          orderDiscount: discount ?? undefined,
        }),
      })
        .then((r) => r.json())
        .then(setTotals)
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [lines, orderType, discount]);

  function addLine(item: MenuItemDto, variantId?: string) {
    const variant = variantId ? item.variants.find((v) => v.id === variantId) : undefined;
    const unitPricePaisa = item.basePricePaisa + (variant?.priceDeltaPaisa ?? 0);
    setLines((prev) => {
      const existing = prev.find((l) => l.menuItemId === item.id && l.variantId === variantId);
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          key: crypto.randomUUID(),
          menuItemId: item.id,
          name: variant ? `${item.name} (${variant.name})` : item.name,
          variantId,
          unitPricePaisa,
          quantity: 1,
        },
      ];
    });
  }

  function handleSelectItem(_categoryId: string, item: MenuItemDto) {
    if (item.variants.length > 0) {
      setVariantItem(item);
    } else {
      addLine(item);
    }
  }

  function handleQuantityChange(key: string, delta: number) {
    setLines((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  function resetCart() {
    setLines([]);
    setTotals(null);
    setTable(null);
    setDeliveryAddress("");
    setCustomer(null);
    setDiscount(null);
    idempotencyKey.current = crypto.randomUUID();
  }

  async function handleSendToKitchen() {
    if (orderType === "DINE_IN" && !table) {
      toast.error("Select a table for this dine-in order.");
      return;
    }
    setSending(true);
    // Minted once per submission and reused by both paths below (including queueOffline) —
    // critical if the online attempt actually reaches and is applied by the server but its
    // response is lost (a dropped connection mid-response, not "never sent"): falling back to the
    // offline queue with a *different* id/idempotencyKey would create a second, genuinely
    // duplicate order once the queue replays, since the server has no way to recognize the retry
    // as the same order.
    const orderId = newOrderId();
    const key = idempotencyKey.current;
    try {
      const body = {
        id: orderId,
        type: orderType,
        tableId: orderType === "DINE_IN" ? table?.id : undefined,
        customerId: customer?.id,
        lines: lines.map((l) => ({
          menuItemId: l.menuItemId,
          variantId: l.variantId,
          quantity: l.quantity,
          discount: l.discount,
        })),
        orderDiscount: discount ?? undefined,
        idempotencyKey: key,
        deliveryAddress: orderType === "DELIVERY" ? deliveryAddress.trim() || undefined : undefined,
      };

      if (!sync.isOnline) {
        await queueOffline();
        return;
      }

      try {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Could not create order.");
          return;
        }
        await fetch(`/api/orders/${data.order.id}/send-to-kitchen`, { method: "POST" });
        toast.success(`Order #${data.order.orderNumber} sent to kitchen.`);
        resetCart();
        if (showQueue) loadQueue();
      } catch (err) {
        if (!isNetworkFailure(err)) throw err;
        await queueOffline();
      }
    } finally {
      setSending(false);
    }

    async function queueOffline() {
      const localOrder = await queueCreateOrder({
        orderId,
        idempotencyKey: key,
        type: orderType,
        tableId: orderType === "DINE_IN" ? table?.id : undefined,
        customer,
        lines,
        orderDiscount: discount ?? undefined,
        totalPaisa: totals?.totalPaisa ?? lines.reduce((a, l) => a + l.unitPricePaisa * l.quantity, 0),
        localOrderNumber: localOrderCounter.current--,
        deliveryAddress: orderType === "DELIVERY" ? deliveryAddress.trim() || undefined : undefined,
      });
      toast.success(`Order queued offline — will sync when the connection returns.`);
      resetCart();
      if (showQueue) loadQueue();
      void localOrder;
    }
  }

  async function handleConfirmPayment(tenders: { method: PaymentMethod; amountPaisa: number }[]) {
    if (!payingOrder) return;
    setPaying(true);
    try {
      if (!sync.isOnline) {
        await queuePayOrder(payingOrder.id, tenders, payingOrder.version);
        toast.success(`Payment for order #${payingOrder.orderNumber} queued offline.`);
        setPayingOrder(null);
        setResumed(null);
        loadQueue();
        return;
      }

      try {
        const res = await fetch(`/api/orders/${payingOrder.id}/pay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenders }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Payment failed.");
          return;
        }
        toast.success(`Order #${payingOrder.orderNumber} paid.`);
        setPayingOrder(null);
        setResumed(null);
        loadQueue();
      } catch (err) {
        if (!isNetworkFailure(err)) throw err;
        await queuePayOrder(payingOrder.id, tenders, payingOrder.version);
        toast.success(`Payment for order #${payingOrder.orderNumber} queued offline.`);
        setPayingOrder(null);
        setResumed(null);
        loadQueue();
      }
    } finally {
      setPaying(false);
    }
  }

  async function handleVoidOrder(order: OrderDto) {
    const reason = window.prompt(`Reason for voiding order #${order.orderNumber}?`) ?? undefined;
    try {
      if (!sync.isOnline) {
        await queueVoidOrder(order.id, reason, order.version);
        toast.success(`Void for order #${order.orderNumber} queued offline.`);
        loadQueue();
        return;
      }
      const res = await fetch(`/api/orders/${order.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not void order.");
        return;
      }
      toast.success(`Order #${order.orderNumber} voided.`);
      loadQueue();
    } catch (err) {
      if (!isNetworkFailure(err)) {
        toast.error("Could not void order.");
        return;
      }
      await queueVoidOrder(order.id, reason, order.version);
      toast.success(`Void for order #${order.orderNumber} queued offline.`);
      loadQueue();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <OfflineBanner sync={sync} />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_340px]">
        <div className="relative min-h-0">
          <ProductGrid categories={categories} onSelectItem={handleSelectItem} />
          {canTakePayment && (
            <Button
              variant="outline"
              size="sm"
              className="absolute right-5 top-5 rounded-full border-none bg-card shadow-sm"
              onClick={() => setShowQueue((s) => !s)}
            >
              <ClipboardList className="size-4" />
              Order Queue
            </Button>
          )}
        </div>

        {resumed ? (
          <div className="border-l bg-muted/30 p-4">
            <ResumedOrderPanel
              table={resumed.table}
              order={resumed.order}
              onClose={() => setResumed(null)}
              onTakePayment={() => setPayingOrder(resumed.order)}
            />
          </div>
        ) : showQueue ? (
          <OrderQueuePanel
            orders={queue}
            onPay={(o) => setPayingOrder(o)}
            onVoid={handleVoidOrder}
            canVoid={canVoid}
            onClose={() => setShowQueue(false)}
          />
        ) : (
          <CartPanel
            orderType={orderType}
            onOrderTypeChange={setOrderType}
            tableLabel={table?.label}
            onOpenTables={() => setTablesOpen(true)}
            deliveryAddress={deliveryAddress}
            onDeliveryAddressChange={setDeliveryAddress}
            customer={customer}
            onSelectCustomer={setCustomer}
            onClearCustomer={() => setCustomer(null)}
            discount={discount}
            onApplyDiscount={setDiscount}
            onClearDiscount={() => setDiscount(null)}
            canApplyDiscount={canApplyDiscount}
            lines={lines}
            onQuantityChange={handleQuantityChange}
            onRemoveLine={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
            totals={lines.length === 0 ? null : totals}
            canTakePayment={canTakePayment}
            onSendToKitchen={handleSendToKitchen}
            onOpenPayment={() => setShowQueue(true)}
            sending={sending}
          />
        )}

        <TablesDialog
          open={tablesOpen}
          tenantId={tenantId}
          branchId={branchId}
          onClose={() => setTablesOpen(false)}
          onStartOrder={(t) => {
            setTable(t);
            setResumed(null);
            setTablesOpen(false);
          }}
          onResumeOrder={(t, order) => {
            setResumed({ table: t, order });
            setTablesOpen(false);
          }}
        />

        <VariantDialog
          item={variantItem}
          onClose={() => setVariantItem(null)}
          onPick={(variantId) => {
            if (variantItem) addLine(variantItem, variantId);
            setVariantItem(null);
          }}
        />

        <PaymentDialog
          key={payingOrder?.id ?? "closed"}
          open={!!payingOrder}
          totalPaisa={payingOrder?.totalPaisa ?? 0}
          onClose={() => setPayingOrder(null)}
          onConfirm={handleConfirmPayment}
          submitting={paying}
        />
      </div>
    </div>
  );
}
