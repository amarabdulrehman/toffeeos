"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { COMPANY_EMAIL, COMPANY_INSTAGRAM, COMPANY_INSTAGRAM_HANDLE, COMPANY_NAME } from "@/config/brand";

/**
 * Header and footer.
 *
 * The header is transparent over the hero and only acquires a background once the page has scrolled
 * past it — so the first screen is the product and its headline, not a navigation bar. That is the
 * cheapest way to buy a page a sense of confidence, and the most commonly skipped.
 */

const NAV = [
  { href: "#outage", label: "Offline" },
  { href: "#features", label: "What it runs" },
  { href: "#plans", label: "Plans" },
];

export function SiteHeader() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 24));

  return (
    <motion.header
      animate={{
        backgroundColor: scrolled ? "rgba(8,7,15,0.72)" : "rgba(8,7,15,0)",
        borderBottomColor: scrolled ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0)",
      }}
      transition={{ duration: 0.3 }}
      className="fixed inset-x-0 top-0 z-50 border-b backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="ToffeeOS home">
          <span className="grid size-7 place-items-center rounded-lg bg-violet-600 text-[13px] font-bold text-white">
            T
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-white">ToffeeOS</span>
        </Link>

        <nav className="ml-auto hidden items-center gap-7 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-[13px] font-medium text-white/55 transition-colors hover:text-white"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Link
            href="/login"
            className="hidden h-9 items-center rounded-full px-4 text-[13px] font-medium whitespace-nowrap text-white/70 transition-colors hover:text-white sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-9 items-center rounded-full bg-white px-4 text-[13px] font-semibold whitespace-nowrap text-black transition-transform duration-200 hover:scale-[1.04] active:scale-[0.98]"
          >
            Start free trial
          </Link>
        </div>
      </div>
    </motion.header>
  );
}

export function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect width="20" height="20" x="2" y="2" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37Z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.06] bg-[#08070f]">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div>
            {/* the company mark, on the dark-background variant built for exactly this surface */}
            <Image
              src="/krimsol-logo-dark.png"
              alt={COMPANY_NAME}
              width={284}
              height={190}
              className="h-9 w-auto"
            />
            <p className="mt-5 max-w-xs text-[13px] leading-relaxed text-white/35">
              ToffeeOS is restaurant software by {COMPANY_NAME}, built in Pakistan for the way
              restaurants here actually work.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-14 gap-y-8 sm:grid-cols-3">
            <FooterCol title="Product">
              <FooterLink href="#outage">Offline</FooterLink>
              <FooterLink href="#features">What it runs</FooterLink>
              <FooterLink href="#plans">Plans</FooterLink>
            </FooterCol>
            <FooterCol title="Get started">
              <FooterLink href="/signup" internal>
                Start free trial
              </FooterLink>
              <FooterLink href="/login" internal>
                Sign in
              </FooterLink>
            </FooterCol>
            <FooterCol title="Talk to us">
              <FooterLink href={`mailto:${COMPANY_EMAIL}`}>{COMPANY_EMAIL}</FooterLink>
              <FooterLink href={COMPANY_INSTAGRAM} external>
                {COMPANY_INSTAGRAM_HANDLE}
              </FooterLink>
            </FooterCol>
          </div>
        </div>

        <div className="mt-14 border-t border-white/[0.06] pt-6">
          <p className="text-[12px] text-white/25">
            © {new Date().getFullYear()} {COMPANY_NAME}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-[0.16em] text-white/30 uppercase">{title}</p>
      <ul className="mt-4 space-y-2.5">{children}</ul>
    </div>
  );
}

function FooterLink({
  href,
  children,
  internal,
  external,
}: {
  href: string;
  children: React.ReactNode;
  internal?: boolean;
  external?: boolean;
}) {
  const cls = "text-[13px] text-white/50 transition-colors hover:text-white";
  return (
    <li>
      {internal ? (
        <Link href={href} className={cls}>
          {children}
        </Link>
      ) : (
        <a href={href} className={cls} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
          {children}
        </a>
      )}
    </li>
  );
}
