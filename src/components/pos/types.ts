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
  lines: { id: string; nameSnapshot: string; quantity: number; lineTotalPaisa: number; kitchenReady: boolean }[];
}
