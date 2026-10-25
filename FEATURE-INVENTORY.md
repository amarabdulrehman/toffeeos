# ToffeeOS feature inventory

**What ToffeeOS actually does, checked against the source code on 29 September 2026 (commit `d9dd08b`).**

This is the reference for anything shown to a client. Every capability below points at the file or
function it was checked in. Anything that couldn't be pointed at in the code isn't listed as a
capability. Where a feature stops short, the "Doesn't" line says exactly where, so nobody claims
the missing half.

**Status**
- **Live** — works end to end for a real restaurant in production today.
- **Partial** — works, with a named limitation that matters to a client.
- **Stubbed** — code exists but never does the real thing (not wired up, not configured, or
  unreachable from any screen). What's needed to make it real is stated.
- **Not built** — a restaurant owner might expect it; it isn't there.

**Plan** — Starter, Growth or Complete, as the app gates it (`MODULE_MIN_TIER` and
`GATEABLE_MODULES` in `src/lib/tiers.ts`). "Every plan" means ungated.

**Configurable** — who can change it: per restaurant (tenant), per branch, per device, only by
KRIMSOLS, or fixed in code.

---

## Summary

| Status | Count |
|---|---|
| Live | 64 |
| Partial | 17 |
| Stubbed | 2 |
| Not built | 11 |
| **Total** | **94** |

Counts are of the numbered entries below. The "settings that exist but do nothing" table lists
further stubbed fields, such as unused database columns, that aren't features in their own right.

### Found while building the demo restaurant

Using the app with a full month of realistic data turned up five faults in features already
counted above. They're recorded in their entries, the counts are unchanged, and none was fixed:

- Long Sales and Item-wise report ranges can time out (11.1). A risk at volume; not confirmed in
  production.
- Best sellers and Item-wise label a two-size dish with one size's name (11.1, 11.2).
- Two or more storerooms in a branch produce false "Low stock" rows (5.6).
- The rider's screen says "Ready for pickup" while the kitchen is still cooking (7.3).
- Tables sort as text, so G10 sits between G1 and G2 (2.1).

### Public claims this contradicts

These are on the live site today, or in the client PDF you described. None was fixed here.

**Update, 29 September:** items 1 to 4 are corrected in commit `02ea02f` (not deployed). The same
commit makes `e2e/public-claims.spec.ts` fail on each of them. It also found a sixth, still open:

6. **The terms and the privacy policy mention WhatsApp.** The terms list "optional WhatsApp
   messaging" among the features. The privacy policy describes customers ordering "via … WhatsApp",
   which never existed, and names Meta as a processor. They're left for the owner to revise as
   legal documents, and the test lists those exact sentences as pending.

1. **"Keeps taking orders and payments" offline** is now true for **cash only**. Since the
   28 September fix, the till refuses card and wallet payments while offline (see 1.14). The same
   wording appears on:
   - the homepage metadata and the POS feature page (title, description and lead);
   - the pricing page ("orders and payments that keep going when the internet drops");
   - `llms.txt` ("orders, payments and voids are saved on the device");
   - the homepage structured data description.

   The POS page's "Three things wait for the connection" list is also now incomplete: non-cash
   payments wait too.
2. **Online ordering page: "each dish with its description and photo".** Nothing in the app can
   set a dish photo (see 4.6), so no real restaurant's storefront shows one.
3. **"A rider app"**: resolved 11 October 2026. Riders added from the Riders screen sign in
   with phone and password (see 7.3), and the delivery page says so.
4. **Multi-branch wording**: resolved 11 October 2026. Staff switch branch from the menu, owners
   can open every branch, and a new branch copies the restaurant's tax rates (see 13.2, 13.3).
   Branches created before then with no tax rates still charge 0% until an owner adds them.
