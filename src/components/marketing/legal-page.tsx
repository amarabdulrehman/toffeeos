import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { marked } from "marked";
import { displaySerif } from "./fonts";
import { COMPANY_EMAIL, COMPANY_NAME } from "@/config/brand";

/**
 * Renders one of the documents in /legal as a page.
 *
 * Reads the markdown at build time rather than duplicating it into JSX, so the file in the repo
 * stays the single source of truth. A legal document that exists in two places will eventually say
 * two different things, and the copy a client actually agreed to is whichever one was served.
 *
 * marked rather than a hand-rolled parser: the markdown here is a small subset, but these are the
 * terms a paying client is bound by, and a parser of mine quietly dropping a clause is a category
 * of bug worth spending a dependency to avoid. It runs server-side only, so the client pays
 * nothing for it.
 */
export async function LegalPage({ file, title }: { file: "terms-of-service" | "privacy-policy"; title: string }) {
  const source = await readFile(path.join(process.cwd(), "legal", `${file}.md`), "utf8");

  // The markdown's first heading is the document title, which the page header already states.
  const body = source.replace(/^#\s+.*\n/, "");
  const html = await marked.parse(body, { gfm: true, breaks: false });

  return (
    <div className={`tos-landing ${displaySerif.variable} flex min-h-svh flex-1 flex-col`}>
      <header className="border-b border-[color:var(--rule)]">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label={`${COMPANY_NAME} home`}>
            <span className="grid size-7 place-items-center rounded-lg bg-[color:var(--ink)] text-[13px] font-bold text-[color:var(--paper)]">
              T
            </span>
            <span className="font-display text-[19px] tracking-tight text-[color:var(--ink)]">ToffeeOS</span>
          </Link>
          <Link
            href="/"
            className="ml-auto text-[13px] font-medium text-[color:var(--ink-2)] transition-colors hover:text-[color:var(--ink)]"
          >
            ← Back
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-16 sm:px-8 sm:py-24">
        <p className="tos-folio">{file === "terms-of-service" ? "TERMS" : "PRIVACY"}</p>
        <h1 className="font-display mt-5 text-[clamp(2.2rem,5vw,3.4rem)] leading-[1.02] tracking-[-0.018em] text-[color:var(--ink)]">
          {title}
        </h1>

        <div className="legal-prose mt-12" dangerouslySetInnerHTML={{ __html: html }} />
      </main>

      <footer className="border-t border-[color:var(--rule)] py-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 text-[12px] text-[color:var(--ink-3)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>
            © {new Date().getFullYear()} {COMPANY_NAME}.
          </p>
          <div className="flex gap-6">
            <Link href="/terms" className="transition-colors hover:text-[color:var(--ink)]">
              Terms
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-[color:var(--ink)]">
              Privacy
            </Link>
            <a href={`mailto:${COMPANY_EMAIL}`} className="transition-colors hover:text-[color:var(--ink)]">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
