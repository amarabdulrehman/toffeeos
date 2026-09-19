/**
 * Spill's menu, as data.
 *
 * Kept apart from the two scripts that use it because they run in different worlds: the local
 * seeder imports `server-only` and a Prisma client, while the remote one must run with no database
 * credentials at all. A shared data module is the only thing both can import, and it means a price
 * correction is made once rather than in two places that drift.
 *
 * Transcribed from two photographs of the printed board. Anything uncertain in the photo is flagged
 * in the proof sheet rather than silently guessed.
 */

/** Rupees -> paisa. Every price on the board is a whole rupee. */
export const rs = (rupees: number) => rupees * 100;

export interface Item {
  name: string;
  /** The 12oz price where there are two sizes, otherwise the only price. */
  price: number;
  /** 16oz price, when the board lists one. */
  large?: number;
  description?: string;
  /** Groups of add-ons offered with this item. */
  mods?: ModKey[];
  /** A board item marked with the star/diamond — Spill's own signature. */
  signature?: boolean;
}

export type ModKey = "serve" | "iced-only" | "dips" | "extras";

export interface Category {
  name: string;
  items: Item[];
}

/**
 * The menu exactly as transcribed from the two board photos. Prices in rupees.
 *
 * Anything uncertain in the photograph is flagged in the proof sheet rather than silently guessed;
 * the transcription here is the best reading of the image, not an invention.
 */
export const MENU: Category[] = [
  {
    name: "Fries",
    items: [
      { name: "Plain Fries", price: 549, mods: ["dips"] },
      { name: "Crinkle Cut", price: 599, mods: ["dips"] },
      { name: "Curly Fries", price: 599, mods: ["dips"] },
      { name: "Signature Waffle Cuts", price: 649, signature: true, mods: ["dips"] },
      { name: "Flamin' Hot Cheetos Fries", price: 849, signature: true, mods: ["dips"] },
      { name: "The Spill Fully Loaded", price: 849, mods: ["dips"] },
    ],
  },
  {
    name: "Sandwiches",
    items: [
      { name: "Tuscan Panini Toasted", price: 699, mods: ["dips"] },
      { name: "Grilled Sandwich", price: 619, mods: ["dips"] },
      { name: "The Spill Club", price: 699, mods: ["dips"] },
      { name: "The Pesto Parmesan Melt", price: 649, signature: true, mods: ["dips"] },
    ],
  },
  {
    name: "The Bakehouse",
    items: [
      { name: "Artisan Pizza Bread", price: 649 },
      { name: "Butter Croissant", price: 399 },
      { name: "Banana Bread", price: 299 },
      { name: "Fudge Brownie", price: 399 },
      { name: "Classic Chocolate Chip Cookie", price: 399 },
      { name: "Double Chocolate Cookie", price: 449 },
    ],
  },
  {
    name: "By The Slice",
    items: [
      { name: "Lotus Cake", price: 449 },
      { name: "Honey Cake", price: 449 },
      { name: "Oreo Blast Cake", price: 399 },
      { name: "Choco Cake", price: 349 },
      { name: "Tiramisu", price: 499 },
    ],
  },
  {
    name: "Cold-Pressed Juices",
    items: [
      { name: "Apple", price: 399, large: 500 },
      { name: "Peach", price: 349, large: 549 },
      { name: "Orange", price: 399, large: 599 },
      { name: "Mango", price: 449, large: 599 },
    ],
  },
  {
    name: "Wellness Blends",
    items: [
      { name: "The Reset", price: 599, large: 749, description: "Apple, lemon, ginger" },
      { name: "The Vitality", price: 599, large: 749, description: "Ginger, carrot, orange" },
      { name: "The Glow", price: 649, large: 749, description: "Peach, carrot & beetroot" },
    ],
  },
  {
    name: "Shakes",
    items: [
      { name: "Banana", price: 399, large: 500 },
      { name: "Mango", price: 449, large: 600 },
      { name: "Strawberry", price: 449, large: 620 },
      { name: "Passion Fruit", price: 599, large: 750 },
    ],
  },
  {
    name: "Spill Spritzers",
    items: [
      {
        name: "Sunset Sparkler",
        price: 649,
        signature: true,
        description: "Passionfruit, pineapple and citrus fizz",
      },
      {
        name: "Vampire Fizz",
        price: 649,
        signature: true,
        description: "Wild strawberry and dragonfruit fizz",
      },
      { name: "Blue Breeze", price: 649 },
      { name: "Lime Spark", price: 499 },
      { name: "Fresh Mint Fizz", price: 649 },
    ],
  },
  {
    name: "Coffee — Specialty",
    items: [
      { name: "Espresso", price: 449, mods: ["serve", "extras"] },
      { name: "Americano", price: 549, large: 699, mods: ["serve", "extras"] },
      { name: "Honey Americano", price: 599, large: 699, mods: ["serve", "extras"] },
      { name: "Affogato", price: 699, large: 799, signature: true, mods: ["iced-only", "extras"] },
      { name: "Flat White", price: 699, mods: ["serve", "extras"] },
      { name: "Cappuccino", price: 599, mods: ["serve", "extras"] },
      { name: "Latte", price: 599, large: 699, mods: ["serve", "extras"] },
      { name: "Mocha", price: 699, large: 799, signature: true, mods: ["serve", "extras"] },
    ],
  },
  {
    name: "Coffee — Signatures",
    items: [
      { name: "Butterscotch", price: 649, large: 799, mods: ["serve", "extras"] },
      { name: "Popcorn", price: 649, large: 799, mods: ["serve", "extras"] },
      { name: "Tiramisu", price: 699, large: 799, signature: true, mods: ["iced-only", "extras"] },
      { name: "Kinder", price: 749, large: 949, signature: true, mods: ["serve", "extras"] },
      { name: "Kitkat", price: 749, large: 949, mods: ["serve", "extras"] },
      { name: "Toffee Nut", price: 749, large: 949, signature: true, mods: ["serve", "extras"] },
      { name: "Pistachio", price: 899, large: 1099, mods: ["serve", "extras"] },
    ],
  },
  {
    name: "Coffee — Classic",
    items: [
      { name: "Spanish", price: 649, large: 799, mods: ["serve", "extras"] },
      { name: "Vanilla", price: 649, large: 799, mods: ["serve", "extras"] },
      { name: "Caramel", price: 649, large: 799, mods: ["serve", "extras"] },
      { name: "Hazelnut", price: 649, large: 799, signature: true, mods: ["serve", "extras"] },
    ],
  },
  {
    name: "Frappe",
    items: [
      { name: "Vanilla", price: 999, mods: ["extras"] },
      { name: "Caramel", price: 849, mods: ["extras"] },
      { name: "Hazelnut", price: 899, mods: ["extras"] },
      { name: "Popcorn", price: 899, mods: ["extras"] },
      { name: "Kinder", price: 949, large: 1049, mods: ["extras"] },
      { name: "Kit Kat", price: 949, large: 1049, mods: ["extras"] },
      { name: "Toffee Nut", price: 949, large: 1049, mods: ["extras"] },
      { name: "Pistachio", price: 949, large: 1149, mods: ["extras"] },
    ],
  },
  {
    name: "Matcha",
    items: [
      { name: "Vanilla", price: 749, large: 949, mods: ["serve", "extras"] },
      { name: "Strawberry", price: 749, large: 949, mods: ["serve", "extras"] },
      { name: "Blue Raspberry", price: 749, large: 949, signature: true, mods: ["serve", "extras"] },
    ],
  },
  {
    name: "Drinking Chocolate",
    items: [
      { name: "Nutella", price: 649, large: 749, mods: ["serve", "extras"] },
      { name: "Kit Kat", price: 649, large: 749, mods: ["serve", "extras"] },
      { name: "Swiss", price: 699, large: 799, signature: true, mods: ["serve", "extras"] },
    ],
  },
  {
    name: "Tea",
    items: [
      { name: "Cardamom", price: 319, signature: true },
      { name: "Black", price: 249 },
      { name: "Green", price: 249 },
      { name: "Flavoured Tea", price: 349, description: "Lemon, ginger or peach" },
    ],
  },
  {
    name: "Iced Tea",
    items: [
      { name: "Peach Mamba", price: 499, signature: true },
      { name: "Passion Fruit", price: 499 },
      { name: "Strawberry Pineapple", price: 499 },
      { name: "Peach Iced Tea", price: 499 },
    ],
  },
];

