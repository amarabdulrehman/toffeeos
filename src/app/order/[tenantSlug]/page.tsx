"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { formatPkr } from "@/lib/money";

interface Storefront {
  tenantId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  brandColor: string | null;
  branches: { id: string; name: string; address: string | null }[];
}

interface MenuVariant {
  id: string;
  name: string;
  priceDeltaPaisa: number;
  isDefault: boolean;
}

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  basePricePaisa: number;
  isAvailable: boolean;
  variants: MenuVariant[];
}

interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  variantId?: string;
  unitPricePaisa: number;
  quantity: number;
}

interface TableInfo {
  id: string;
  label: string;
  branchId: string;
  floorName: string;
}

function OnlineOrderContent() {
  const params = useParams<{ tenantSlug: string }>();
  const searchParams = useSearchParams();
  const qrTableId = searchParams.get("tableId");
  const [storefront, setStorefront] = useState<Storefront | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [fulfillment, setFulfillment] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [placing, setPlacing] = useState(false);
  const [confirmation, setConfirmation] = useState<{ orderNumber: number; totalPaisa: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const isQrOrder = !!qrTableId;

  useEffect(() => {
    fetch(`/api/online-order/${params.tenantSlug}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((d: Storefront) => {
        setStorefront(d);
        if (!qrTableId && d.branches.length > 0) setBranchId(d.branches[0].id);
      })
      .catch(() => setNotFound(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.tenantSlug]);

  // QR mode: resolve the scanned table and lock the branch to wherever that table actually is —
  // a guest scanning a physical table shouldn't be choosing a branch at all.
  useEffect(() => {
    if (!qrTableId) return;
    fetch(`/api/online-order/${params.tenantSlug}/table/${qrTableId}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((d: TableInfo) => {
        setTableInfo(d);
        setBranchId(d.branchId);
      })
      .catch(() => setNotFound(true));
  }, [qrTableId, params.tenantSlug]);

  useEffect(() => {
    if (!branchId) return;
    fetch(`/api/online-order/${params.tenantSlug}/menu?branchId=${branchId}`)
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []));
  }, [branchId, params.tenantSlug]);

  function addLine(item: MenuItem, variant?: MenuVariant) {
    const unitPricePaisa = item.basePricePaisa + (variant?.priceDeltaPaisa ?? 0);
    setLines((prev) => {
      const existing = prev.find((l) => l.menuItemId === item.id && l.variantId === variant?.id);
      if (existing) return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { key: crypto.randomUUID(), menuItemId: item.id, name: variant ? `${item.name} (${variant.name})` : item.name, variantId: variant?.id, unitPricePaisa, quantity: 1 }];
    });
  }

  function changeQty(key: string, delta: number) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0));
  }

  const totalPaisa = lines.reduce((a, l) => a + l.unitPricePaisa * l.quantity, 0);

  async function placeOrder() {
    setError(null);
    if (lines.length === 0) return setError("Add at least one item.");
    if (!isQrOrder) {
      if (!name.trim() || !phone.trim()) return setError("Name and phone are required.");
      if (fulfillment === "DELIVERY" && !address.trim()) return setError("A delivery address is required.");
    }

    setPlacing(true);
    try {
      const url = isQrOrder ? `/api/online-order/${params.tenantSlug}/qr-checkout` : `/api/online-order/${params.tenantSlug}/checkout`;
      const body = isQrOrder
        ? {
            tableId: qrTableId,
            customerName: name.trim() || undefined,
            customerPhone: phone.trim() || undefined,
            lines: lines.map((l) => ({ menuItemId: l.menuItemId, variantId: l.variantId, quantity: l.quantity })),
            idempotencyKey: idempotencyKey.current,
          }
        : {
            branchId,
            customerName: name,
            customerPhone: phone,
            fulfillment,
            deliveryAddress: fulfillment === "DELIVERY" ? address : undefined,
            lines: lines.map((l) => ({ menuItemId: l.menuItemId, variantId: l.variantId, quantity: l.quantity })),
            idempotencyKey: idempotencyKey.current,
          };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not place order.");
        return;
      }
      setConfirmation(data.order);
      setLines([]);
      idempotencyKey.current = crypto.randomUUID();
    } finally {
      setPlacing(false);
    }
  }

  if (notFound) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">This ordering page isn&apos;t available.</div>;
  }
  if (!storefront) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }

  const brandColor = storefront.brandColor ?? "#7c3aed";

  if (confirmation) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-sm text-center">
          <CardContent className="space-y-3 pt-8 pb-8">
            <div className="text-4xl">✓</div>
            <h1 className="text-xl font-bold">Order #{confirmation.orderNumber} placed!</h1>
            <p className="text-muted-foreground">
              {isQrOrder
                ? `We'll bring it out to table ${tableInfo?.label} shortly.`
                : fulfillment === "DELIVERY"
                  ? "We'll deliver it to you soon."
                  : "We'll have it ready for pickup soon."}{" "}
              Pay {isQrOrder ? "at the table" : fulfillment === "DELIVERY" ? "on delivery" : "at pickup"} — total{" "}
              {formatPkr(confirmation.totalPaisa)}.
            </p>
            <Button className="w-full" onClick={() => setConfirmation(null)}>
              Order again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="flex items-center gap-3 border-b bg-background px-6 py-4" style={{ borderTopColor: brandColor, borderTopWidth: 3 }}>
        {storefront.logoUrl && <img src={storefront.logoUrl} alt="" className="size-10 rounded-full object-cover" />}
        <div>
          <h1 className="text-lg font-bold">{storefront.name}</h1>
          <p className="text-xs text-muted-foreground">
            {isQrOrder ? `Table ${tableInfo?.label ?? "…"} — pay at the table` : "Order online — pay at pickup or on delivery"}
          </p>
        </div>
        {!isQrOrder && storefront.branches.length > 1 && (
          <Select value={branchId} onValueChange={(v) => v && setBranchId(v)}>
            <SelectTrigger className="ml-auto w-48">
              <SelectValue>{(v: string) => storefront.branches.find((b) => b.id === v)?.name ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {storefront.branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </header>

      <div className="mx-auto grid max-w-5xl gap-6 p-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {categories.map((cat) => (
            <div key={cat.id}>
              <h2 className="mb-2 font-heading text-lg font-semibold">{cat.name}</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {cat.items.map((item) => (
                  <Card key={item.id} className={!item.isAvailable ? "opacity-50" : ""}>
                    <CardContent className="flex items-center justify-between gap-2 pt-4">
                      <div>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-sm text-muted-foreground">{formatPkr(item.basePricePaisa)}</div>
                        {!item.isAvailable && <div className="text-xs font-medium text-destructive">Unavailable right now</div>}
                      </div>
                      {item.variants.length === 0 ? (
                        <Button size="sm" disabled={!item.isAvailable} onClick={() => addLine(item)}>
                          Add
                        </Button>
                      ) : (
                        <Select disabled={!item.isAvailable} onValueChange={(v) => v && addLine(item, item.variants.find((va) => va.id === v))}>
                          <SelectTrigger className="w-28">
                            <SelectValue placeholder="Add" />
                          </SelectTrigger>
                          <SelectContent>
                            {item.variants.map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>

        <Card className="h-fit">
          <CardContent className="space-y-4 pt-4">
            <h2 className="font-heading text-lg font-semibold">Your order</h2>
            {lines.length === 0 && <p className="text-sm text-muted-foreground">Cart is empty.</p>}
            {lines.map((l) => (
              <div key={l.key} className="flex items-center justify-between text-sm">
                <span>{l.name}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => changeQty(l.key, -1)} className="size-6 rounded-full border">
                    −
                  </button>
                  <span className="w-4 text-center">{l.quantity}</span>
                  <button onClick={() => changeQty(l.key, 1)} className="size-6 rounded-full border">
                    +
                  </button>
                </div>
              </div>
            ))}
            {lines.length > 0 && (
              <div className="flex justify-between border-t pt-2 font-semibold">
                <span>Total</span>
                <span>{formatPkr(totalPaisa)}</span>
              </div>
            )}

            <div className="space-y-2 border-t pt-4">
              {!isQrOrder && (
                <Select value={fulfillment} onValueChange={(v) => v && setFulfillment(v as "PICKUP" | "DELIVERY")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PICKUP">Pickup</SelectItem>
                    <SelectItem value="DELIVERY">Delivery</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Input placeholder={isQrOrder ? "Your name (optional)" : "Your name"} value={name} onChange={(e) => setName(e.target.value)} />
              <Input placeholder={isQrOrder ? "Phone (optional)" : "Phone number"} value={phone} onChange={(e) => setPhone(e.target.value)} />
              {!isQrOrder && fulfillment === "DELIVERY" && (
                <Textarea placeholder="Delivery address" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" style={{ backgroundColor: brandColor }} disabled={placing} onClick={placeOrder}>
                {placing
                  ? "Placing order…"
                  : isQrOrder
                    ? "Send to kitchen — pay at the table"
                    : `Place order — pay at ${fulfillment === "DELIVERY" ? "delivery" : "pickup"}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function OnlineOrderPage() {
  return (
    <Suspense>
      <OnlineOrderContent />
    </Suspense>
  );
}
