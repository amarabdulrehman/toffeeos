import type { Metadata } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import { BRAND_NAME, BRAND_TAGLINE, SITE_URL } from "@/config/brand";
import { Providers } from "@/components/providers";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
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
  // Relative canonicals (each page sets its own; none is set here, or every page would inherit the
  // homepage's) resolve against the public address, whichever host served the page.
  metadataBase: new URL(SITE_URL),
  title: BRAND_NAME,
  description: BRAND_TAGLINE,
  // Lets a café tablet "Add to Home Screen" and open the till like an app rather than a browser
  // tab — which also makes an accidental refresh, the thing that used to kill an offline shift,
  // much harder to trigger.
  manifest: "/manifest.webmanifest",
  // favicon.ico (src/app) is the tab icon for browsers that skip the SVG; apple-icon.png is the
  // home-screen icon on an iPad. Named here because declaring icons turns off the automatic links.
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegistration />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
