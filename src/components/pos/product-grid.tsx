"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPkr } from "@/lib/money";
import type { MenuCategoryDto, MenuItemDto } from "./types";

/** Deterministic accent per category (cycled), so the grid reads with variety even though menu
 * data is fully tenant-defined and we can't know category names in advance. Deliberately excludes
 * primary/purple — that's reserved for the active-category and action-button state, so an inactive
 * pill never gets confused for the selected one. Written as complete, literal class strings (not
 * composed at runtime) since Tailwind's compiler needs to see the full class name in source. */
/* The label is near-black in both themes; the category's colour is carried by the fill, the border
 * and the stripe. Tinting the *text* as well was the prettier version and measured 4.39:1 against
 * its own tint — under the threshold, on a screen read at arm's length in a kitchen. The colour
 * coding survives; only the part that has to be read stopped depending on it. */
const CATEGORY_ACCENTS = [
  { pill: "bg-warning/18 text-foreground border-warning/40", stripe: "bg-warning" },
  { pill: "bg-success/15 text-foreground border-success/40", stripe: "bg-success" },
  { pill: "bg-sky-500/12 text-foreground border-sky-500/40", stripe: "bg-sky-500" },
  { pill: "bg-rose-500/12 text-foreground border-rose-500/40", stripe: "bg-rose-500" },
];

function accentFor(index: number) {
  return CATEGORY_ACCENTS[index % CATEGORY_ACCENTS.length];
}

export function ProductGrid({
  categories,
  loading = false,
  onSelectItem,
}: {
  categories: MenuCategoryDto[];
  loading?: boolean;
  onSelectItem: (categoryId: string, item: MenuItemDto) => void;
}) {
  // Categories arrive async (fetched by the parent after mount), so a plain useState default of
  // categories[0]?.id would freeze at "" forever — derive the effective selection instead, falling
  // back to the first loaded category whenever the stored id doesn't (yet) match anything real.
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const activeCategoryId =
    selectedCategoryId && categories.some((c) => c.id === selectedCategoryId)
      ? selectedCategoryId
      : (categories[0]?.id ?? "");
  const activeCategory = categories.find((c) => c.id === activeCategoryId) ?? categories[0];

  const visibleItems = useMemo(() => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return categories.flatMap((c) => c.items.filter((i) => i.name.toLowerCase().includes(q)));
    }
    return activeCategory?.items ?? [];
  }, [categories, activeCategory, search]);

  return (
    <div className="flex h-full flex-col gap-4 bg-muted/25 p-5">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search menu…"
          // A placeholder disappears as soon as the cashier types, so it cannot be the only name
          // this field has.
          aria-label="Search menu"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-full border-none bg-card pl-9 shadow-sm"
        />
      </div>

      {!search.trim() && loading && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-full" />
          ))}
        </div>
      )}

      {!search.trim() && !loading && (
        <div className="flex flex-wrap gap-2">
          {categories.map((c, i) => {
            const active = c.id === activeCategoryId;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedCategoryId(c.id)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : `border-transparent ${accentFor(i).pill} hover:opacity-80`
                }`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pb-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {loading &&
          Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex min-h-[6.5rem] flex-col justify-between rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        {!loading &&
          visibleItems.map((item) => {
            const categoryIndex = categories.findIndex((c) => c.items.includes(item));
            return (
              <button
                key={item.id}
                disabled={!item.isAvailable}
                onClick={() => onSelectItem(categories[categoryIndex]?.id ?? activeCategoryId, item)}
                className="group relative flex min-h-[6.5rem] flex-col items-start overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
              >
                <span className={`absolute inset-x-0 top-0 h-1 ${accentFor(categoryIndex).stripe}`} />
                <div className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-tight">{item.name}</div>
                <div className="mt-2 flex w-full items-center justify-between">
                  <span className="font-heading text-base font-semibold text-primary">
                    {formatPkr(item.basePricePaisa)}
                  </span>
                  {item.variants.length > 0 && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
                      {item.variants.length} sizes
                    </span>
                  )}
                </div>
                {!item.isAvailable && (
                  <span className="absolute right-2 top-2 rounded-full bg-destructive/15 px-2 py-0.5 text-2xs font-semibold text-destructive">
                    Unavailable
                  </span>
                )}
              </button>
            );
          })}
        {!loading && visibleItems.length === 0 && (
          <div className="col-span-full py-12 text-center text-sm text-muted-foreground">No items found.</div>
        )}
      </div>
    </div>
  );
}
