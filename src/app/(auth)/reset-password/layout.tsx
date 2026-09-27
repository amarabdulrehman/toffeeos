import type { Metadata } from "next";
import { BRAND_NAME } from "@/config/brand";

// Not a marketing page: its own title, and kept out of search results (noindex) so it doesn't dilute what the site ranks for. The page itself is a client component, which can't export metadata.
export const metadata: Metadata = {
  title: `Reset your password — ${BRAND_NAME}`,
  description: "Reset the password for your ToffeeOS account.",
  alternates: { canonical: "/reset-password" },
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
