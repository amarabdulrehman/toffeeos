"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProductGrid } from "./product-grid";
import { CartPanel } from "./cart-panel";
import { VariantDialog } from "./variant-dialog";
import { PaymentDialog } from "./payment-dialog";
import { OrderQueuePanel } from "./order-queue-panel";
import type {
  CartLine,
  FloorDto,
  MenuCategoryDto,
  MenuItemDto,
  OrderDto,
  OrderType,
  PaymentMethod,
  PreviewTotals,
} from "./types";

export function PosTerminal({ canTakePayment }: { canTakePayment: boolean }) {
  const [categories, setCategories] = useState<MenuCategoryDto[]>([]);
  const [floors, setFloors] = useState<FloorDto[]>([]);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("DINE_IN");
  const [tableId, setTableId] = useState<string | undefined>(undefined);
  const [totals, setTotals] = useState<PreviewTotals | null>(null);
  const [variantItem, setVariantItem] = useState<MenuItemDto | null>(null);
  const [sending, setSending] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [queue, setQueue] = useState<OrderDto[]>([]);
  const [payingOrder, setPayingOrder] = useState<OrderDto | null>(null);
  const [paying, setPaying] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    fetch("/api/menu")
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []))
      .catch(() => toast.error("Could not load the menu."));
    fetch("/api/tables")
      .then((r) => r.json())
      .then((d) => setFloors(d.floors ?? []))
      .catch(() => {});
  }, []);

  const loadQueue = useCallback(() => {
    fetch("/api/orders")
      .then((r) => r.json())
      .then((d) => setQueue(d.orders ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (showQueue) loadQueue();
  }, [showQueue, loadQueue]);

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
  }, [lines, orderType]);

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

  async function handleSendToKitchen() {
    if (orderType === "DINE_IN" && !tableId) {
      toast.error("Select a table for this dine-in order.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: orderType,
          tableId: orderType === "DINE_IN" ? tableId : undefined,
          lines: lines.map((l) => ({
            menuItemId: l.menuItemId,
            variantId: l.variantId,
            quantity: l.quantity,
            discount: l.discount,
          })),
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not create order.");
        return;
      }
      await fetch(`/api/orders/${data.order.id}/send-to-kitchen`, { method: "POST" });
      toast.success(`Order #${data.order.orderNumber} sent to kitchen.`);
      setLines([]);
      setTotals(null);
      setTableId(undefined);
      idempotencyKey.current = crypto.randomUUID();
      if (showQueue) loadQueue();
    } finally {
      setSending(false);
    }
  }

  async function handleConfirmPayment(tenders: { method: PaymentMethod; amountPaisa: number }[]) {
    if (!payingOrder) return;
    setPaying(true);
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
      loadQueue();
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="grid h-full grid-cols-[1fr_320px]">
      <div className="relative min-h-0">
        <ProductGrid categories={categories} onSelectItem={handleSelectItem} />
        {canTakePayment && (
          <Button
            variant="outline"
            size="sm"
            className="absolute right-4 top-4"
            onClick={() => setShowQueue((s) => !s)}
          >
            Order Queue
          </Button>
        )}
      </div>

      {showQueue ? (
        <OrderQueuePanel
          orders={queue}
          onPay={(o) => setPayingOrder(o)}
          onClose={() => setShowQueue(false)}
        />
      ) : (
        <CartPanel
          orderType={orderType}
          onOrderTypeChange={setOrderType}
          floors={floors}
          tableId={tableId}
          onTableChange={setTableId}
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

      <VariantDialog
        item={variantItem}
        onClose={() => setVariantItem(null)}
        onPick={(variantId) => {
          if (variantItem) addLine(variantItem, variantId);
          setVariantItem(null);
        }}
      />

      <PaymentDialog
        open={!!payingOrder}
        totalPaisa={payingOrder?.totalPaisa ?? 0}
        onClose={() => setPayingOrder(null)}
        onConfirm={handleConfirmPayment}
        submitting={paying}
      />
    </div>
  );
}
