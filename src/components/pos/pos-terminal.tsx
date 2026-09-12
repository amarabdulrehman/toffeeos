"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProductGrid } from "./product-grid";
import { CartPanel } from "./cart-panel";
import { VariantDialog } from "./variant-dialog";
import { PaymentDialog } from "./payment-dialog";
import { ReceiptDialog } from "./receipt-dialog";
import { OrderQueuePanel } from "./order-queue-panel";
import { CancelOrderDialog } from "./cancel-order-dialog";
import { TablesDialog, ResumedOrderPanel, AddItemsPanel } from "./tables-dialog";
import { OfflineBanner } from "./offline-banner";
import { useSync } from "@/lib/offline/use-sync";
import { cacheMenu, cacheOpenOrders, getCachedMenu, getCachedOpenOrders, listQueue, type CreateOrderAction } from "@/lib/offline/db";
import { queueCreateOrder, queuePayOrder, queueVoidOrder } from "@/lib/offline/queue";
import { newOrderId } from "@/lib/ids";
import { computeProvisionalTotal, settingsForOrderType, type BranchPricingSnapshot } from "@/lib/pricing";
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
  tenantName,
  branchName,
  logoUrl,
  showLogoOnReceipt,
  receiptHeader,
  pricingSnapshot,
  canTakePayment,
  canApplyDiscount,
  canVoid,
  canCancel,
  canReprintReceipt,
}: {
  tenantId: string;
  branchId: string;
  tenantName: string;
  branchName: string;
  logoUrl: string | null;
  showLogoOnReceipt: boolean;
  receiptHeader: string | null;
  pricingSnapshot: BranchPricingSnapshot;
  canTakePayment: boolean;
  canApplyDiscount: boolean;
  canVoid: boolean;
  canCancel: boolean;
  canReprintReceipt: boolean;
}) {
  const sync = useSync();
  const [categories, setCategories] = useState<MenuCategoryDto[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("DINE_IN");
  const [table, setTable] = useState<RestaurantTableDto | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [tablesOpen, setTablesOpen] = useState(false);
  const [resumed, setResumed] = useState<{ table: RestaurantTableDto; order: OrderDto } | null>(null);
  const [addingItemsToOrder, setAddingItemsToOrder] = useState(false);
  const [totals, setTotals] = useState<PreviewTotals | null>(null);
  const [variantItem, setVariantItem] = useState<MenuItemDto | null>(null);
  const [sending, setSending] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [queue, setQueue] = useState<OrderDto[]>([]);
  const [payingOrder, setPayingOrder] = useState<OrderDto | null>(null);
  const [paying, setPaying] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState<OrderDto | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<OrderDto | null>(null);
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
      })
      .finally(() => setMenuLoading(false));
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

  /**
   * The same pricing engine the server runs, against the branch snapshot that came down with the
   * page. Used as the offline fallback below, and as the value queued when an order is punched with
   * no connection.
   */
  const localTotals = useMemo(() => {
    if (lines.length === 0) return null;
    return computeProvisionalTotal(
      lines.map((l, i) => ({
        id: String(i),
        unitPricePaisa: l.unitPricePaisa,
        quantity: l.quantity,
        discount: l.discount,
      })),
      discount ?? undefined,
      pricingSnapshot.taxRules,
      settingsForOrderType(pricingSnapshot, orderType)
    );
  }, [lines, orderType, discount, pricingSnapshot]);

  /**
   * Live totals: show the locally computed figure straight away, then let the server refine it.
   *
   * The cart is priced locally FIRST, on every change, rather than only when the request fails.
   * Waiting for a failure to fall back sounds equivalent and is not: it assumes the request fails
   * *fast*. Café wi-fi does not fail fast — it hangs. A router that is up but not routing leaves
   * navigator.onLine true and the fetch pending until it times out, and for that whole window the
   * cashier is looking at a total of Rs 0 with a customer in front of them. Seeding locally means
   * the cart is never without a total, whatever the network is doing.
   *
   * The server still wins when it answers: it prices against live branch settings, where the
   * snapshot is as old as this page load. Its response simply overwrites the local figure, which in
   * the ordinary case is the same number — both run the same engine (tests/offline-pricing.test.ts).
   */
  useEffect(() => {
    if (lines.length === 0) return;
    setTotals(localTotals);

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
        // Offline, hanging, or aborted because the cart changed again — the locally computed total
        // is already on screen, so there is nothing to recover here.
        .catch(() => {});
    }, 200);

    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [lines, orderType, discount, localTotals]);

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

  // `andPay`: the cart panel's "Take Payment" button used to just open the Order Queue — a list of
  // *other*, already-sent orders — leaving the cart's own order never created and never sent to
  // the kitchen at all, with nothing telling the cashier that's what just happened. "Take Payment"
  // now actually does what it says: create + send this order (identical to plain "Send to
  // Kitchen"), then go straight to the payment dialog for it, skipping the queue detour entirely.
  async function handleSendToKitchen(andPay = false) {
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
        // Taking payment immediately requires a live pay-preview round trip (PaymentDialog fetches
        // the authoritative total, which depends on the chosen tender's tax rate) — not something
        // that works offline. Falls back to the normal queue-and-notify path either way; the
        // cashier pays it from the Order Queue once the connection's back, same as any other order
        // that was sent to the kitchen while offline.
        await queueOffline();
        if (andPay) toast.error("You're offline — pay this order from the Order Queue once you're back online.");
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
        if (andPay) {
          const full = await fetch("/api/orders").then((r) => r.json());
          const order: OrderDto | undefined = (full.orders ?? []).find((o: OrderDto) => o.id === data.order.id);
          if (order) setPayingOrder(order);
        }
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
        // localTotals, not a bare sum of the lines: that fallback silently dropped tax, service
        // charge and rounding, so an order queued offline displayed a different figure in the queue
        // than the server assigns it on sync.
        totalPaisa: totals?.totalPaisa ?? localTotals?.totalPaisa ?? 0,
        localOrderNumber: localOrderCounter.current--,
        deliveryAddress: orderType === "DELIVERY" ? deliveryAddress.trim() || undefined : undefined,
      });
      toast.success(`Order queued offline — will sync when the connection returns.`);
      resetCart();
      if (showQueue) loadQueue();
      void localOrder;
    }
  }

  // Online only, deliberately — addLinesToOrder isn't one of the offline queue's three action
  // types (createOrder/pay/void), so there's no replay path for it yet if the device goes offline
  // mid-submission. Blocked up front rather than half-attempted.
  async function handleAddItemsSubmit() {
    if (!resumed || lines.length === 0) return;
    if (!sync.isOnline) {
      toast.error("You're offline — adding items to an order needs a connection.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/orders/${resumed.order.id}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.map((l) => ({
            menuItemId: l.menuItemId,
            variantId: l.variantId,
            quantity: l.quantity,
            discount: l.discount,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not add items.");
        return;
      }
      toast.success(`Added to order #${resumed.order.orderNumber}.`);
      // addLinesToOrder's response is the bare updated Order row (no .lines — see
      // src/server/orders.ts) — refetch the full order the same way the order queue already does,
      // rather than teaching that endpoint a response shape nothing else needs.
      const refreshed = await fetch("/api/orders").then((r) => r.json());
      const updatedOrder: OrderDto = (refreshed.orders ?? []).find((o: OrderDto) => o.id === resumed.order.id) ?? resumed.order;
      setResumed({ table: resumed.table, order: updatedOrder });
      setAddingItemsToOrder(false);
      setLines([]);
      if (showQueue) loadQueue();
    } catch {
      toast.error("Could not add items — check your connection.");
    } finally {
      setSending(false);
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
        const paidOrderId = payingOrder.id;
        setPayingOrder(null);
        setResumed(null);
        loadQueue();
        await openReceiptFor(paidOrderId);
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

  // The pay/lines endpoints both return the bare updated Order row (no lines/table/payments
  // relations — see src/server/orders.ts) — not enough to print a real itemized receipt, so this
  // refetches the full order the same way the order queue and the add-items flow already do.
  async function openReceiptFor(orderId: string) {
    try {
      const data = await fetch("/api/orders").then((r) => r.json());
      const full: OrderDto | undefined = (data.orders ?? []).find((o: OrderDto) => o.id === orderId);
      if (full) setReceiptOrder(full);
    } catch {
      // Payment already succeeded — a failed refetch just means no receipt pops up automatically;
      // not worth surfacing as an error on top of a successful payment.
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

  // Online only, deliberately — same reasoning as handleAddItemsSubmit above: cancelSentOrder
  // isn't one of the offline queue's three action types, so there's no replay path for it.
  async function handleCancelOrder(order: OrderDto, reason: string) {
    if (!sync.isOnline) {
      toast.error("You're offline — cancelling an order needs a connection.");
      return;
    }
    try {
      const res = await fetch(`/api/orders/${order.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not cancel order.");
        return;
      }
      toast.success(`Order #${order.orderNumber} cancelled.`);
      setCancellingOrder(null);
      loadQueue();
    } catch {
      toast.error("Could not cancel order.");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <OfflineBanner sync={sync} />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_340px]">
        <div className="relative min-h-0">
          <ProductGrid categories={categories} loading={menuLoading} onSelectItem={handleSelectItem} />
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

        {resumed && addingItemsToOrder ? (
          <div className="min-h-0 border-l bg-card">
            <AddItemsPanel
              orderNumber={resumed.order.orderNumber}
              lines={lines}
              onQuantityChange={handleQuantityChange}
              onRemoveLine={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
              onCancel={() => {
                setAddingItemsToOrder(false);
                setLines([]);
              }}
              onSubmit={handleAddItemsSubmit}
              submitting={sending}
            />
          </div>
        ) : resumed ? (
          <div className="min-h-0 overflow-y-auto border-l bg-muted/30 p-4">
            <ResumedOrderPanel
              table={resumed.table}
              order={resumed.order}
              onClose={() => setResumed(null)}
              onTakePayment={() => setPayingOrder(resumed.order)}
              onAddItems={() => {
                setLines([]);
                setAddingItemsToOrder(true);
              }}
            />
          </div>
        ) : showQueue ? (
          <OrderQueuePanel
            orders={queue}
            onPay={(o) => setPayingOrder(o)}
            onVoid={handleVoidOrder}
            canVoid={canVoid}
            onCancel={(o) => setCancellingOrder(o)}
            canCancel={canCancel}
            onReprintReceipt={canReprintReceipt ? (o) => openReceiptFor(o.id) : undefined}
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
            onSendToKitchen={() => handleSendToKitchen()}
            onOpenPayment={() => handleSendToKitchen(true)}
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
          orderId={payingOrder?.id ?? null}
          totalPaisa={payingOrder?.totalPaisa ?? 0}
          onClose={() => setPayingOrder(null)}
          onConfirm={handleConfirmPayment}
          submitting={paying}
        />

        <ReceiptDialog
          order={receiptOrder}
          tenantName={tenantName}
          branchName={branchName}
          logoUrl={logoUrl}
          showLogo={showLogoOnReceipt}
          receiptHeader={receiptHeader}
          onClose={() => setReceiptOrder(null)}
        />

        <CancelOrderDialog
          order={cancellingOrder}
          onClose={() => setCancellingOrder(null)}
          onConfirm={handleCancelOrder}
        />
      </div>
    </div>
  );
}
