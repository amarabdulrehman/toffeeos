"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { COMPANY_NAME } from "@/config/brand";

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
        backgroundColor: scrolled ? "rgba(250,249,253,0.85)" : "rgba(250,249,253,0)",
        borderBottomColor: scrolled ? "rgba(24,22,38,0.12)" : "rgba(24,22,38,0)",
      }}
      transition={{ duration: 0.3 }}
      className="fixed inset-x-0 top-0 z-50 border-b backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="ToffeeOS home">
          <span className="grid size-7 place-items-center rounded-lg bg-[color:var(--ink)] text-[13px] font-bold text-[color:var(--paper)]">
            T
          </span>
          <span className="font-display text-[19px] tracking-tight text-[color:var(--ink)]">ToffeeOS</span>
        </Link>

        <nav className="ml-auto hidden items-center gap-7 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-[13px] font-medium text-[color:var(--ink-2)] transition-colors hover:text-[color:var(--ink)]"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Link
            href="/login"
            className="hidden h-9 items-center rounded-full px-4 text-[13px] font-medium whitespace-nowrap text-[color:var(--ink-2)] transition-colors hover:text-[color:var(--ink)] sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-9 items-center rounded-sm bg-[color:var(--ink)] px-4 text-[13px] font-semibold whitespace-nowrap text-[color:var(--paper)] transition-colors duration-200 hover:bg-[color:var(--accent)]"
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
    <footer className="border-t border-[color:var(--rule)] py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="text-[12px] text-[color:var(--ink-3)]">
          © {new Date().getFullYear()} {COMPANY_NAME}. Restaurant software, built in Pakistan.
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
          <a href="#outage" className="text-[color:var(--ink-3)] transition-colors hover:text-[color:var(--ink)]">
            Offline
          </a>
          <a href="#features" className="text-[color:var(--ink-3)] transition-colors hover:text-[color:var(--ink)]">
            What it runs
          </a>
          <a href="#plans" className="text-[color:var(--ink-3)] transition-colors hover:text-[color:var(--ink)]">
            Plans
          </a>
          <Link href="/pricing" className="text-[color:var(--ink-3)] transition-colors hover:text-[color:var(--ink)]">
            Pricing
          </Link>
          <Link href="/login" className="text-[color:var(--ink-3)] transition-colors hover:text-[color:var(--ink)]">
            Sign in
          </Link>
          <Link href="/terms" className="text-[color:var(--ink-3)] transition-colors hover:text-[color:var(--ink)]">
            Terms
          </Link>
          <Link href="/privacy" className="text-[color:var(--ink-3)] transition-colors hover:text-[color:var(--ink)]">
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
