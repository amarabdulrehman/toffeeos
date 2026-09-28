/**
 * The feature pages' content, one entry per page (/features/[slug]).
 *
 * Every statement here is about what the product does today, checked against the code when it was
 * written — not against the homepage, and not against what a competitor claims. Where a page would
 * naturally mention something ToffeeOS doesn't do, it says so under `limits`, or says nothing:
 * never PRA e-IMS integration, FBR digital invoicing, Foodpanda, Urdu or WhatsApp delivery (built,
 * not yet live), none of which exist today.
 *
 * Headings are the questions an owner asks, with the answer in the first sentence beneath — that is
 * what a search engine quotes, and what an assistant can cite.
 */

export interface FeatureSection {
  heading: string;
  /** The direct answer, one or two sentences, first thing under the heading. */
  answer: string;
  points?: string[];
}

export interface Feature {
  slug: string;
  /** Short name: breadcrumbs, links between pages, the features index. */
  name: string;
  /** The search term this page is written for. */
  keyword: string;
  title: string;
  description: string;
  /** One line for the features index. */
  summary: string;
  folio: string;
  h1: string;
  lead: string;
  sections: FeatureSection[];
  /** What it doesn't do — said plainly, so nobody finds out after buying. */
  limits: string[];
  /**
   * The gated modules this page's feature needs (keys of GATEABLE_MODULES in src/lib/tiers.ts);
   * empty when it's on every plan. The page states which plans include it from this, through
   * src/lib/marketing/plans.ts, rather than naming plans in the copy.
   */
  modules: string[];
  related: string[];
}

