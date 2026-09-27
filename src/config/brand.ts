/** Change these two values to rename the whole product — nothing else references the name directly. */
export const BRAND_NAME = "ToffeeOS";
export const BRAND_TAGLINE = "Restaurant management for Pakistan's kitchens.";

/**
 * The site's one public address. Canonical links, the sitemap and robots.txt use it whatever host
 * served the page — toffeeos.vercel.app and every preview deployment serve the same pages, and
 * search engines should credit this address, not those.
 */
export const SITE_URL = "https://toffeeos.com";

/**
 * The company behind the product. Kept here for the same reason as the two values above: the
 * landing page, the footer and every "contact us" link read from one place, so changing an email
 * or a handle is a one-line edit rather than a hunt through JSX.
 */
export const COMPANY_NAME = "KRIMSOLS";
export const COMPANY_EMAIL = "krimsolcompany@gmail.com";
export const COMPANY_INSTAGRAM = "https://www.instagram.com/krimsols?stkn=amk1cDlzMzFuZnI2";
/** Shown as the handle; the URL above carries a share token that shouldn't appear as link text. */
export const COMPANY_INSTAGRAM_HANDLE = "@krimsols";