/**
 * Add-on groups. `serve` carries no price because Hot and Iced cost the same on the board — it is
 * there so the ticket tells the barista which one was ordered, which is the whole point of putting
 * it on the order line rather than leaving it to be shouted across the counter.
 */
export const MOD_GROUPS: Record<ModKey, { name: string; min: number; max: number; options: { name: string; price: number }[] }> = {
  serve: {
    name: "Hot or Iced",
    min: 1,
    max: 1,
    options: [
      { name: "Hot", price: 0 },
      { name: "Iced", price: 0 },
    ],
  },
  "iced-only": {
    name: "Served Iced",
    min: 1,
    max: 1,
    options: [{ name: "Iced", price: 0 }],
  },
  dips: {
    name: "House Dips",
    min: 0,
    max: 3,
    options: [
      { name: "Smokey BBQ", price: 99 },
      { name: "Jalapeño Garlic", price: 99 },
      { name: "Spill Secret Sauce", price: 99 },
    ],
  },
  extras: {
    name: "Extras",
    min: 0,
    max: 6,
    options: [
      { name: "Add Flavor Infusion (10ml)", price: 90 },
      { name: "Extra Espresso Shot", price: 90 },
      { name: "Ceremonial Matcha Shot", price: 90 },
      { name: "Whipping Cream", price: 90 },
      { name: "Lactose-Free / Skimmed Milk", price: 90 },
      { name: "Custom Latte Art Printing", price: 150 },
    ],
  },
};
