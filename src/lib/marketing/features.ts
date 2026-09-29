import { TIER_LABEL, TIER_MAX_BRANCHES, TIER_ORDER } from "@/lib/tiers";

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
  /** Set when this part needs more than the page's own plan: the section then states which plans
   * include it, worked out from the tiers (plansSentence), never typed. */
  modules?: string[];
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
  /** How many branches the feature needs to mean anything (multi-branch: 2); the plans that allow
   * that many come from TIER_MAX_BRANCHES. */
  branches?: number;
  related: string[];
}

/** "Starter runs one branch, Growth up to 3, and Complete any number", from TIER_MAX_BRANCHES, the
 * limit the app enforces, never typed. */
const BRANCH_COUNTS = (() => {
  const parts = TIER_ORDER.map((t) => {
    const max = TIER_MAX_BRANCHES[t];
    return `${TIER_LABEL[t]} ${max === null ? "any number" : max === 1 ? "runs one branch" : `up to ${max}`}`;
  });
  return `It depends on the plan: ${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}.`;
})();

export const FEATURES: Feature[] = [
  {
    slug: "restaurant-pos-system",
    name: "Restaurant POS system",
    keyword: "restaurant POS system",
    title: "Restaurant POS System That Works Offline — ToffeeOS",
    description:
      "A restaurant POS that takes orders and cash payments through internet outages, taxes cash and card correctly on one bill, and runs in a browser on a tablet.",
    summary: "Orders, bills and payments for dine-in, takeaway and delivery — and it keeps taking orders and cash when the internet stops.",
    folio: "POINT OF SALE",
    h1: "A restaurant POS system that keeps selling when the internet drops",
    lead:
      "ToffeeOS is a restaurant point of sale that runs in the browser on a tablet, phone or computer. It takes dine-in, takeaway and delivery orders, sends them to the kitchen and takes payment — and when the connection drops, it keeps taking orders and cash payments, and catches up when the line is back.",
    sections: [
      {
        heading: "What happens when the internet goes down?",
        answer:
          "The POS keeps working. Orders, cash payments and voids are saved on the device and sent to the server when the connection returns, each exactly once — every one carries a key the server recognises, so a retry can't turn one order into two.",
        points: [
          "Prices, tax, service charge and rounding are worked out on the device from the branch's own settings, so the total the cashier charges offline is the total the server records.",
          "A tablet that has opened the POS once can open it again with no connection.",
          "If someone changed the same order on another device in the meantime, the clash is set aside for a manager to settle, rather than one version quietly overwriting the other.",
          "Three things wait for the connection: the kitchen screen showing an order taken offline, adding another round to a table's existing order, and cancelling an order the kitchen already has.",
          // Not "non-cash payments wait": the till only holds them back when the browser reports the
          // outage. With the wifi up and the internet down it takes a card at the cash-rate total.
          "Offline, take payment in cash. Card and wallet payments are taxed at their own rate, and the till prices that through the server, so take them once the connection is back.",
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
          "Tables grouped by floor, each showing whether it is free or occupied; tap an occupied table to open its order. Dine-in, takeaway and delivery on the same screen.",
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
    related: ["kitchen-display-system", "table-and-floor-management", "restaurant-inventory-management", "restaurant-reports-and-analytics"],
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
    related: ["restaurant-pos-system", "restaurant-online-ordering-system", "restaurant-inventory-management"],
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
    related: ["recipe-costing-software", "restaurant-pos-system", "multi-branch-restaurant-management"],
    modules: ["inventory", "recipe"],
  },
  {
    slug: "recipe-costing-software",
    name: "Recipe costing",
    keyword: "recipe costing software",
    title: "Recipe Costing Software for Restaurants — ToffeeOS",
    description:
      "See what each dish costs to make, from its recipe and your latest purchase prices, and the margin on every plate, with the thinnest margins listed first.",
    summary: "What each dish costs to make, from its recipe and what you last paid, and the margin on every plate.",
    folio: "RECIPE COSTING",
    h1: "Recipe costing that shows the margin on every plate",
    lead:
      "Give each dish its recipe once: the ingredients, and how much of each one plate uses. ToffeeOS works out what the dish costs to make from what you last paid for those ingredients, and how much of its menu price you keep.",
    sections: [
      {
        heading: "How is a dish's cost worked out?",
        answer:
          "From its recipe and your purchase prices. Each ingredient costs what its most recent delivery cost per unit; the dish costs the sum of each ingredient's quantity times that price, rounded once at the end.",
        points: [
          "A delivery at a new price becomes the new cost straight away, for every dish that uses the ingredient.",
          "An ingredient that has never arrived with a price is named, and the dish shows no cost rather than a wrong one.",
        ],
      },
      {
        heading: "What does the margin report show?",
        answer:
          "Every dish on the menu with its price, its cost and its margin, in rupees and as a percentage, with the thinnest margins first — the dishes to look at before any other.",
        points: [
          "A dish without a recipe yet is marked, on the report and on the menu screen, so a missing cost is never read as zero.",
        ],
      },
      {
        heading: "Does the recipe take stock out too?",
        answer:
          "Yes. When an order is paid, each dish's recipe quantities come out of the branch's stock, so the recipe you cost from is the same one that runs your storeroom.",
      },
      {
        heading: "Who can see costs and margins?",
        answer:
          "Only people whose role allows it. Seeing costs and margins is its own permission, separate from viewing or editing recipes, so the kitchen can keep recipes up to date without seeing the margins.",
      },
    ],
    limits: [
      "A recipe belongs to the dish: a size or an add-on doesn't change what comes out of stock or what the dish costs.",
      "The margin is worked out against the dish's standard price, not a branch's own price or the price of a size.",
      "Costs come from each ingredient's most recent purchase at any branch; they aren't averaged, and they aren't kept per branch.",
    ],
    modules: ["recipe", "inventory"],
    related: ["restaurant-inventory-management", "restaurant-reports-and-analytics"],
  },
  {
    slug: "table-and-floor-management",
    name: "Table & floor management",
    keyword: "restaurant table management system",
    title: "Restaurant Table Management, Floor by Floor — ToffeeOS",
    description:
      "Set up each floor and its tables, see which tables are free on every till and phone, reopen a table's order in one tap, and merge two tables onto one bill.",
    summary: "Floors and tables with their seats, which ones are free on every device, and one tap to reopen a table's order.",
    folio: "TABLES",
    h1: "Restaurant table management, floor by floor",
    lead:
      "Set up each floor of your restaurant and the tables on it. The POS lists them floor by floor and shows each one as free or occupied as orders open and close, the same on every till and waiter's phone.",
    sections: [
      {
        heading: "How do we set up floors and tables?",
        answer:
          "Add a floor, name it, and add its tables, each with a label and a number of seats. A table can be renamed, have its seats changed or be moved to another floor, and each branch has its own floors and tables.",
        points: ["A table with an open order can't be deleted, and a floor can't be deleted while it still has tables."],
      },
      {
        heading: "How do staff see which tables are free?",
        answer:
          "Each table shows as free or occupied. It becomes occupied when an order is punched on it and free again when the bill is paid or the order is voided or cancelled, and every device sees the change within a second or two.",
        points: ["The table list is kept on the device, so it still opens when the internet is down."],
      },
      {
        heading: "What happens when we tap an occupied table?",
        answer: "Its order opens, showing what's already on it, with another round to add or payment to take.",
      },
      {
        heading: "Can two tables share one bill?",
        answer:
          "Yes. Merging moves every item from one table's order onto the other's and frees the first table. It's refused when either order has a discount on the whole bill, or only one of them is tax exempt, because merging would change what's owed; those two are settled separately.",
        points: [
          "Merging tables is its own permission.",
          "A takeaway can be given a free table if the customer decides to sit down, and a table's order can be made a takeaway, which frees the table.",
        ],
      },
      {
        heading: "Can guests order from the table themselves?",
        answer: "Yes, with QR ordering: each table gets its own QR code, and what a guest orders goes onto that table's bill.",
        modules: ["online"],
      },
    ],
    limits: [
      "There's no map of the room to arrange tables on: they're listed floor by floor.",
      "There are no reservations: a table is free or occupied.",
      "An order can't be moved straight from one table to another; two tables can be merged instead.",
    ],
    modules: [],
    related: ["restaurant-pos-system", "qr-code-menu-and-table-ordering"],
  },
  {
    slug: "delivery-and-rider-management",
    name: "Delivery & rider management",
    keyword: "restaurant delivery management software",
    title: "Restaurant Delivery & Rider Management — ToffeeOS",
    description:
      "Delivery orders from the till or your own ordering site, assigned to your own riders, with each drop-off proved by a photo taken at the door.",
    summary: "Delivery orders from the till or your own site, assigned to your riders, and every drop-off proved with a photo.",
    folio: "DELIVERY",
    h1: "Delivery and rider management for your own riders",
    lead:
      "ToffeeOS runs delivery with your own riders. Delivery orders come from the till or your ordering site, go to the kitchen and onto the delivery board, and are assigned to a rider, who picks each one up and proves the drop-off with a photo.",
    sections: [
      {
        heading: "Where do delivery orders come from?",
        answer:
          "From the till, with the customer's address, or from your own ordering site, where the customer chooses delivery and gives one. Either way the order goes to the kitchen and onto the delivery board.",
      },
      {
        heading: "How are riders assigned?",
        answer:
          "From the delivery board: someone with permission assigns each order to a rider. Changing the rider on an order that already has one is a separate permission, so a dispatched order can't be quietly handed to someone else.",
        points: ["Riders are staff at the branch with the rider role, and can be switched off when they leave."],
      },
      {
        heading: "What does the rider see?",
        answer:
          "Their own screen, on their phone: only the orders assigned to them, oldest first, each with its items, the customer's name, a number to tap and call, and the address. They mark each one picked up, then delivered.",
      },
      {
        heading: "How is a drop-off proved?",
        answer:
          "With a photo the rider takes at the door. An order can't be marked delivered without proof, and the photo is kept privately with the order.",
      },
      {
        heading: "How is cash on delivery settled?",
        answer:
          "A delivered order that hasn't been paid stays owed until the rider hands in the cash; the counter then records it in one step, in cash, for the whole bill. An order paid before it left stays paid.",
      },
      {
        heading: "How do we see how riders are doing?",
        answer:
          "The rider report shows each rider's completed deliveries and their average time from being assigned an order to delivering it, for any dates.",
      },
    ],
    limits: [
      "There's no live map of where riders are.",
      "It doesn't connect to third-party delivery apps.",
      "Riders sign in with an email address and a password; signing in with a phone number isn't available yet.",
    ],
    modules: ["delivery"],
    related: ["restaurant-online-ordering-system", "restaurant-pos-system"],
  },
  {
    slug: "restaurant-online-ordering-system",
    name: "Online ordering",
    keyword: "restaurant online ordering system",
    title: "Restaurant Online Ordering System — ToffeeOS",
    description:
      "Your restaurant's own ordering site, with the till's menu, prices and availability, orders going straight to the kitchen, and no per-order fee.",
    summary: "Your own ordering site with the till's live menu, orders straight to the kitchen, and no per-order fee.",
    folio: "ONLINE ORDERING",
    h1: "Your own online ordering site, run from the till",
    lead:
      "ToffeeOS gives your restaurant its own ordering site. Customers see the same menu, prices and availability as your till, choose pickup or delivery, and their order goes straight to the kitchen and the Order Queue.",
    sections: [
      {
        heading: "What do customers see?",
        answer:
          "Your menu, with your logo and colour: each dish with its description, its sizes and add-ons, at the branch's own prices. A dish that's run out at the till shows as unavailable online too.",
        points: [
          "A restaurant with several branches lets the customer choose which one to order from.",
          "Any dish can be kept off the online menu, say one that doesn't travel, and still be sold at the till.",
        ],
      },
      {
        heading: "What happens when someone orders?",
        answer:
          "The customer gives a name and phone number and chooses pickup or delivery, with an address for delivery. The order goes straight to the kitchen and into the Order Queue, marked as an online order, and the counter is alerted.",
        points: ["Each customer is matched to their customer record by phone number."],
      },
      {
        heading: "How do customers pay?",
        answer: "When they collect the order, or to the rider on delivery. The site doesn't take payment online.",
      },
      {
        heading: "Is there a fee on each order?",
        answer: "No. Orders from your own site carry no per-order fee.",
      },
      {
        heading: "What happens to delivery orders?",
        answer: "They go onto the delivery board, to be assigned to one of your riders.",
      },
    ],
    limits: [
      "Customers can't pay online: they pay on collection or on delivery.",
      "Orders go straight to the kitchen, with no step to accept or decline them first; one that can't be made is cancelled from the till, with a reason.",
      "Every order is for now: customers can't order ahead for a later time.",
      "Customers don't have accounts or passwords; they're recognised by phone number.",
    ],
    modules: ["online"],
    related: ["qr-code-menu-and-table-ordering", "delivery-and-rider-management"],
  },
  {
    slug: "qr-code-menu-and-table-ordering",
    name: "QR menu & table ordering",
    keyword: "QR code menu ordering",
    title: "QR Code Menu & Table Ordering for Restaurants — ToffeeOS",
    description:
      "A QR code on every table: guests scan it, order from your live menu, and the order goes to the kitchen and onto that table's bill, paid the usual way.",
    summary: "A QR code on each table: guests order from your live menu, straight to the kitchen and onto the table's bill.",
    folio: "QR ORDERING",
    h1: "QR code menu ordering that goes straight to the table's bill",
    lead:
      "Each table gets its own QR code. A guest scans it, sees the same menu and prices as your till, and orders; the order goes to the kitchen and onto that table's bill, and staff take payment as usual.",
    sections: [
      {
        heading: "How do we get the QR codes?",
        answer:
          "From the tables screen: each table has its own code, which you download as an image to print and put on the table.",
      },
      {
        heading: "What happens when a guest orders?",
        answer:
          "If the table has no open order, a new one is started for it and sent to the kitchen. If it already has one — a waiter started it, or someone at the table ordered earlier — the guest's items are added to that same order, so a table never ends up with two bills.",
        points: [
          "Items added to an order the kitchen already has appear on the kitchen screen, and a ticket already marked ready goes back to cooking.",
          "The counter is told when a guest orders.",
        ],
      },
      {
        heading: "Do guests have to give their details?",
        answer:
          "No. A name and phone number are optional at the table; with a phone number, the order is linked to that customer's record.",
      },
      {
        heading: "How do guests pay?",
        answer: "The same way as any table: staff take payment at the till. There's no paying from the phone.",
      },
      {
        heading: "Can some dishes stay off the QR menu?",
        answer:
          "Yes. Any dish can be kept off the online and QR menus while still being sold at the till, and a dish that's run out at the till shows as unavailable to guests too.",
      },
    ],
    limits: [
      "Guests can't pay from their phone; staff take payment.",
      "A guest's order goes to the kitchen without a waiter or the counter approving it first.",
    ],
    modules: ["online"],
    related: ["restaurant-online-ordering-system", "table-and-floor-management"],
  },
  {
    slug: "restaurant-reports-and-analytics",
    name: "Reports & analytics",
    keyword: "restaurant reports and analytics",
    title: "Restaurant Sales Reports & Analytics — ToffeeOS",
    description:
      "Sales by day, branch, category, dish, payment method and staff member, every transaction listed, a printable closing summary, and profit and loss.",
    summary: "Sales by day, branch, dish, payment method and staff, a printable closing summary, and profit and loss.",
    folio: "REPORTS",
    h1: "Restaurant reports that match the till to the paisa",
    lead:
      "ToffeeOS reports come from the same orders and payments the till records, counted in whole paisa and on each branch's own business day, so a report's total is the till's total.",
    sections: [
      {
        heading: "What reports come with every plan?",
        answer:
          "For any dates: the revenue trend, sales by branch, by category and by payment method, every transaction in the period, sales dish by dish, and each staff member's performance day by day.",
        points: ["Anyone allowed to can download a report as a spreadsheet (CSV)."],
      },
      {
        heading: "How does closing the day work?",
        answer:
          "The daily sales screen shows today, a week, or any day in it, and prints a closing summary on the receipt printer, for the owner's file or to count the drawer against.",
        points: [
          "Each branch's day ends when it says: a sale at 1:30am counts for the night before at a branch whose day ends at 4am.",
        ],
      },
      {
        heading: "Can we see every branch together?",
        answer:
          "Owners see every branch together or one at a time, each on its own business day; everyone else sees their own branch.",
      },
      {
        heading: "Discounts, voids, cancellations and stock value",
        answer:
          "An audit of every discount and void, with who gave it and why; every cancelled order with its reason; and the value of the stock on hand.",
        modules: ["reports"],
      },
      {
        heading: "Profit and loss",
        answer:
          "Takings without the sales tax, less refunds, stock bought, salaries paid out and approved expenses by category, for any dates. It counts money in and money out in the period, not the stock used.",
        points: ["A delivery entered without a cost is counted and flagged, so a cost line that's too low is visible."],
        modules: ["finance"],
      },
      {
        heading: "Recipe cost and margins",
        answer: "What each dish costs to make and the margin on it, thinnest margins first.",
        modules: ["recipe"],
      },
      {
        heading: "Rider performance",
        answer: "Each rider's completed deliveries and average delivery time.",
        modules: ["delivery"],
      },
    ],
    limits: [
      "Sales taken during an internet outage appear in the reports once the till reconnects.",
      "Reports aren't sent out on a schedule; they're read in the app, printed or downloaded.",
      "Profit and loss is cash in and cash out for the period, not an accountant's accrual statement.",
    ],
    modules: [],
    related: ["multi-branch-restaurant-management", "recipe-costing-software"],
  },
  {
    slug: "multi-branch-restaurant-management",
    name: "Multi-branch management",
    keyword: "multi-branch restaurant management software",
    title: "Multi-Branch Restaurant Management Software — ToffeeOS",
    description:
      "Run several branches in one account, each with its own tax rates, prices, staff, stock and business day, one shared menu, and reports by branch or together.",
    summary: "Several branches in one account, each with its own tax, prices, staff, stock and day, reported together or apart.",
    folio: "BRANCHES",
    h1: "Multi-branch restaurant management in one account",
    lead:
      "Each branch runs on its own settings — its tax rates, prices, staff, tables, stock and the time its day ends — while sharing one menu and one account, and the owner sees them together or one at a time.",
    sections: [
      {
        heading: "What does each branch set for itself?",
        answer:
          "Its tax rate for each way of paying, its service charge and rounding, when its business day ends and its timezone, its discount ceiling, its receipt header, and whether its kitchen works from the screen or printed tickets.",
        points: [
          "Waiter orders can need the counter's approval at one branch and go straight to the kitchen at another.",
          "Each branch has its own floors and tables.",
        ],
      },
      {
        heading: "Is the menu shared?",
        answer:
          "Yes: one menu for the whole account, with each branch's own prices and availability, so a dish can cost more at one branch or be off at another.",
      },
      {
        heading: "How do staff work across branches?",
        answer:
          "Each person has a role at each branch they work at, and can hold different roles at different branches. What someone is allowed to do at one branch doesn't carry over to another.",
      },
      {
        heading: "Can stock move between branches?",
        answer:
          "Yes. Each branch keeps its own stock in its own storerooms, and a transfer moves stock from one branch to another, recorded at both ends.",
        modules: ["inventory"],
      },
      {
        heading: "How do owners see every branch?",
        answer: "In the reports, together or one branch at a time, each branch on its own business day.",
      },
      {
        heading: "How many branches can we run?",
        answer: BRANCH_COUNTS,
      },
    ],
    limits: [
      "Each person works in one branch at a time: signing in takes them to the first branch they were added to, and there's no switching between branches in the app.",
      "A branch's own settings are changed by someone signed in to that branch, usually its manager; owners see every branch in the reports.",
    ],
    modules: [],
    branches: 2,
    related: ["restaurant-reports-and-analytics", "restaurant-payroll-and-staff-management"],
  },
  {
    slug: "restaurant-payroll-and-staff-management",
    name: "Payroll & staff management",
    keyword: "restaurant payroll and staff management software",
    title: "Restaurant Staff Management & Payroll Software — ToffeeOS",
    description:
      "Invite staff, give each role exactly the permissions it needs, and keep shifts, attendance, payroll and payslips in the same system as the till.",
    summary: "Roles and permissions for every job, and shifts, attendance, payroll and payslips beside the till.",
    folio: "STAFF & PAYROLL",
    h1: "Restaurant staff management and payroll, beside the till",
    lead:
      "Each member of staff gets a role that allows exactly what their job needs, from voiding an item to seeing the takings. The same records can schedule shifts, hold attendance and work out payroll and payslips.",
    sections: [
      {
        heading: "How do staff get access?",
        answer:
          "An owner or manager creates an invitation with the person's email and role, and sends them its link; they open it, set a password, and join with that role at that branch. Links expire after seven days.",
      },
      {
        heading: "How do roles and permissions work?",
        answer:
          "A role is a set of permissions, one for each action, and you can create your own roles alongside the ones provided. Each person has one role at each branch they work at.",
        points: ["A role can't be deleted while anyone still has it."],
      },
      {
        heading: "Can we schedule shifts?",
        answer: "Yes. Give each person their shifts at their branch, and see who is on when.",
        modules: ["hr"],
      },
      {
        heading: "How is attendance recorded?",
        answer:
          "A manager enters each person's clock-in and clock-out times, with a note saying why; every entry records who made it.",
        modules: ["hr"],
      },
      {
        heading: "How is payroll worked out?",
        answer:
          "For any dates, from each person's pay and their attendance: monthly staff are paid their salary, hourly staff their hours at their rate. A branch can switch on overtime for hourly staff, above a weekly number of hours, at a rate it sets.",
        points: [
          "Each person gets a payslip for the period, with their hours on it.",
          "Pay is set per person per branch, so someone who works at two branches is paid for each.",
          "Each payout is recorded — when, and how it was paid — and salaries paid out appear in the profit and loss.",
        ],
        modules: ["hr"],
      },
    ],
    limits: [
      "Payroll works out gross pay; it makes no deductions, for tax, advances or anything else.",
      "It records payouts; it doesn't send money to anyone.",
      "Invitations aren't emailed: you send each person their link yourself.",
    ],
    modules: [],
    related: ["multi-branch-restaurant-management", "restaurant-pos-system"],
  },
];

/** The modules each section needs beyond the page's own, for plansSummary. */
export function sectionModules(feature: Feature): string[][] {
  return feature.sections.flatMap((s) => (s.modules ? [s.modules] : []));
}

export function getFeature(slug: string): Feature | undefined {
  return FEATURES.find((f) => f.slug === slug);
}