export const FEATURES: Feature[] = [
  {
    slug: "restaurant-pos-system",
    name: "Restaurant POS system",
    keyword: "restaurant POS system",
    title: "Restaurant POS System That Works Offline — ToffeeOS",
    description:
      "A restaurant POS that keeps taking orders and payments through internet outages, taxes cash and card correctly on one bill, and runs in a browser on a tablet.",
    summary: "Orders, bills and payments for dine-in, takeaway and delivery — and it keeps going when the internet stops.",
    folio: "POINT OF SALE",
    h1: "A restaurant POS system that keeps selling when the internet drops",
    lead:
      "ToffeeOS is a restaurant point of sale that runs in the browser on a tablet, phone or computer. It takes dine-in, takeaway and delivery orders, sends them to the kitchen and takes payment — and when the connection drops, it keeps taking orders and payments, and catches up when the line is back.",
    sections: [
      {
        heading: "What happens when the internet goes down?",
        answer:
          "The POS keeps working. Orders, payments and voids are saved on the device and sent to the server when the connection returns, each exactly once — every one carries a key the server recognises, so a retry can't turn one order into two.",
        points: [
          "Prices, tax, service charge and rounding are worked out on the device from the branch's own settings, so the total the cashier charges offline is the total the server records.",
          "A tablet that has opened the POS once can open it again with no connection.",
          "If someone changed the same order on another device in the meantime, the clash is set aside for a manager to settle, rather than one version quietly overwriting the other.",
          "Three things wait for the connection: the kitchen screen showing an order taken offline, adding another round to a table's existing order, and cancelling an order the kitchen already has.",
        ],
      },
      {
        heading: "How does it tax a bill paid partly in cash and partly by card?",
        answer:
          "Each part at its own rate. Tax rates are set per branch and per payment method; when one bill is paid with more than one, the taxable amount is shared out between them in proportion, and the parts always add up to the whole.",
        points: [
          "Before paying, the table can be given a bill that shows the total for each way of paying, each exactly what payment will then charge.",
          "Every amount is a whole number of paisa, so the receipt and the reports never disagree by a rounding error.",
          "Rounding happens once, at the end, the way the branch has chosen: none, to the nearest rupee, or to the nearest five.",
        ],
      },
      {
        heading: "What can staff do at the counter?",
        answer:
          "Everything a shift needs, each behind its own permission, so a waiter, a cashier and a manager each see only what their role allows.",
        points: [
          "Tables grouped by floor, each showing whether it is available, reserved or occupied; tap an occupied table to open its order. Dine-in, takeaway and delivery on the same screen.",
          "Discounts on a line or the whole order, with a ceiling per branch that only someone with permission can go past.",
          "Void one item or a whole order with a reason. Cancel an order the kitchen already has, with a reason a manager reviews.",
          "Switch dine-in to takeaway, merge two tables onto one bill, or sell an order without tax with the reason printed on the bill.",
          "Record how a bill was paid — cash, card, JazzCash, Easypaisa, bank transfer — and refund it later, off the reports and the cash drawer alike.",
        ],
      },
      {
        heading: "Do waiters and the counter stay in step?",
        answer:
          "Yes. An order placed on a waiter's phone pops up on every till that takes payment, with a chime, and the waiter is told the moment the kitchen marks it ready.",
        points: [
          "A branch can require the counter to approve waiter orders before they reach the kitchen: the cashier sends each one on or turns it away with a reason the waiter sees.",
          "The Order Queue shows this business day's orders; an unpaid order from an earlier day is kept at the foot rather than lost.",
        ],
      },
      {
        heading: "What does it print?",
        answer:
          "Receipts, bills and kitchen tickets, on any receipt printer the device can print to — 58 mm, 80 mm or any width you set.",
        points: [
          "The branch's address, phone and tax number, as you type them, at the top of every receipt, with your logo if you want it.",
          "Bills are stamped UNPAID and receipts PAID, so one can never be handed over as the other.",
        ],
      },
      {
        heading: "How is the cash drawer kept honest?",
        answer:
          "Each business day opens with a float and closes with a count, and the difference is there to see. Only someone allowed to (an owner or branch manager, by default) can correct a closed day's count, and each correction is logged with the figure it replaced. Opening the drawer without a sale is recorded with a reason.",
      },
    ],
    limits: [
      "It doesn't take card payments itself: the card machine stays separate, and the cashier records how the bill was paid.",
      "It doesn't split one bill between diners, and there's no tipping.",
      "Printing goes through the device's print dialog; there's no one-tap silent printing.",
    ],
    related: ["kitchen-display-system", "restaurant-inventory-management"],
    modules: [],
  },
  {
    slug: "kitchen-display-system",
    name: "Kitchen display system",
    keyword: "kitchen display system",
    title: "Kitchen Display System (KDS) for Restaurants — ToffeeOS",
    description:
      "A kitchen display that shows each order the moment it's sent, with add-ons and notes, a clock that flags late tickets, and ready alerts back to waiters.",
    summary: "Every order on a screen in the kitchen the moment it's sent, with a clock, add-ons, notes and a Ready button.",
    folio: "KITCHEN DISPLAY",
    h1: "A kitchen display system that shows the kitchen exactly what to make",
    lead:
      "ToffeeOS's kitchen display (KDS) is a screen in the kitchen — any tablet or monitor with a browser — that shows each order as a ticket the moment the counter or a waiter sends it, and lets the kitchen mark it ready.",
    sections: [
      {
        heading: "What does the kitchen see on each ticket?",
        answer:
          "The order number, whether it's dine-in, takeaway or delivery and for which table, every item with its add-ons and notes, and how long it has been waiting.",
        points: [
          "Add-ons and notes are on the ticket, not left behind at the counter — an extra shot or \"no onion\" reaches the person making it.",
          "An item voided after it was sent stays on the ticket, struck through, so the kitchen knows to stop making it.",
          "Where online or QR ordering is switched on, orders placed on the restaurant's own ordering site or from a QR code at the table arrive the same way as the counter's.",
        ],
      },
      {
        heading: "How does it show what's running late?",
        answer:
          "Each ticket carries a clock that starts when the order is sent. After ten minutes the ticket is marked late; when the kitchen marks it ready, the clock stops.",
      },
      {
        heading: "How does the kitchen mark food ready?",
        answer:
          "Tick items off one at a time as they're done, or mark the whole order ready at once. The waiter who placed it is told straight away — or the counter, for an online or QR order a customer placed.",
        points: [
          "A ticket marked ready by mistake can be recalled to the board.",
          "The board can be filtered by order type: dine-in, takeaway or delivery.",
        ],
      },
      {
        heading: "Do we still need printed kitchen tickets?",
        answer:
          "Only if you want them. Any ticket can be printed from the board, and a branch that runs its kitchen off printed tickets can switch the kitchen display off entirely; sending orders and printing tickets work the same either way.",
      },
    ],
    limits: [
      "The late mark comes at a fixed ten minutes; it can't yet be set per branch.",
      "There's one board per branch — no separate stations for the grill, the fryer or the bar.",
      "Orders reach the board through the server: an order taken on the POS during an internet outage appears in the kitchen when the connection returns.",
    ],
    related: ["restaurant-pos-system", "restaurant-inventory-management"],
    modules: [],
  },
  {
    slug: "restaurant-inventory-management",
    name: "Restaurant inventory management",
    keyword: "restaurant inventory management software",
    title: "Restaurant Inventory Management Software — ToffeeOS",
    description:
      "Restaurant stock that comes down as you sell: recipes deduct ingredients on every paid order, plus purchase orders, branch transfers and low-stock alerts.",
    summary: "Stock that comes down as you sell, purchase orders, transfers between branches and low-stock alerts.",
    folio: "INVENTORY",
    h1: "Restaurant inventory management that takes stock out as you sell",
    lead:
      "ToffeeOS keeps stock for each branch and each storeroom in it. Give a dish its recipe once, and every paid order takes that dish's ingredients out of stock by itself.",
    sections: [
      {
        heading: "How does stock go down as we sell?",
        answer:
          "Through recipes. Each dish can list the ingredients and quantities it uses; when an order is paid, those quantities come out of the branch's stock.",
        points: [
          "Each branch chooses which storeroom sales are taken from.",
          "Every movement — stock in, sales, adjustments, transfers — is kept in a record that is only ever added to, never edited.",
        ],
      },
      {
        heading: "How does stock come in?",
        answer:
          "Through purchase orders to your suppliers, or a quick stock-in. A purchase order goes from draft to approved to received, each step its own permission, and what's counted in is what arrived — not what was ordered.",
        points: [
          "The cost entered when stock arrives becomes that ingredient's current cost, which is what recipe costing uses.",
          "What arrives is counted into the purchases figure in the profit and loss report.",
        ],
      },
      {
        heading: "Can we move stock between storerooms or branches?",
        answer:
          "Yes. A transfer can go between storerooms or between branches, never for more than is on hand. Someone who isn't allowed to approve transfers can ask for one, and nothing moves until someone who is says yes.",
      },
      {
        heading: "What if a stock count is wrong?",
        answer:
          "Correct it with an adjustment and a reason. An adjustment made in error is undone by an equal and opposite one — nothing is deleted, and it can only be undone once.",
      },
      {
        heading: "How will we know something is running low?",
        answer:
          "Give each ingredient a low-stock level. Anything that falls below it is flagged as a low-stock alert on the dashboard.",
      },
      {
        heading: "Can it tell us what each dish costs to make?",
        answer:
          "Yes — the recipe cost report works out each dish's cost from its ingredients' latest purchase prices, and lists dishes by margin, worst first. An ingredient with no price yet is named, so a blank cost is never mistaken for a zero.",
      },
    ],
    limits: [
      "Stock comes out when an order is paid, not when it is cooked.",
      "Dish costs use each ingredient's most recent purchase price, not an average.",
      "Each ingredient is counted in one unit you choose (kg, litres, pieces); there's no converting between units, and no barcode scanning.",
    ],
    related: ["restaurant-pos-system", "kitchen-display-system"],
    modules: ["inventory", "recipe"],
  },
];

export function getFeature(slug: string): Feature | undefined {
  return FEATURES.find((f) => f.slug === slug);
}