5. **The client PDF built from the phase plans** gives WhatsApp Business Messaging a page as a
   shipped feature (it's **Stubbed**, see 9.1) and says riders are "tracked" (**not built**, see 7.8).

### Tier check

Every feature listed under each plan on the pricing page exists and is gated as stated:
- **Starter:** point of sale & offline mode, kitchen display, tables grouped by floor, menu with
  variants & modifiers, sales & staff reports, staff roles & permissions, one branch.
- **Growth adds:** Inventory, Recipe & Costing, CRM (customers and loyalty), Expenses (with P&L),
  the Full Report Suite, and up to 3 branches.
- **Complete adds:** Delivery & Rider Management, Online Ordering (with QR ordering), Payroll & HR,
  and any number of branches.

Two qualifications:
- **The gate is each restaurant's own module list, not the plan.** `Subscription.enabledModules` is
  checked on every API call by `defineHandler` (`src/server/handler.ts`), and the menu hides
  modules that are off (`src/components/app-sidebar-nav.tsx`). The plan only sets the starting list.
  KRIMSOLS can switch any module on or off for one restaurant (`setTenantFeatures`,
  `src/server/platform.ts`), so a restaurant can differ from its plan.
- **WhatsApp Messaging is gated to Complete but isn't advertised,** correctly, since it's Stubbed.
- **Complete's Payroll & HR attendance is manual only** (12.3).

### Settings that exist but do nothing, or can't be changed

Check this list before promising a client they can change something:

| Setting | Where it lives | What's true |
|---|---|---|
| Kitchen "late" threshold | `BranchSettings.kdsSlaSeconds` | Ignored. The board uses a hardcoded 10 minutes (`SLA_SECONDS = 600`, `src/components/kds/kds-board.tsx`) |
| Currency | `BranchSettings.currency` | Never read or written. Everything is PKR (`formatPkr`, `src/lib/money.ts`) |
| Number format | `BranchSettings.locale` | Never read. Formatting is fixed to `en-PK` |
| Branch timezone | `Branch.timezone` | Read everywhere, but nothing can set it: always Asia/Karachi |
| Table position | `RestaurantTable.posX/posY` | Never read or written. There is no floor map |
| Table reserved / booked | `TableStatus.RESERVED/BOOKED` | Only the API can set them (`tables.changeStatus`); no screen does. The POS table picker still offers these filters |
| Dish photo | `MenuItem.imageUrl` | No screen, API or import can set it. The storefront would show it if set |
| Allergens | `MenuItem.allergens` | Stored and returned by the menu APIs, never shown. Allergen tracking was declined; never claim it |
| Delivery fee | `Order.deliveryFeePaisa` | Receipts and reports show it when above zero, but nothing sets a fee |
| Saved customer addresses | `CustomerAddress` (with lat/lng) | Table exists; no code uses it. Delivery addresses are typed per order |
| Per-person permissions | `Membership.grants/denies` | Enforced at sign-in, but no screen or API sets them |
| Staff PIN | `StaffPin` | Sign-in by PIN exists in code (`pinSchema`, `src/server/auth/config.ts`), but no screen sets a PIN and the sign-in page has no PIN option |
| Order "served" | `OrderStatus.SERVED`, `POST /api/orders/[id]/serve` | Route exists; no screen calls it |

---

## 1. At the counter (point of sale)

### 1.1 Taking an order — Live · Every plan
- **What it is:** Ring up dine-in, takeaway, delivery or "service" orders on one screen, and send
  them to the kitchen.
- **Does:** Tap items from the menu into a cart, pick the order type (and a table for dine-in, an
  address for delivery), send to the kitchen, or send and take payment in one step.
  `src/components/pos/pos-terminal.tsx` (`handleSendToKitchen`); `createOrder`, `sendToKitchen` in
  `src/server/orders.ts`.
- **Doesn't:** "Service" is only a fourth label, with its own kitchen filter and service-charge
  option and no special behaviour.
- **Configurable:** Fixed set of four order types.

### 1.2 Sizes, add-ons and notes on a line — Live · Every plan
- **What it is:** Choose a size, pick add-ons (e.g. extra cheese) and write a note ("no onion") for
  each item.
- **Does:** Variants change the price; add-on groups enforce their own minimum and maximum picks;
  notes and add-ons travel to the kitchen ticket, and survive an offline sync.
  `e2e/menu-options.spec.ts`, `e2e/offline-sync.spec.ts`.
- **Doesn't:** Add-ons don't take stock out (recipes are per dish, 5.1).
- **Configurable:** Per restaurant, in the menu.

### 1.3 Another round on an open order — Live · Every plan
- **What it is:** Add more items to a table that's already eating.
- **Does:** Tap an occupied table, add items; they go to the kitchen, and a ticket already marked
  ready goes back to cooking. `addLinesToOrder` in `src/server/orders.ts`.
- **Doesn't:** Needs the internet: refused offline with a message.
- **Configurable:** No.

### 1.4 Waiter orders and counter approval — Live · Every plan
- **What it is:** Waiters take orders on their phones; a branch can require the cashier to approve
  each before it reaches the kitchen.
- **Does:**
  - A waiter's order pops up on every till that takes payment, with a chime.
  - With approval on, the cashier sends it on or turns it away, and the waiter sees the reason.
  - `src/server/order-approvals.ts`, `src/components/pos/use-order-alerts.ts`.
- **Doesn't:** QR and online orders skip approval and go straight to the kitchen.
- **Configurable:** Per branch (`BranchSettings.waiterOrdersNeedApproval`).

### 1.5 Order Queue — Live · Every plan
- **What it is:** The list of today's orders at the till: what's open, what's ready, what's paid.
- **Does:**
  - Shows this business day's orders, per the branch's day-end time, plus orders punched offline
    and not yet synced.
  - An unpaid order from an earlier day is kept at the foot.
  - `GET /api/orders?day=today` (`src/app/api/orders/route.ts`); `loadQueue` in `pos-terminal.tsx`.
- **Doesn't:** Shows one branch only.
- **Configurable:** No.

### 1.6 Order alerts — Live · Every plan
- **What it is:** The till tells staff what's happening without anyone checking.
- **Does:**
  - Toasts and a chime for new orders from other devices, rounds added to tables, approvals, and
    orders marked ready.
  - A waiter hears about their own orders; the counter hears about customer orders.
  - `src/components/pos/use-order-alerts.ts`.
- **Doesn't:** Nothing is sent to phones outside the app.
- **Configurable:** Sound on/off per device.

### 1.7 Discounts — Live · Every plan
- **What it is:** Take money off a line or the whole bill, as a percentage or a fixed amount.
- **Does:**
  - Each branch sets a discount ceiling.
  - Going past it needs its own permission (`pos.discount.exceedMax`), and the server enforces
    the cap.
  - `exceedsDiscountCap` in `src/lib/pricing.ts`; `e2e/discount-cap.spec.ts`.
- **Doesn't:** No automatic promotions, happy hours or coupon codes.
- **Configurable:** Ceiling per branch (`BranchSettings.maxDiscountBasisPoints`).

### 1.8 Voids and cancellations — Live · Every plan
- **What it is:** Take an item or order off, with a reason.
- **Does:**
  - Void a line or a whole order with a reason.
  - One item (or some of a quantity) is voided straight from the table's order panel, or from
    **Void item** on its Order Queue card (24 October 2026); before, only inside Manage.
    `src/components/pos/void-line.tsx`.
  - Cancel an order the kitchen already has, with a reason a manager reviews on the dashboard.
  - Voided items stay on the kitchen ticket, struck through.
  - `voidOrder`, `cancelSentOrder` (`src/server/orders.ts`); `OrderCancellation`;
    `src/components/dashboard/cancellation-banner.tsx`.
- **Doesn't:** Cancelling a sent order needs the internet.
- **Configurable:** No.

### 1.9 Changing an order after it's punched — Live · Every plan
- **What it is:** Fix an order: make it takeaway, merge two tables, or sell it without tax.
- **Does:**
  - Switch dine-in and takeaway (frees or takes a table).
  - Merge another table's order onto this bill.
  - Mark an order tax-exempt, with the reason printed.
  - `src/server/order-changes.ts`, `src/components/pos/order-manage-dialog.tsx`.
- **Doesn't:**
  - Merging is refused when either order has a whole-bill discount, or only one is tax-exempt.
  - No moving an order straight to another table.
- **Configurable:** Each action is its own permission.

### 1.10 Tax by payment method — Live · Every plan
- **What it is:** Each branch sets tax rates per way of paying (e.g. cash 16%, card 8%), and a
  mixed cash-and-card bill is taxed correctly.
- **Does:**
  - The taxable amount is split between payment methods in proportion, each part at its own rate.
  - Two overlapping active rules are refused.
  - Sign-up creates the Punjab rates (16% cash, 8% card and digital) for the first branch.
  - `finalizeOrder`, `resolveTaxRate` (`src/lib/pricing.ts`); tax rules in
    `src/components/branches/branches-view.tsx`; `src/server/tenant-signup.ts`.
- **Doesn't:**
  - No FBR, PRA or other tax-authority reporting or integration.
  - **A branch with no tax rules charges 0%.** New branches copy the restaurant's rates (13.3);
    older branches made without any still need them added.
- **Configurable:** Per branch, from inside that branch.

### 1.11 Service charge — Live · Every plan
- **What it is:** An optional service charge on some order types.
- **Does:** Rate, which order types it applies to, and whether it is itself taxed.
  `computeServiceCharge` (`src/lib/pricing.ts`).
- **Doesn't:** One rate per branch; not per table or per party size.
- **Configurable:** Per branch.

### 1.12 Rounding — Live · Every plan
- **What it is:** Round the final bill to the nearest rupee or five.
- **Does:** None, nearest 1 or nearest 5, applied once at the end. `roundTotal`, `RoundingMode`.
- **Configurable:** Per branch.

### 1.13 Pre-payment bill — Live · Every plan
- **What it is:** Hand the table a bill before they pay.
- **Does:** Prints the bill stamped UNPAID, with the total for each way of paying (cash vs card),
  each exactly what payment will then charge. `src/server/bill.ts`,
  `src/components/pos/bill-dialog.tsx`.
- **Configurable:** No.

### 1.14 Taking payment — Live · Every plan
- **What it is:** Record how the customer paid.
- **Does:**
  - Cash, card, JazzCash, Easypaisa or bank transfer.
  - Split across several methods, with cash change worked out.
  - The server refuses a payment that falls short.
  - Offline, **cash only**: non-cash is refused with the reason (28 September).
  - `src/components/pos/payment-dialog.tsx`; `takePayment` (`src/server/orders.ts`).
- **Doesn't:**
  - **The cash-only rule only holds when the browser knows it's offline.** With the wifi up and
    the internet down, `navigator.onLine` stays true. There's no banner and Confirm stays enabled,
    and `handleConfirmPayment` queues the card when the request fails. Nothing reprices it, so it
    goes through at the cash-rate total. Checked on 29 September: a Rs 284 card bill was queued at
    Rs 305 and synced as paid Rs 305 against a total of Rs 284.
  - **Doesn't process any payment:** no card terminal or wallet integration. The card machine is
    separate and the cashier records the method.
  - An "Other" method exists in the data but isn't offered at the till.
- **Configurable:** No.

### 1.14b Editing a paid bill — Live · Every plan
- **What it is:** Correct the record of a paid bill without touching its items or amounts
  (24 October 2026). **Edit** on a paid order in the Order Queue.
- **Does:**
  - **Payment method:** re-records how it was paid, priced again at that method's tax rate, with a
    reason. Says what to give back or collect. Cashiers can do it for today while the drawer is
    open (`pos.payment.correct`); an earlier or counted day also needs
    `pos.cashDrawer.correctClose`.
  - **Customer:** adds one to a bill paid without one, with the points it earned (once only).
  - Both go on the order's history and the audit log. `src/server/paid-order-edits.ts`.
- **Doesn't:** Split-payment bills and bills with refunds can't have their method changed (refund
  and re-take instead). Items, prices and amounts never change after payment; that's Refund.
- **Configurable:** Permission-gated.

### 1.14a Complimentary — Live · Every plan
- **What it is:** Give items, or a whole bill, free (asked for by a café, 24 October 2026).
- **Does:**
  - A **Complimentary** button in the payment window, next to Split payment. Whole bill, or chosen
    items and how many of each; a reason is required (quick choices offered).
  - Not a payment method: a free item is priced at nothing and its menu value is kept apart
    (`OrderLine.compValuePaisa`). It's never counted as a sale or taxed, but stock still comes out.
  - A whole bill given free is settled at Rs 0 straight away, with no payment rows.
  - Shown as "FREE (Rs x)" on bills and receipts. Daily Sales, the closing slip and the cash
    drawer's takings show a "Complimentary" figure. The discounts & voids report lists who gave
    it and why.
  - Cashiers, branch managers and owners hold `pos.order.comp` by default.
  - `compOrderItems` (`src/server/order-changes.ts`), `/api/orders/[orderId]/comp`.
- **Doesn't:** Online only. No per-person limit on how much can be given.
- **Configurable:** Permission-gated.

### 1.15 Refunds — Live · Every plan
- **What it is:** Give money back on a paid bill.
- **Does:**
  - Any amount up to what was paid, by method, with a reason.
  - **Or by item** (24 October 2026): pick what came back and the amount is worked out on the
    server as those items' share of what was paid, discount, service charge and tax included. The
    dialog shows the figure first. An item can't be refunded twice (`OrderLine.refundedQuantity`).
    `src/lib/item-refund.ts`.
  - Refunds come off the sales figures, the P&L (with their tax) and, for cash, the drawer.
  - Loyalty points earned on the bill are taken back.
  - `src/app/api/orders/[orderId]/refund/route.ts`, `src/server/refunds.ts`.
- **Doesn't:** Money goes back outside the app.
- **Configurable:** Permission-gated.

### 1.16 Receipts — Live · Every plan
- **What it is:** The printed receipt.
- **Does:**
  - The branch's header text, the restaurant's logo (optional per branch), and PAID, PART PAID
    or UNPAID stamps.
  - The "ToffeeOS by Krimsols · @krimsols" credit line at the foot.
  - `src/components/pos/receipt.tsx`.
- **Doesn't:** No emailed or SMS receipts.
- **Configurable:**
  - Header and logo on/off: per branch.
  - Credit line: per restaurant, switchable **only by KRIMSOLS** (platform `receipt-credit`).

### 1.17 Kitchen tickets at the till — Live · Every plan
- **What it is:** Print the kitchen ticket from the counter, for kitchens without a screen.
- **Does:**
  - Print or reprint any order's kitchen ticket from the Order Queue.
  - **Add-on tickets.** Items added to an order already in the kitchen print on their own
    ticket, headed "ADD-ON TICKET … ADDED ITEMS ONLY" with the order number, so the first round
    isn't made again. It's offered when the items are added; a reprint can choose "Added items
    only" or "Whole order". The kitchen screen marks those lines ADDED.
  - `OrderLine.kitchenRound` counts each send; `src/components/kds/kot-dialog.tsx`.
- **Configurable:** No.

### 1.18 Printing and paper width — Partial · Every plan
- **What it is:** Receipts, bills, kitchen tickets and closing summaries on a receipt printer.
- **Does:** Prints on whatever printer the device can reach, at 58 mm, 80 mm or any width set on
  that device. `src/lib/print-ticket.ts`, `src/lib/paper-width.ts`.
- **Doesn't:**
  - **Every print goes through the browser's print dialog.** No silent one-tap printing, no direct
    printer driver, no cash-drawer kick.
- **Configurable:** Paper width per device.

### 1.19 Cash drawer — Live · Every plan
- **What it is:** Count the drawer in and out each business day.
- **Does:**
  - An opening float and a closing count per business day, with the difference shown.
  - Every no-sale opening is recorded with a reason.
  - A closed day's count can be corrected by an owner or branch manager (by default), each
    correction logged with the figure it replaced.
  - **The day's takings by every payment method side by side** (24 October 2026): cash, card,
    wallets, refunds per method, and complimentary. Shown beside the drawer, not counted in it; the
    card figure is for checking against the card machine's slip.
  - `src/server/cash-drawer.ts`, `src/app/api/cash-drawer/route.ts`.
- **Doesn't:** One drawer per branch, not per till.
- **Configurable:** No.

### 1.20 Offline mode — Partial · Every plan
- **What it is:** The till keeps working when the internet drops.
- **Does:**
  - A tablet that has opened the POS once opens it again with no connection (service worker).
  - The menu, tables and Order Queue are cached on the device.
  - New orders, cash payments and voids are saved on the device and sent once when the
    connection returns, each with a key so a retry can't double an order.
  - Prices are worked out on the device the same way as the server.
  - `src/lib/offline/*`, `public/sw.js`, `e2e/offline-sync.spec.ts`.
- **Doesn't (all wait for the connection):**
  - adding a round to an existing order;
  - cancelling an order the kitchen has;
  - **non-cash payments** — but only when the browser reports the outage (see 1.14: with the wifi
    up and the internet down, a card is taken at the cash-rate total);
  - the kitchen screen (an order taken offline reaches the kitchen screen only after sync).
- **Configurable:** No.

### 1.21 Sync conflict review — Live · Every plan
- **What it is:** When two devices changed the same order offline, a manager decides.
- **Does:** Conflicts (two orders for one table, a payment against an order that changed) are set
  aside for someone with `sync.conflict.resolve`, not silently overwritten.
  `src/server/sync-conflicts.ts`, `/app/sync-conflicts`.
- **Configurable:** No.

---

## 2. Tables

### 2.1 Floors and tables — Live · Every plan
- **What it is:** Set up each floor and its tables.
- **Does:**
  - Add, rename and delete floors; add tables with a label and seats, and rename or move them
    between floors.
  - A table with an open order, or a floor with tables, can't be deleted.
  - `src/server/tables.ts`, `src/components/tables/tables-settings-view.tsx`.
- **Doesn't:**
  - **No floor map**: tables are listed per floor (`posX/posY` are unused).
  - Tables sort as text, so G10 comes between G1 and G2 in the POS table picker.
- **Configurable:** Per branch.

### 2.2 Table status — Live · Every plan
- **What it is:** See which tables are free.
- **Does:**
  - A table becomes occupied when an order is punched on it, and free when it's paid, voided or
    cancelled.
  - Every device sees the change within a second or two.
  - Tapping an occupied table opens its order.
  - `setTableStatus`, `findActiveOrderForTable` (`src/server/tables.ts`).
- **Doesn't:** **Only free or occupied in practice** (see 2.3).
- **Configurable:** No.

### 2.3 Reservations and bookings — Not built
- Statuses `RESERVED` and `BOOKED` exist and the POS picker filters for them, but no screen can set
  them. No reservation book, times or deposits.

QR codes per table are covered under online ordering (8.2).

---

## 3. Kitchen

### 3.1 Kitchen display (KDS) — Live · Every plan
- **What it is:** A screen in the kitchen showing each order as a ticket.
- **Does:**
  - Tickets show the order number, type, table, items with add-ons and notes, and voided items
    struck through.
  - Updates live (realtime, with a 15-second poll behind it).
  - Filter by order type, search by number, print any ticket.
  - `src/components/kds/kds-board.tsx`.
- **Doesn't:**
  - **One board per branch.** No stations (grill, bar), no routing, no bump bar.
- **Configurable:** On/off per branch (`kdsEnabled`); off means printed tickets.

### 3.2 Late tickets — Partial · Every plan
- **What it is:** Tickets waiting too long turn red.
- **Does:** Each ticket's clock runs from when it was sent; after **10 minutes** it's marked late.
- **Doesn't:** **Fixed at 10 minutes.** `SLA_SECONDS = 600` in `kds-board.tsx`; the
  `BranchSettings.kdsSlaSeconds` column exists and is ignored.
- **Configurable:** No (hardcoded).

### 3.3 Marking food ready, and recall — Live · Every plan
- **What it is:** The kitchen marks items or the whole order ready.
- **Does:**
  - Tick items off one by one or bump the whole order.
  - The waiter who placed it is told; the counter is told for customer (online/QR) orders.
  - A ticket bumped by mistake can be recalled.
  - `markLineReady`, `markOrderReady` (`src/server/orders.ts`), `src/app/api/orders/[orderId]/recall`.
- **Configurable:** No.

### 3.4 Kitchen stations and routing — Not built
- No separate screens or tickets per station.

---

## 4. Menu

### 4.1 Categories, items and prices — Live · Every plan
- **What it is:** The menu everyone orders from.
- **Does:** Categories in a set order; items with a price and description.
  `src/components/menu/menu-view.tsx`, `src/app/api/menu-items/route.ts`.
- **Doesn't:** One menu for the whole restaurant (branches differ by price and availability only,
  4.3).
