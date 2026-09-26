"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, ChevronDown, ClipboardList, Lock, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProductGrid } from "./product-grid";
import { CartPanel } from "./cart-panel";
import { OptionsDialog } from "./options-dialog";
import { RefundDialog } from "./refund-dialog";
import { PaymentDialog } from "./payment-dialog";
import { ReceiptDialog } from "./receipt-dialog";
import { BillDialog } from "./bill-dialog";
// The same ticket the kitchen screen prints. A café with no screen in the kitchen had no way to
// get one at the till, which is most small cafés.
import { KotDialog } from "@/components/kds/kot-dialog";
import { OrderQueuePanel } from "./order-queue-panel";
import { CancelOrderDialog } from "./cancel-order-dialog";
import { OrderManageDialog, canManageAnything, type ManagePermissions } from "./order-manage-dialog";
import { NoSaleDialog } from "./no-sale-dialog";
import { useOrderAlerts } from "./use-order-alerts";
import { setSoundOn, useSoundOn } from "@/lib/chime";
import { TablesDialog, ResumedOrderPanel, AddItemsPanel } from "./tables-dialog";
import { OfflineBanner } from "./offline-banner";
import { useSync } from "@/lib/offline/use-sync";
import { cacheMenu, cacheOpenOrders, getCachedMenu, getCachedOpenOrders, listQueue, type CreateOrderAction } from "@/lib/offline/db";
import { queueCreateOrder, queuePayOrder, queueVoidOrder } from "@/lib/offline/queue";
import { newOrderId } from "@/lib/ids";
import { useMediaQuery } from "@/lib/use-media-query";
import { formatPkr } from "@/lib/money";
import { cn } from "@/lib/utils";
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
  userId,
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
  canPrintKot,
  canReprintKot,
  canPrintBill,
  canRefund,
  managePermissions,
  canNoSale,
}: {
  tenantId: string;
  branchId: string;
  /** Who is at this till: their own orders don't pop up here, and their "ready" alerts do. */
  userId: string;
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
  canPrintKot: boolean;
  canReprintKot: boolean;
  canPrintBill: boolean;
  canRefund: boolean;
  /** Voiding one item, switching type, merging tables, tax exemption — see OrderManageDialog. */
  managePermissions: ManagePermissions;
  /** pos.cashDrawer.openNoSale. */
  canNoSale: boolean;
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
  /** The server's answer, tagged with the local figure it was computed for, so a stale reply for a
   *  cart that has since changed can be recognised and ignored rather than shown. */
  const [serverTotals, setServerTotals] = useState<{ for: object | null; totals: PreviewTotals } | null>(null);
  const [optionsItem, setOptionsItem] = useState<MenuItemDto | null>(null);
  const [refundingOrder, setRefundingOrder] = useState<OrderDto | null>(null);
  const [sending, setSending] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  /**
   * Whether the order panel is pulled up, on screens too narrow to show it beside the menu.
   *
   * Below 768px the cart does not fit next to a usable menu - on a phone it ran off the right edge
   * and squeezed the menu into a strip - so it lives in a sheet instead, summarised by a bar at the
   * bottom. On wider screens it is always visible and this flag has no effect.
   */
  const [paneOpen, setPaneOpen] = useState(false);
  // Wide by default before hydration: that layout hides nothing, so a first paint on a phone costs a
  // moment of cramped layout rather than a hidden cart.
  const isWide = useMediaQuery("(min-width: 768px)", true);
  const [queue, setQueue] = useState<OrderDto[]>([]);
  const [payingOrder, setPayingOrder] = useState<OrderDto | null>(null);
  const [paying, setPaying] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState<OrderDto | null>(null);
  const [kotOrder, setKotOrder] = useState<OrderDto | null>(null);
  const [billOrderId, setBillOrderId] = useState<string | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<OrderDto | null>(null);
  const [managingOrderId, setManagingOrderId] = useState<string | null>(null);
  const [noSaleOpen, setNoSaleOpen] = useState(false);
  const canManage = canManageAnything(managePermissions);
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

  // New orders from other devices, rounds added to tables, and "ready" for orders placed here —
  // see use-order-alerts.ts. An open Order Queue reloads as they arrive.
  const soundOn = useSoundOn();
  const { awaitingPayment } = useOrderAlerts({
    tenantId,
    branchId,
    userId,
    canTakePayment,
    soundOn,
    onOpenQueue: () => {
      setShowQueue(true);
      setPaneOpen(true);
    },
    onActivity: () => {
      if (showQueue) void loadQueue();
    },
  });

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
        .then((t: PreviewTotals) => setServerTotals({ for: localTotals, totals: t }))
        // Offline, hanging, or aborted because the cart changed again — the locally computed total
        // is already on screen, so there is nothing to recover here.
        .catch(() => {});
    }, 200);

    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [lines, orderType, discount, localTotals]);

  /**
   * What the till shows: the server's figure when it answered for exactly this cart, the local one
   * otherwise.
   *
   * Derived rather than copied into state. The local total used to be pushed into state at the top
   * of the effect above, which is an extra render on every keystroke and the thing the linter flags
   * — and it made "which figure is on screen" depend on the order two setState calls landed in.
   * Comparing against localTotals' identity works because it is memoized on exactly the inputs the
   * request is built from, so a reply for an older cart can never be mistaken for the current one.
   */
  const orderItemCount = lines.reduce((n, l) => n + l.quantity, 0);

  const totals: PreviewTotals | null =
    serverTotals && serverTotals.for === localTotals ? serverTotals.totals : localTotals;

  function addLine(item: MenuItemDto, variantId?: string, modifierIds: string[] = []) {
    const variant = variantId ? item.variants.find((v) => v.id === variantId) : undefined;
    const chosen = item.modifierGroups.flatMap((g) => g.modifiers).filter((m) => modifierIds.includes(m.id));
    const unitPricePaisa =
      item.basePricePaisa +
      (variant?.priceDeltaPaisa ?? 0) +
      chosen.reduce((sum, m) => sum + m.priceDeltaPaisa, 0);

    // Same item, same size, same add-ons is the same line; differing add-ons are not. Comparing a
    // sorted key rather than the array keeps "espresso shot then cream" from becoming a second line
    // to "cream then espresso shot".
    const signature = [...modifierIds].sort().join(",");

    setLines((prev) => {
      const existing = prev.find(
        (l) =>
          l.menuItemId === item.id &&
          l.variantId === variantId &&
          [...(l.modifierIds ?? [])].sort().join(",") === signature &&
          // A line someone has written a note on is not a match for a later plain tap. Merging
          // would silently apply "no sugar" to a second coffee nobody asked to change.
          !l.notes
      );
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      }
      const suffix = [variant?.name, ...chosen.map((m) => m.name)].filter(Boolean).join(", ");
      return [
        ...prev,
        {
          key: crypto.randomUUID(),
          menuItemId: item.id,
          name: suffix ? `${item.name} (${suffix})` : item.name,
          variantId,
          modifierIds: modifierIds.length > 0 ? modifierIds : undefined,
          unitPricePaisa,
          quantity: 1,
        },
      ];
    });
  }

  /** Trimmed, and an emptied box clears the note rather than storing "" — the kitchen should see
   *  no note at all, not a blank one. */
  function setLineNote(key: string, notes: string) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, notes: notes.trim() || undefined } : l)));
  }

  function handleSelectItem(_categoryId: string, item: MenuItemDto) {
    // Anything with a size to pick or an add-on to offer goes through the dialog; everything else
    // stays a single tap.
    if (item.variants.length > 0 || item.modifierGroups.length > 0) {
      setOptionsItem(item);
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
    // Back to the menu for the next order.
    setPaneOpen(false);
    setLines([]);
    setServerTotals(null);
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
          modifierIds: l.modifierIds,
          notes: l.notes,
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

        // Offered beside the confirmation rather than in a dialog over it. A modal here blocks the
        // till until someone dismisses it — on every order, during a rush — and an interrupted
        // cashier leaves the table locked behind it. This stays out of the way: one tap prints,
        // ignoring it costs nothing, and a missed one is still reprintable from the Order Queue.
        const orderId = data.order.id;
        toast.success(`Order #${data.order.orderNumber} sent to kitchen.`, {
          duration: canPrintKot && !andPay ? 10_000 : undefined,
          action:
            canPrintKot && !andPay
              ? { label: "Print ticket", onClick: () => void openKotFor(orderId) }
              : undefined,
        });
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
            modifierIds: l.modifierIds,
            notes: l.notes,
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
  /** The create/send responses are bare Order rows — no lines, no table — so the ticket is built
   * from the same full refetch the receipt uses. */
  async function openKotFor(orderId: string) {
    try {
      const data = await fetch("/api/orders").then((r) => r.json());
      const full: OrderDto | undefined = (data.orders ?? []).find((o: OrderDto) => o.id === orderId);
      if (full) setKotOrder(full);
    } catch {
      // The order is already with the kitchen; failing to show a ticket is not worth an error on
      // top of a successful send. It can be reprinted from the Order Queue.
    }
  }

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
      {/* The cart grows with the screen instead of sitting at a fixed 340px: 300 on a portrait
          tablet, where 340 took 42% of the width, and 380 on a wide one. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1fr_300px] lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_380px]">
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <ProductGrid
              categories={categories}
              loading={menuLoading}
              onSelectItem={handleSelectItem}
              headerAction={
                (
                  <div className="flex gap-2">
                    {/* The alert chime, on or off for this device. */}
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-11 rounded-full border-none bg-card shadow-sm"
                      aria-label={soundOn ? "Turn alert sound off" : "Turn alert sound on"}
                      aria-pressed={soundOn}
                      title={soundOn ? "Alert sound on" : "Alert sound off"}
                      onClick={() => setSoundOn(!soundOn)}
                    >
                      {soundOn ? <Bell className="size-4" /> : <BellOff className="size-4 text-muted-foreground" />}
                    </Button>
                    {canNoSale && (
                      <Button
                        variant="outline"
                        className="h-11 rounded-full border-none bg-card shadow-sm"
                        onClick={() => setNoSaleOpen(true)}
                      >
                        <Lock className="size-4" />
                        <span className="max-sm:sr-only">No sale</span>
                      </Button>
                    )}
                    {canTakePayment && (
                      <Button
                        variant="outline"
                        className="h-11 rounded-full border-none bg-card shadow-sm"
                        onClick={() => {
                          const next = !showQueue;
                          setShowQueue(next);
                          setPaneOpen(next);
                        }}
                      >
                        <ClipboardList className="size-4" />
                        <span className="max-sm:sr-only">Order Queue</span>
                        {/* Orders still to be paid, so one placed on a waiter's phone can't be missed
                            even after its pop-up has gone. */}
                        {!!awaitingPayment && (
                          <span
                            className="ml-0.5 min-w-5 rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground tabular-nums"
                            data-testid="queue-count"
                            aria-label={`${awaitingPayment} waiting to be paid`}
                          >
                            {awaitingPayment}
                          </span>
                        )}
                      </Button>
                    )}
                  </div>
                )
              }
            />
          </div>

          {/* The order, summarised, on screens where the panel is a sheet. Adding an item does not
              open it: a cashier ringing up six items wants to keep tapping the menu, and watches
              the count and total here instead. */}
          <div className="flex shrink-0 items-center gap-3 border-t bg-card px-3 py-2.5 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] md:hidden">
            <div className="min-w-0 flex-1">
              {lines.length > 0 ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    {orderItemCount} item{orderItemCount === 1 ? "" : "s"}
                    {table ? ` · Table ${table.label}` : ""}
                  </div>
                  <div className="font-heading text-lg font-bold tabular-nums">{formatPkr(totals?.totalPaisa ?? 0)}</div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {resumed ? `Table ${resumed.table.label} · order #${resumed.order.orderNumber}` : "Tap items to add them"}
                </div>
              )}
            </div>
            <Button size="lg" className="h-12 shrink-0 px-5" onClick={() => setPaneOpen(true)}>
              <ShoppingBag className="size-4" />
              View order
            </Button>
          </div>
        </div>

        {/* Tap outside the sheet to put it away. */}
        {paneOpen && !isWide && (
          <div aria-hidden className="fixed inset-0 z-30 bg-black/40" onClick={() => setPaneOpen(false)} />
        )}

        <div
          // One panel, positioned two ways: a column on wide screens, a sheet sliding up from the
          // bottom on narrow ones. Rendered once either way, so the cart's lines, notes and totals
          // are the same whichever way round the device is held.
          //
          // inert while it is off-screen: a closed sheet is still in the DOM, and without this a
          // keyboard or screen reader would walk into a cart the cashier cannot see.
          inert={!isWide && !paneOpen}
          className={cn(
            "flex min-h-0 flex-col",
            "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:h-[88dvh] max-md:overflow-hidden max-md:rounded-t-2xl max-md:bg-card max-md:shadow-2xl max-md:transition-transform max-md:duration-200",
            paneOpen ? "max-md:translate-y-0" : "max-md:translate-y-full"
          )}
        >
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-2 md:hidden">
            <span className="text-sm font-semibold">
              {showQueue ? "Order Queue" : resumed ? `Table ${resumed.table.label}` : "Current order"}
            </span>
            <Button variant="ghost" size="sm" className="h-10" onClick={() => setPaneOpen(false)}>
              <ChevronDown className="size-4" />
              Back to menu
            </Button>
          </div>
          {/* *:h-full: the panels below used to fill a grid cell by being stretched; inside this
              wrapper they have to be told, or the queue and the resumed order stop scrolling. */}
          <div className="min-h-0 flex-1 *:h-full">
        {resumed && addingItemsToOrder ? (
          <div className="min-h-0 border-l bg-card">
            <AddItemsPanel
              orderNumber={resumed.order.orderNumber}
              lines={lines}
              onQuantityChange={handleQuantityChange}
              onRemoveLine={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
              onNoteChange={setLineNote}
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
              onClose={() => {
                setResumed(null);
                setPaneOpen(false);
              }}
              onTakePayment={() => setPayingOrder(resumed.order)}
              onPrintBill={canPrintBill ? () => setBillOrderId(resumed.order.id) : undefined}
              onManage={canManage ? () => setManagingOrderId(resumed.order.id) : undefined}
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
            onReprintKot={canReprintKot ? (o) => setKotOrder(o) : undefined}
            onPrintBill={canPrintBill ? (o) => setBillOrderId(o.id) : undefined}
            onManage={canManage ? (o) => setManagingOrderId(o.id) : undefined}
            canRefund={canRefund}
            onRefund={(o) => setRefundingOrder(o)}
            onClose={() => {
              setShowQueue(false);
              setPaneOpen(false);
            }}
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
            onNoteChange={setLineNote}
            totals={lines.length === 0 ? null : totals}
            canTakePayment={canTakePayment}
            onSendToKitchen={() => handleSendToKitchen()}
            onOpenPayment={() => handleSendToKitchen(true)}
            sending={sending}
          />
        )}
          </div>
        </div>

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
            setPaneOpen(true);
            setTablesOpen(false);
          }}
        />

        <OrderManageDialog
          orderId={managingOrderId}
          permissions={managePermissions}
          onClose={() => setManagingOrderId(null)}
          onChanged={(changed) => {
            void loadQueue();
            // The table panel follows the order — unless it has left that table (made takeaway, or
            // merged into another bill), in which case the panel for this table has nothing to show.
            setResumed((prev) => {
              if (!prev || prev.order.id !== changed.id) return prev;
              if (changed.tableId !== prev.table.id || changed.status === "CANCELLED") return null;
              return { ...prev, order: changed };
            });
          }}
        />

        <NoSaleDialog open={noSaleOpen} branchName={branchName} onClose={() => setNoSaleOpen(false)} />

        <RefundDialog
          order={refundingOrder}
          onClose={() => setRefundingOrder(null)}
          onRefunded={() => {
            // Reload the queue so the card reflects the refund without a manual refresh.
            void loadQueue();
          }}
        />

        <OptionsDialog
          item={optionsItem}
          onClose={() => setOptionsItem(null)}
          onConfirm={({ variantId, modifierIds }) => {
            if (optionsItem) addLine(optionsItem, variantId, modifierIds);
            setOptionsItem(null);
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

        <KotDialog
          order={
            kotOrder
              ? {
                  orderNumber: kotOrder.orderNumber,
                  type: kotOrder.type,
                  source: kotOrder.source ?? "POS",
                  sentToKitchenAt: kotOrder.sentToKitchenAt ?? null,
                  table: kotOrder.table ?? null,
                  lines: kotOrder.lines.map((l) => ({
                    id: l.id,
                    nameSnapshot: l.nameSnapshot,
                    quantity: l.quantity,
                    notes: l.notes ?? null,
                    modifiers: l.modifiers,
                    isVoided: l.isVoided,
                  })),
                }
              : null
          }
          branchName={branchName}
          onClose={() => setKotOrder(null)}
        />

        <BillDialog
          orderId={billOrderId}
          tenantName={tenantName}
          branchName={branchName}
          logoUrl={logoUrl}
          showLogo={showLogoOnReceipt}
          receiptHeader={receiptHeader}
          onClose={() => setBillOrderId(null)}
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
