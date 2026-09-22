export interface MenuVariant {
  id: string;
  name: string;
  priceDeltaPaisa: number;
  isDefault: boolean;
}

export interface MenuModifier {
  id: string;
  name: string;
  priceDeltaPaisa: number;
}

export interface MenuModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: MenuModifier[];
}

export interface MenuItemDto {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  basePricePaisa: number;
  isAvailable: boolean;
  allergens: string[];
  variants: MenuVariant[];
  modifierGroups: MenuModifierGroup[];
}

export interface MenuCategoryDto {
  id: string;
  name: string;
  items: MenuItemDto[];
}

export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "SERVICE";
export type DiscountType = "PERCENT" | "FIXED";
export type PaymentMethod = "CASH" | "CARD" | "JAZZCASH" | "EASYPAISA" | "BANK_TRANSFER" | "OTHER";

export interface Discount {
  type: DiscountType;
  value: number;
}

export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  variantId?: string;
  /** Chosen add-ons. Part of the line's identity, not just its price: a latte with an extra shot
   * is a different line from a plain one, so the two must not merge in the cart. */
  modifierIds?: string[];
  /** "No sugar", "extra spicy", "allergy — no peanuts". Free text the kitchen reads; it never
   * affects the price, which is why it is not part of the line's merge signature the way add-ons
   * are — but a line that carries one will not absorb a later plain tap of the same item. */
  notes?: string;
  unitPricePaisa: number;
  quantity: number;
  discount?: Discount;
}

export interface CustomerDto {
  id: string;
  name: string | null;
  phone: string | null;
}

export interface RestaurantTableDto {
  id: string;
  label: string;
  seats: number;
  status: "AVAILABLE" | "RESERVED" | "BOOKED" | "OCCUPIED";
}

export interface FloorDto {
  id: string;
  name: string;
  tables: RestaurantTableDto[];
}

export interface PreviewTotals {
  subtotalPaisa: number;
  discountedSubtotalPaisa: number;
  serviceChargePaisa: number;
  taxableBasePaisa: number;
  taxPaisa: number;
  deliveryFeePaisa: number;
  totalPaisa: number;
  appliedRateBasisPoints: number;
}

export interface OrderDto {
  id: string;
  orderNumber: number;
  type: OrderType;
  status: string;
  totalPaisa: number;
  paidPaisa: number;
  tableId: string | null;
  createdAt: string;
  /** Optimistic-concurrency counter (src/lib/offline) — absent on locally-created orders that
   * haven't synced yet, since there's no server state to have a version of. */
  version?: number;
  /** POS (staff-entered), ONLINE (the public ordering site), or QR (table QR ordering). Absent on
   * locally-queued-but-not-yet-synced orders defaults to "POS" in the UI. */
  source?: "POS" | "ONLINE" | "QR";
  lines: {
    id: string;
    nameSnapshot: string;
    quantity: number;
    lineTotalPaisa: number;
    kitchenReady: boolean;
    notes?: string | null;
    modifiers?: { id: string; nameSnapshot: string; priceDeltaPaisa: number }[];
  }[];
  /** The rest of these are already returned by GET /api/orders (no `select`, so every scalar
   * column comes back) — just never modeled on the client before there was a reason to read them.
   * Optional because the offline queue's buildLocalOrder (src/lib/offline/queue.ts) builds a
   * minimal local order before any of this exists server-side yet. Needed for a real itemized
   * receipt (see src/components/pos/receipt.tsx) — totalPaisa/paidPaisa alone aren't enough to
   * show a subtotal/service-charge/tax breakdown or how it was actually paid. */
  subtotalPaisa?: number;
  discountedSubtotalPaisa?: number;
  serviceChargePaisa?: number;
  taxPaisa?: number;
  roundingAdjustmentPaisa?: number;
  table?: { label: string } | null;
  /** Already returned by GET /api/orders — the kitchen ticket prints it as the time the order
   * reached the kitchen, which is what a cook reads first to know how long it has been waiting. */
  sentToKitchenAt?: string | null;
  payments?: { method: PaymentMethod; amountPaisa: number }[];
}