- **Configurable:** Per restaurant.

### 4.2 Sizes (variants) and add-on groups — Live · Every plan
- **What it is:** Small/large, extra toppings.
- **Does:** Variants adjust the price; add-on groups with minimum and maximum picks.
  `src/server/menu-options.ts`.
- **Configurable:** Per restaurant.

### 4.3 Per-branch price and availability — Live · Every plan
- **What it is:** A dish can cost more at one branch, or be off ("86'd") at another.
- **Does:** Branch price overrides and availability toggles, seen live by the till and the online
  menu. `BranchMenuItem`, `src/server/branch-prices.ts`.
- **Configurable:** Per branch.

### 4.4 Menu import from a spreadsheet — Live · Every plan
- **What it is:** Load a menu from a CSV file.
- **Does:** Adds new items and updates prices, sizes and descriptions of existing ones; never
  deletes. `src/server/menu-import.ts`, `src/lib/menu-import-plan.ts`.
- **Doesn't:** CSV only (not Excel); no photos.
- **Configurable:** No.

### 4.5 Keep a dish off the online and QR menus — Live · Complete
- **What it is:** A dish sold at the counter but not online.
- **Does:** `MenuItem.isAvailableOnline`; the storefront hides it and the server refuses it.
  `assertAllOnline` (`src/server/online-ordering.ts`).
