"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { CheckCircle2, Minus, Plus, ShoppingBag, Store, UtensilsCrossed } from "lucide-react";
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
  const cartRef = useRef<HTMLDivElement>(null);
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
  const itemCount = lines.reduce((a, l) => a + l.quantity, 0);

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
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-muted/20 text-center">
        <Store className="size-8 text-muted-foreground/50" />
        <p className="text-muted-foreground">This ordering page isn&apos;t available.</p>
      </div>
    );
  }
  if (!storefront) {
    return <div className="flex min-h-screen items-center justify-center bg-muted/20 text-muted-foreground">Loading…</div>;
  }

  const brandColor = storefront.brandColor ?? "#7c3aed";

  if (confirmation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20 p-6">
        <Card className="w-full max-w-sm animate-in fade-in zoom-in-95 text-center shadow-lg duration-300">
          <CardContent className="space-y-3 pt-8 pb-8">
            <div
              className="mx-auto flex size-16 items-center justify-center rounded-full ring-8"
              style={{ backgroundColor: `${brandColor}1a`, color: brandColor, ["--tw-ring-color" as string]: `${brandColor}0d` }}
            >
              <CheckCircle2 className="size-9" strokeWidth={2.25} />
            </div>
            <h1 className="font-heading text-xl font-bold">Order #{confirmation.orderNumber} placed!</h1>
            <p className="text-sm text-muted-foreground">
              {isQrOrder
                ? `We'll bring it out to table ${tableInfo?.label} shortly.`
                : fulfillment === "DELIVERY"
                  ? "We'll deliver it to you soon."
                  : "We'll have it ready for pickup soon."}{" "}
              Pay {isQrOrder ? "at the table" : fulfillment === "DELIVERY" ? "on delivery" : "at pickup"} — total{" "}
              <span className="font-semibold text-foreground">{formatPkr(confirmation.totalPaisa)}</span>.
            </p>
            <Button className="w-full" size="lg" style={{ backgroundColor: brandColor }} onClick={() => setConfirmation(null)}>
              Order again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 pb-24 md:pb-0">
      <header
        className="border-b bg-background px-5 py-4 shadow-sm sm:px-6"
        style={{ borderTopColor: brandColor, borderTopWidth: 4, backgroundImage: `linear-gradient(to bottom, ${brandColor}0a, transparent)` }}
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3.5">
          {storefront.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied logo URL, not a local asset
            <img src={storefront.logoUrl} alt="" className="size-12 shrink-0 rounded-full border object-cover shadow-xs" />
          ) : (
            <span
              className="flex size-12 shrink-0 items-center justify-center rounded-full text-lg font-bold ring-4"
              style={{ backgroundColor: `${brandColor}1a`, color: brandColor, ["--tw-ring-color" as string]: `${brandColor}0d` }}
            >
              {storefront.name.charAt(0)}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="truncate font-heading text-lg font-bold tracking-tight sm:text-xl">{storefront.name}</h1>
            <p className="truncate text-xs text-muted-foreground sm:text-sm">
              {isQrOrder ? `Table ${tableInfo?.label ?? "…"} — pay at the table` : "Order online — pay at pickup or on delivery"}
            </p>
          </div>
          {!isQrOrder && storefront.branches.length > 1 && (
            <Select value={branchId} onValueChange={(v) => v && setBranchId(v)}>
              <SelectTrigger className="ml-auto w-40 shrink-0 sm:w-48">
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
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-6 p-5 sm:p-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-7">
          {categories.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
              <UtensilsCrossed className="size-8 opacity-40" />
              Loading the menu…
            </div>
          )}
          {categories.map((cat) => (
            <div key={cat.id} id={`cat-${cat.id}`}>
              <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold">
                <span className="h-4 w-1 rounded-full" style={{ backgroundColor: brandColor }} />
                {cat.name}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {cat.items.map((item) => {
                  const cartLine = item.variants.length === 0 ? lines.find((l) => l.menuItemId === item.id) : undefined;
                  return (
                    <Card
                      key={item.id}
                      className={`overflow-hidden shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${!item.isAvailable ? "opacity-50" : ""}`}
                    >
                      <CardContent className="flex gap-3 pt-4">
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied menu image, not a local asset
                          <img src={item.imageUrl} alt="" className="size-16 shrink-0 rounded-xl object-cover shadow-xs" />
                        ) : (
                          <div
                            className="flex size-16 shrink-0 items-center justify-center rounded-xl"
                            style={{ backgroundColor: `${brandColor}12` }}
                          >
                            <UtensilsCrossed className="size-6" style={{ color: brandColor }} strokeWidth={1.75} />
                          </div>
                        )}
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="text-sm font-semibold leading-snug">{item.name}</div>
                          {item.description && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
                          )}
                          <div className="mt-auto flex items-center justify-between pt-2">
                            <span className="font-heading text-sm font-semibold" style={{ color: brandColor }}>
                              {formatPkr(item.basePricePaisa)}
                            </span>
                            {!item.isAvailable ? (
                              <span className="text-xs font-medium text-destructive">Unavailable</span>
                            ) : item.variants.length === 0 ? (
                              cartLine ? (
                                <div className="flex items-center gap-1 rounded-full border bg-muted/40 p-0.5">
                                  <button
                                    onClick={() => changeQty(cartLine.key, -1)}
                                    className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-all duration-150 hover:bg-card hover:text-foreground active:scale-90"
                                  >
                                    <Minus className="size-3.5" />
                                  </button>
                                  <span className="w-5 text-center text-sm font-semibold tabular-nums">{cartLine.quantity}</span>
                                  <button
                                    onClick={() => changeQty(cartLine.key, 1)}
                                    className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-all duration-150 hover:bg-card hover:text-foreground active:scale-90"
                                  >
                                    <Plus className="size-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  className="transition-transform active:scale-95"
                                  style={{ backgroundColor: brandColor }}
                                  onClick={() => addLine(item)}
                                >
                                  Add
                                </Button>
                              )
                            ) : (
                              <Select onValueChange={(v) => v && addLine(item, item.variants.find((va) => va.id === v))}>
                                <SelectTrigger className="h-8 w-28">
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
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <Card ref={cartRef} className="h-fit shadow-md md:sticky md:top-6">
          <CardContent className="space-y-4 pt-4">
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
              <span
                className="flex size-7 items-center justify-center rounded-full"
                style={{ backgroundColor: `${brandColor}1a`, color: brandColor }}
              >
                <ShoppingBag className="size-3.5" />
              </span>
              Your order
            </h2>
            {lines.length === 0 && <p className="text-sm text-muted-foreground">Cart is empty — tap an item to add it.</p>}
            {lines.length > 0 && (
              <div className="space-y-2.5">
                {lines.map((l) => (
                  <div key={l.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{l.name}</span>
                    <div className="flex shrink-0 items-center gap-1 rounded-full border bg-muted/40 p-0.5">
                      <button
                        onClick={() => changeQty(l.key, -1)}
                        className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-all duration-150 hover:bg-card hover:text-foreground active:scale-90"
                      >
                        <Minus className="size-3.5" />
                      </button>
                      <span className="w-5 text-center font-medium tabular-nums">{l.quantity}</span>
                      <button
                        onClick={() => changeQty(l.key, 1)}
                        className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-all duration-150 hover:bg-card hover:text-foreground active:scale-90"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {lines.length > 0 && (
              <div
                className="flex items-center justify-between rounded-xl border px-3.5 py-3"
                style={{ backgroundColor: `${brandColor}0d`, borderColor: `${brandColor}26` }}
              >
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Total</span>
                <span className="font-heading text-xl font-bold tabular-nums" style={{ color: brandColor }}>
                  {formatPkr(totalPaisa)}
                </span>
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
              <Button
                className="w-full shadow-sm transition-transform active:scale-[0.98]"
                size="lg"
                style={{ backgroundColor: brandColor }}
                disabled={placing}
                onClick={placeOrder}
              >
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

      {/* Mobile-only: the cart card above is at the bottom of a long scrolling menu on a phone, so
          give it a persistent summary bar instead of making the guest scroll to find their total. */}
      {itemCount > 0 && (
        <button
          onClick={() => cartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="fixed inset-x-4 bottom-4 z-20 flex animate-in fade-in slide-in-from-bottom-2 items-center justify-between rounded-2xl px-5 py-3.5 text-white shadow-xl transition-transform duration-150 active:scale-[0.98] md:hidden"
          style={{ backgroundColor: brandColor }}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingBag className="size-4" />
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
          <span className="font-heading text-base font-bold tabular-nums">{formatPkr(totalPaisa)}</span>
        </button>
      )}
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
