import Link from "next/link";
import type { ReactNode } from "react";
import { displaySerif } from "./fonts";
import { BRAND_NAME, COMPANY_EMAIL, COMPANY_NAME } from "@/config/brand";

/**
 * The frame for the marketing site's content pages (pricing now; the feature pages when they
 * ship). It uses the same paper-and-ink look as the homepage and the legal pages.
 *
 * Server-rendered and free of client JavaScript: the whole text is in the HTML a crawler or an AI
 * assistant fetches, and nothing here needs the homepage's animation code.
 */

const navLink = "text-[13px] font-medium text-[color:var(--ink-2)] transition-colors hover:text-[color:var(--ink)]";
const footLink = "transition-colors hover:text-[color:var(--ink)]";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className={`tos-landing ${displaySerif.variable} flex min-h-svh flex-1 flex-col`}>
      <header className="border-b border-[color:var(--rule)]">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-5 px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label={`${BRAND_NAME} home`}>
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-lg bg-[color:var(--ink)] text-[13px] font-bold text-[color:var(--paper)]"
            >
              T
            </span>
            <span className="font-display text-[19px] tracking-tight text-[color:var(--ink)]">{BRAND_NAME}</span>
          </Link>
          <nav aria-label="Main" className="ml-auto flex items-center gap-5">
            <Link href="/pricing" className={`${navLink} max-sm:hidden`}>
              Pricing
            </Link>
            <Link href="/login" className={navLink}>
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-9 items-center rounded-sm bg-[color:var(--ink)] px-4 text-[13px] font-semibold whitespace-nowrap text-[color:var(--paper)] transition-colors hover:bg-[color:var(--accent)]"
            >
              Start free trial
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-14 sm:px-8 sm:py-20">{children}</main>

      <footer className="border-t border-[color:var(--rule)] py-10">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 px-5 text-[12px] text-[color:var(--ink-3)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>
            © {new Date().getFullYear()} {COMPANY_NAME}. Restaurant software, built in Pakistan.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/" className={footLink}>
              Home
            </Link>
            <Link href="/pricing" className={footLink}>
              Pricing
            </Link>
            <Link href="/terms" className={footLink}>
              Terms
            </Link>
            <Link href="/privacy" className={footLink}>
              Privacy
            </Link>
            <a href={`mailto:${COMPANY_EMAIL}`} className={footLink}>
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function Breadcrumbs({ trail }: { trail: { name: string; path: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-[12px] text-[color:var(--ink-3)]">
      <ol className="flex flex-wrap items-center gap-1.5">
        {trail.map((t, i) => (
          <li key={t.path} className="flex items-center gap-1.5">
            {i < trail.length - 1 ? (
              <>
                <Link href={t.path} className="transition-colors hover:text-[color:var(--ink)]">
                  {t.name}
                </Link>
                <span aria-hidden>/</span>
              </>
            ) : (
              <span aria-current="page" className="text-[color:var(--ink-2)]">
                {t.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