- **Configurable:** Per restaurant.

### 4.6 Dish photos — Not built
- The storefront shows a photo if `MenuItem.imageUrl` is set, but no screen, API or import can set
  it. Needs an upload in the menu editor (Supabase Storage, as logos use).

### 4.7 Allergens — Not built (declined)
- A field exists and is stored; nothing shows it. Declined as a feature, so never claim it.

---

## 5. Stock (inventory) — Growth

### 5.1 Ingredients and storerooms — Live · Growth
- **What it is:** What you keep in stock, and where.
- **Does:**
  - Ingredients with a unit (kg, litres, pieces).
  - Storerooms (stock locations) per branch, with stock levels per storeroom.
  - `src/server/inventory.ts`.
- **Doesn't:** No unit conversion (buy in cartons, use in grams); no barcode scanning.
- **Configurable:** Per branch.

### 5.2 Stock in (goods received) — Live · Growth
- **What it is:** Record deliveries.
- **Does:** Quantity in, with its cost; the latest cost becomes the ingredient's current cost.
  `recordGrn`.
- **Configurable:** No.

### 5.3 Suppliers and purchase orders — Live · Growth
- **What it is:** Order from suppliers and receive what arrived.
- **Does:** Suppliers; purchase orders go draft → approved → received (or cancelled), each step
  its own permission; what's received is what arrived. `src/server/purchasing.ts`.
