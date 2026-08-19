import type { Metadata } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import { BRAND_NAME, BRAND_TAGLINE } from "@/config/brand";
import { Providers } from "@/components/providers";
import "./globals.css";

// Single clean sans throughout (both --font-body and --font-heading resolve to this) — matches
// the flat, uniform-typography admin-SaaS look of the reference screenshots, no display serif.
const manrope = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: BRAND_TAGLINE,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
