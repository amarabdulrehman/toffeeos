"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LayoutGrid, Menu, X } from "lucide-react";
import { BRAND_NAME } from "@/config/brand";

/**
 * The back-office navigation on a phone.
 *
 * The shell used to render one fixed 240px sidebar at every width. On a 390px phone that left
 * 150px for the content — measured, not estimated — so reports, menu, staff and inventory were all
 * technically reachable and none of them usable. An owner checking the day's takings from their
 * phone is an ordinary thing to want, and it simply did not work.
 *
 * The same nav content renders in both places rather than being written twice: the layout passes
 * it in as children, so a nav item added to AppSidebarNav appears here automatically and cannot
 * drift out of step.
 *
 * Closes when a link inside it is tapped. A drawer that stays open over the page it just navigated
 * to is the most irritating version of this component. Done by catching the click rather than by
 * watching the pathname in an effect: the tap is the event, and reacting to the route change
 * afterwards means setting state during render for no reason.
 */
export function MobileNav({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  // Escape closes it, and the page behind must not scroll while it is over the top.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* The bar itself, only below lg — above that the real sidebar is present. */}
      <div className="flex items-center gap-3 bg-sidebar px-4 py-3 text-sidebar-foreground lg:hidden">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <LayoutGrid className="size-4" />
        </span>
        <span className="font-heading text-base font-semibold tracking-tight">{BRAND_NAME}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="ml-auto grid size-9 place-items-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        >
          <Menu className="size-5" />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            // Any link in here is a navigation, and a navigation should take the drawer with it.
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) setOpen(false);
            }}
            className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col bg-sidebar p-4 text-sidebar-foreground shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute top-3 right-3 grid size-9 place-items-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            >
              <X className="size-5" />
            </button>
            {children}
          </div>
        </div>
      )}
    </>
  );
}