- **Doesn't:** Nothing is sent to suppliers (no email or WhatsApp of POs).
- **Configurable:** No.

### 5.4 Adjustments and undo — Live · Growth
- **What it is:** Correct a count.
- **Does:** Every adjustment needs a reason. A wrong one is undone by an opposite entry, once;
  nothing is deleted. `recordAdjustment`, `reverseAdjustment`.
- **Configurable:** No.

### 5.5 Transfers and transfer requests — Live · Growth
- **What it is:** Move stock between storerooms or branches.
- **Does:**
  - Never more than is on hand.
  - Someone without approval rights can ask; nothing moves until approved.
  - `recordTransfer`, `StockTransferRequest`.
- **Configurable:** No.

### 5.6 Low-stock alerts — Partial · Growth
- **What it is:** Know when something is running low.
- **Does:**
  - A low-stock level per ingredient, judged on the **branch's total across its storerooms**
    (since 11 October 2026). Crossing it raises one alert on the dashboard; a delivery clears it.
  - Moving stock between storerooms (main store to kitchen) neither raises nor clears an alert.
  - The stock report lists an ingredient in each storeroom that keeps it, with the branch total.
  - `applyStockDelta`, `stockReport` (`src/server/inventory.ts`),
    `src/components/dashboard/low-stock-banner.tsx`; `e2e/low-stock-storerooms.spec.ts`.
- **Doesn't:**
  - **No message is sent.** The WhatsApp low-stock alert is Stubbed (9.1).
  - No separate level per storeroom (e.g. "keep 3 kg in the kitchen").
  - Changing an ingredient's level doesn't re-check it until stock next moves.
- **Configurable:** Level per ingredient.

### 5.7 Stock count stocktake sheet — Not built
- No count sheet or variance report; counts are entered as adjustments.

---

## 6. Recipes and costing — Growth

### 6.1 Recipes that take stock out — Live · Growth
- **What it is:** Each dish uses ingredients; selling it takes them out of stock.
- **Does:**
  - Recipe quantities come out when the order is **paid**, from the branch's chosen storeroom.
  - Dishes with no recipe are marked "No recipe".
  - `deductForOrder` (`src/server/recipes.ts`).
- **Doesn't:**
  - Recipes are per dish: sizes and add-ons don't change deduction.
  - Nothing comes out for orders that are voided or never paid.
- **Configurable:** Storeroom per branch (`defaultStockLocationId`).

### 6.2 Dish cost and margin — Live · Growth
- **What it is:** What each dish costs to make and what you keep.
- **Does:**
  - Cost is the ingredients' latest purchase prices × quantities, rounded once.
  - Margin in rupees and percent, thinnest first; unpriced ingredients are named.
  - `recipeCostReport`.
- **Doesn't:**
  - Uses the dish's base price, not branch prices or sizes.
  - Uses the latest purchase at any branch, not an average or per-branch cost.
- **Configurable:** Seeing margins is its own permission.

---

## 7. Delivery — Complete

### 7.1 Delivery orders — Live · Complete
- **What it is:** Orders to be delivered, from the till or the online site.
- **Does:** Order type Delivery with a typed address; lands on the delivery board.
  `listDeliveryBoard` (`src/server/delivery.ts`).
- **Doesn't:** Addresses aren't saved to the customer (7.9).
- **Configurable:** No.

### 7.2 Assigning riders — Live · Complete
- **What it is:** Give each delivery to a rider.
- **Does:** Assign from the delivery board. Reassigning an already-assigned order is a separate
  permission. `assignRider`.
- **Configurable:** No.

### 7.3 Rider app — Live · Complete
- **What it is:** The rider's own screen on their phone.
- **Does:** Only their orders, oldest first, with items, customer name, tap-to-call number and
  address; mark picked up, then delivered. `src/components/rider/rider-orders-view.tsx`.
- **Doesn't:**
  - No sign-in codes by text message in production (no sender). Riders sign in at `/rider/login`
    with restaurant, phone and a password the Riders screen issues (shown once; Reset password
    makes a new one and signs them out). Riders added before 11 October 2026 need a reset first.
  - An order handed to a rider says **"Ready for pickup"** on their screen as soon as it's
    assigned, even while the kitchen is still cooking it.
- **Configurable:** No.

### 7.4 Proof of delivery — Partial · Complete
- **What it is:** Prove each drop-off.
- **Does:** The rider takes a photo at the door, stored privately with the order. An order can't be
  marked delivered without proof. `markDelivered`.
- **Doesn't:**
  - **The handoff-code option can't be used.** A 4-digit code is generated on assignment, but no
    page, receipt or message gives it to the customer.
  - To make it real, show it on the bill or send it (needs a sender).
- **Configurable:** No.

### 7.5 Cash on delivery — Live · Complete
- **What it is:** Rider brings the cash back.
- **Does:** A delivered unpaid order stays owed. The counter records the rider's cash in one step,
  in cash, for the whole bill. A prepaid order stays paid on delivery.
  `settle-delivery` route, `markDelivered`.
- **Configurable:** No.

### 7.6 Rider performance — Live · Complete
- **What it is:** How each rider is doing.
- **Does:** Completed deliveries and average time from assignment to delivery, per rider, for any
  dates. `riderPerformanceReport`.
- **Configurable:** No.

### 7.7 Delivery fees — Not built
- `Order.deliveryFeePaisa` exists, and receipts and reports show it when set, but nothing sets a fee.
  Needs a per-branch delivery fee setting fed into the pricing context.

### 7.8 Live rider tracking / map — Not built
- No location is recorded. Riders are **not** tracked.

### 7.9 Saved customer addresses, delivery zones — Not built
- `CustomerAddress` (with latitude and longitude) exists and nothing uses it. No zones or distance
  pricing.

### 7.10 Third-party delivery apps — Not built
- No integration with any delivery marketplace.

---

## 8. Online ordering and QR — Complete

### 8.1 The restaurant's own ordering site — Live · Complete
- **What it is:** `toffeeos.com/order/<restaurant>`: customers order for pickup or delivery.
- **Does:**
  - The restaurant's logo and colour, and a choice of branch.
  - The same menu, branch prices and live availability as the till, with sizes and add-ons.
  - Name and phone (address for delivery) at checkout.
  - The order goes straight to the kitchen and the Order Queue, labelled online, with the counter
    alerted, and is matched to a customer record by phone.
  - `getStorefront`, `getPublicMenu`, `placeOnlineOrder` (`src/server/online-ordering.ts`);
    `src/app/order/[tenantSlug]/page.tsx`.
- **Doesn't:**
  - **No online payment**: pay on pickup or delivery.
  - No ordering ahead for a later time.
  - No accept/decline step: an order that can't be made is cancelled at the till.
  - No customer accounts.
  - **No dish photos** (4.6).
  - No per-order fee (a pricing policy, not code).
- **Configurable:** Branding per restaurant (logo, colour); dish visibility per item.

### 8.2 QR table ordering — Live · Complete
- **What it is:** A QR code on each table; guests order from their phone.
- **Does:**
  - Each table's code downloads as a PNG from the tables screen.
  - A guest's order joins the table's open order, or starts one, and goes straight to the kitchen.
  - Name and phone are optional.
  - `placeQrOrder`; QR in `tables-settings-view.tsx`.
- **Doesn't:**
  - Guests can't pay from the phone.
  - Skips waiter approval.
- **Configurable:** No.

---

## 9. Messages to customers and owners

### 9.1 WhatsApp messaging — Stubbed · Complete (not advertised)
- **What it is:** Automatic WhatsApp messages: thank-you after an order or payment, delivery picked
  up and delivered, a daily sales summary to the owner, low-stock alerts, win-back messages.
- **Does:**
  - Settings screen with each message type's switch.
  - Triggers are wired in (`src/server/whatsapp/triggers.ts`), and a message log.
  - Sends through Meta's WhatsApp Cloud API (`sendWhatsAppCloudMessage`).
- **Doesn't:**
  - **No message has ever been delivered.** With no platform access token and no restaurant phone
    number id, every send is logged "skipped – not configured", never "sent".
- **Needed to make it real:**
  - A Meta WhatsApp Business account and a platform `WHATSAPP_ACCESS_TOKEN` (not set in production).
  - Each restaurant's business phone number id.
  - Message templates approved by Meta.
- **Configurable:** Per restaurant switches.

### 9.2 Email to staff (password reset, welcome) — Partial · Every plan
- **What it is:** "Forgot password" emails and the sign-up welcome.
- **Does:** Sent through Resend when configured. `src/server/email/adapter.ts`,
  `src/server/password-reset.ts`.
- **Doesn't:**
  - **Production uses Resend's sandbox sender** (`onboarding@resend.dev`), which only delivers to
    the Resend account owner, so real restaurants' staff don't receive these.
- **Needed:** A verified sending domain in Resend, and `EMAIL_FROM` changed to it.
- **Configurable:** No.

### 9.3 Receipts by SMS or email — Not built

---

## 10. Customers and loyalty — Growth (CRM)

### 10.1 Customer records — Live · Growth
- **What it is:** Who your customers are.
- **Does:**
  - Name, phone, email and points.
  - Created or matched by phone at the till and from online and QR orders.
  - Search and profile view.
  - `src/server/crm.ts`, `src/components/crm/customers-view.tsx`.
- **Doesn't:** No saved addresses (7.9); no marketing sends.
- **Configurable:** No.

### 10.2 Inactive customers list — Partial · Growth
- **What it is:** Who hasn't ordered in a while.
- **Does:** Lists customers with no order in N days (default 30). `/api/customers/inactive`.
- **Doesn't:** The win-back message it was built for is Stubbed (9.1).
- **Configurable:** Days per query.

### 10.3 Loyalty points — Live · Growth
- **What it is:** Customers earn points and spend them as a discount.
- **Does:**
  - Points per 100 rupees paid; each point's value.
  - Redeem at the till.
  - Given back on a void, taken back on a refund; manual adjustments by permission.
  - `src/server/loyalty.ts`, `src/server/loyalty-ledger.ts`, `e2e/back-office.spec.ts`.
- **Doesn't:** No tiers or expiry.
- **Configurable:** Per restaurant (`LoyaltyProgram`: on/off, earn and value rates).

---

## 11. Reports and the dashboard

### 11.1 Sales reports — Live · Every plan
- **What it is:** What you sold.
- **Does:**
  - For any date range:
    - the revenue trend;
    - sales by branch, category and payment method;
    - every transaction;
    - item-wise sales;
    - staff performance per person per day.
  - Anyone allowed can download CSV.
  - Owners see every branch; managers see their own.
  - `src/server/reports.ts`, `src/components/reports/reports-view.tsx`.
- **Doesn't:**
  - Reports aren't sent anywhere on a schedule.
  - **May fail on long ranges at a busy restaurant.** The Sales and Item-wise tabs load every paid
    order in the range with its lines (Sales also its payments), inside one database transaction
    capped at 10 seconds (`salesReport` and `itemWiseReport`, `src/server/reports.ts`;
    `TENANT_TX_OPTIONS`, `src/server/db.ts`).
    - The demo restaurant does about 75 orders a day. Run locally against the development
      database, Sales failed with "Internal error" for 14 days and for the month, and took 9.9 s
      for 7 days (failing on a retry). Item-wise failed for the month; P&L for the month worked (16 s).
    - Much of that is the distance between this PC and the database: a single count took 0.5 s.
      Production hosting sits far closer, so this is a risk at volume, **not a confirmed production
      failure**. It hasn't been measured there.
  - **Item-wise mislabels dishes sold in more than one size**, as Best sellers does (11.2): one row
    per dish, named after whichever size came first (`itemWiseReport`).
- **Configurable:** No.

### 11.2 Daily sales and closing summary — Live · Every plan
- **What it is:** Today's takings and the end-of-day slip.
- **Does:**
  - Today, a week, or a day inside it, per branch or all branches, each on its own business day.
  - Prints a closing summary on the receipt printer.
  - `src/server/daily-sales.ts`, `src/components/sales/closing-slip.tsx`.
- **Doesn't:**
  - **"Best sellers" mislabels dishes sold in more than one size.** Both sizes are added into one
    row, named after whichever size came first (`byItem` in `src/server/daily-sales.ts` keys on the
    dish but takes the line's name). The demo showed "Mutton Karahi (Half) — 12, Rs 55,260",
    Half and Full plates together.
  - Online and QR orders are listed as **"Unknown"** under "By staff", because no staff member
    rang them up.
- **Configurable:** Business-day end per branch (`dayStartMinutes`).

### 11.3 Dashboard — Live · Every plan
- **What it is:** The first screen in the back office.
- **Does:** A sales overview that switches period, the low-stock banner and the cancellation
  review banner. `src/app/app/dashboard/page.tsx`.
- **Configurable:** No.

### 11.4 Full report suite — Live · Growth
- **What it is:** Audit and stock reports.
- **Does:** Discount & void audit (who, what, why); order cancellations with reasons; stock
  valuation. `GROWTH_REPORT_KEYS` (`src/lib/tiers.ts`).
- **Configurable:** No.

### 11.5 Profit and loss — Live · Growth (Expenses)
- **What it is:** Did you make money?
- **Does:**
  - Cash basis:
    - takings without sales tax, less refunds and their tax;
    - less stock bought (not used);
    - less salaries paid out;
    - less approved expenses, by category.
  - Purchases entered without a cost are counted and flagged.
  - `pnlReport` (`src/server/reports.ts`).
- **Doesn't:** Not accrual accounting; no balance sheet or tax return.
- **Configurable:** No.

### 11.6 Scheduled or emailed reports — Not built
- The daily summary exists only as a WhatsApp message (Stubbed, 9.1).

---

## 12. Staff and payroll

### 12.1 Inviting staff — Partial · Every plan
- **What it is:** Give someone access.
- **Does:**
  - An owner or manager makes an invitation with an email address, a role and a branch, and
    copies its link.
  - The person sets a password and joins. Links expire in 7 days.
  - `src/server/staff-invites.ts`.
- **Doesn't:** **Invitations aren't emailed.** You send the link yourself.
- **Configurable:** No.

### 12.2 Roles and permissions — Live · Every plan
- **What it is:** Who can do what.
- **Does:**
  - Six provided roles (owner, branch manager, cashier, waiter, kitchen, rider) and your own
    custom roles, each a set of permissions, one per action.
  - Change someone's role or deactivate them; a role in use can't be deleted.
  - `src/server/roles.ts`, `src/server/permissions/registry.ts`, `src/components/staff/*`.
- **Doesn't:** **One-off grants or denials for a single person can't be set** (fields exist and are
  enforced, nothing writes them).
- **Configurable:** Per restaurant.

### 12.3 Attendance — Partial · Complete
- **What it is:** Who worked when.
- **Does:**
  - A manager enters clock-in and clock-out times with a note; each entry records who made it.
  - Staff can clock themselves out.
  - `recordManualAttendance` (`src/server/hr.ts`).
- **Doesn't:**
  - **No automatic clock-in.** It rides on PIN sign-in, which can't be set up (12.6).
  - Entries can't be edited after the fact, only added.
- **Configurable:** No.

### 12.4 Shifts — Live · Complete
- **What it is:** Plan who's on.
- **Does:** Assign shifts per person per branch; see them by date. `createShift`, `listShifts`.
- **Doesn't:** No swap requests or notifications.
- **Configurable:** No.

### 12.5 Payroll, payslips and payouts — Live · Complete
- **What it is:** Work out and record pay.
- **Does:**
  - For any dates:
    - monthly staff get their salary;
    - hourly staff get hours × rate, with optional weekly overtime.
  - Payslips per person; record each payout (when, how), which feeds the P&L salaries line.
  - `runPayroll`, `getPayslip`, `recordDisbursement`.
- **Doesn't:** **Gross pay only.** No tax, EOBI or advance deductions; sends no money.
- **Configurable:** Pay per person per branch; overtime threshold and rate per branch.

### 12.6 Staff PIN sign-in and PIN clock-in — Stubbed
- **What exists:** PIN sign-in and the automatic clock-in are in `src/server/auth/config.ts`.
- **Why it's unusable:** No screen sets a PIN (`hashPin` is used only by the seed), and the sign-in
  page has no PIN option.
- **Needed:** A PIN field on the staff screen and a PIN keypad on the sign-in page.

### 12.7 Signing in — Partial · Every plan
- **What it is:** Staff and owners signing in.
- **Does:**
  - Email and password, with a forced password change after a temporary one.
  - Sessions end everywhere when a password is changed or reset.
  - `src/server/auth/config.ts`, `src/server/session-revocation.ts`.
- **Doesn't:**
  - Password-reset emails don't reach real users (9.2).
  - **No branch choice**: everyone lands in their first branch (13.2).
  - Phone sign-in is off in production (7.3).
- **Configurable:** No.

---

## 13. Branches

### 13.1 Adding branches, within the plan's limit — Live · Growth and Complete
- **What it is:** Run more than one location.
- **Does:**
  - Create branches up to the plan's limit (1, 3 or any), enforced on creation and reactivation.
  - Deactivate a branch.
  - `createBranch` (`src/server/branches.ts`).
- **Configurable:** Limit per plan (`TIER_MAX_BRANCHES`).

### 13.2 Working across branches — Live · Growth and Complete
- **What it is:** Owners and managers running several branches.
- **Does:**
  - Staff hold a role at each branch they work at.
  - Reports show all branches together or one at a time.
  - Stock transfers between branches (Growth).
  - A Branch picker in the back-office sidebar for anyone in more than one branch
    (`src/components/branch-switcher.tsx`). Owners can open every active branch, joining it as
    owner the first time (`joinBranchAsOwner`). Blocked while offline actions wait to sync.
- **Doesn't:** Sign-in still opens a person's first branch, and settings and tax rates save to the
  branch the session is on, so an owner switches there first.

### 13.3 A new branch's starting setup — Live
- **Does:** Default settings; the tax rates of the restaurant's oldest branch that has any (PRA
  defaults otherwise); a "Main Store" stock location; every owner and its creator as members.
- **Doesn't:** Branches created before 11 October 2026 with no tax rates still charge 0% until
  someone adds them.

### 13.4 Per-branch settings — Live · Every plan
- **Does:**
  - Service charge and rounding.
  - Business-day end.
  - Discount ceiling.
  - Receipt header and logo.
  - Kitchen display on/off.
  - Waiter approval.
  - Default storeroom.
  - Overtime.
  - Tax rules.
  - `src/components/branches/branches-view.tsx`.
- **Doesn't:** Timezone, currency and number format can't be changed (see the settings table).
- **Configurable:** Per branch, from inside the branch.

---

## 14. The restaurant's account

### 14.1 Sign-up and free trial — Partial · Starter
- **What it is:** A restaurant signs itself up.
- **Does:** Creates the restaurant, its first branch (with Punjab tax rates), the owner and a
  14-day trial on **Starter**; asks for no card. `src/server/tenant-signup.ts`.
- **Doesn't:** The welcome email doesn't arrive (9.2). Growth or Complete trials are only set up by
  KRIMSOLS.
- **Configurable:** No.

### 14.2 Billing page — Live · Every plan
- **What it is:** The restaurant sees its plan.
- **Does:** The plan and the branch allowance, with no prices. `src/app/app/billing/page.tsx`.
- **Doesn't:** No online payment of the subscription; nothing is invoiced automatically.
- **Configurable:** No.

### 14.3 Branding — Live · Every plan (colour: Complete)
- **What it is:** The restaurant's logo and colour.
- **Does:**
  - Upload a logo from the branch settings screen (every plan) or the Online Ordering screen. It
    goes on receipts (switched on automatically the first time) and the storefront.
  - The storefront colour is set on the Online Ordering screen (Complete).
  - `updateBranding` (`src/server/online-ordering.ts`), `branches-view.tsx`.
- **Configurable:** Per restaurant.

---

## 15. KRIMSOLS platform administration

### 15.1 Tenant management — Live
- **Does:**
  - Every restaurant with MRR metrics.
  - Per restaurant:
    - change plan;
    - switch individual modules;
    - set a negotiated monthly price;
    - record subscription payments;
    - switch the receipt credit line;
    - change status;
    - reset the owner's password;
    - impersonate;
    - delete.
  - `src/server/platform.ts`, `/platform/tenants`.
- **Doesn't:** **No automatic subscription billing or payment collection.** Payments are recorded
  by hand.

### 15.2 Platform sign-in with two-factor — Live
- **Does:** Email and password plus TOTP codes for platform staff; password reset.
  `src/server/platform-mfa.ts`.

### 15.3 Impersonation — Live
- **Does:** A platform admin opens a restaurant as its user, logged in the audit log.

### 15.4 Audit log — Partial
- **Does:** Many actions are written to `AuditLog`: payments, refunds, drawer corrections, role
  changes, impersonation and more.
- **Doesn't:** **Only KRIMSOLS can read it** (the last 20 per restaurant, on the platform page). A
  restaurant has no activity log screen.

---

## 16. Reliability and security

### 16.1 Keeping each restaurant's data separate — Live
- App-layer tenant filter plus Postgres row-level security (`src/server/db.ts`, RLS migrations);
  `e2e/tenant-isolation.spec.ts`.

### 16.2 Daily backups — Partial
- **Does:** A nightly job exports the whole database to Supabase Storage, keeping 14 days
  (`/api/cron/backup`, `src/server/backup.ts`).
- **Doesn't:** **A restore has never been tested.**

### 16.3 Rate limits, security headers, CSP — Live
- `src/lib/rate-limit.ts`, `next.config.ts`.

### 16.4 Error monitoring — Partial
- Sentry on the server. **Not in the browser:** no browser DSN is set, so errors on tills and
  tablets aren't reported.

### 16.5 Live updates between devices — Live
- Supabase Realtime channels with polling behind them (`src/lib/realtime-client.ts`,
  `src/server/realtime.ts`).

### 16.6 Recurring expenses job — Live
- The nightly job also creates each month's recurring expenses (`/api/cron/daily-summary`,
  `src/lib/recurrence.ts`).

---

## 17. Expenses — Growth

### 17.1 Recording and approving expenses — Live · Growth
- **What it is:** Spending: rent, gas, repairs.
- **Does:** Expenses by category, with vendor, method and note. Approval moves them from pending to
  approved, and only approved ones count in the P&L. Default categories on sign-up.
  `src/server/expenses.ts`.
- **Doesn't:** No receipt photo attachment.
- **Configurable:** Categories per restaurant.

### 17.2 Recurring expenses — Live · Growth
- **What it is:** Monthly costs entered once.
- **Does:** A template with a day of the month creates each month's expense automatically (nightly
  job).
- **Configurable:** Per branch.

---

## Not built, in one place

Owners may assume these exist; they don't:
- Card or wallet payment processing (1.14)
- Reservations or bookings (2.3)
- Kitchen stations or routing (3.4)
- Dish photos (4.6)
- Allergens (4.7)
- Stocktake count sheets (5.7)
- Delivery fees (7.7)
- Live rider tracking (7.8)
- Saved addresses and delivery zones (7.9)
- Third-party delivery apps (7.10)
- Receipts by SMS or email (9.3)
- Scheduled reports (11.6)
- Splitting a bill between diners, and tipping (declined)
- FBR, PRA e-IMS or other tax-authority integration
- Urdu interface
