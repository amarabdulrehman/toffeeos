"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPkr } from "@/lib/money";
import type { MenuCategoryDto, MenuItemDto } from "./types";

export function ProductGrid({
  categories,
  onSelectItem,
}: {
  categories: MenuCategoryDto[];
  onSelectItem: (categoryId: string, item: MenuItemDto) => void;
}) {
  const [activeCategoryId, setActiveCategoryId] = useState<string>(categories[0]?.id ?? "");
  const [search, setSearch] = useState("");

  const activeCategory = categories.find((c) => c.id === activeCategoryId) ?? categories[0];

  const visibleItems = useMemo(() => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return categories.flatMap((c) => c.items.filter((i) => i.name.toLowerCase().includes(q)));
    }
    return activeCategory?.items ?? [];
  }, [categories, activeCategory, search]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <Input
        placeholder="Search menu…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {!search.trim() && (
        <Tabs value={activeCategoryId} onValueChange={setActiveCategoryId}>
          <TabsList className="flex h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
            {categories.map((c) => (
              <TabsTrigger
                key={c.id}
                value={c.id}
                className="rounded-full border data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                {c.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pb-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {visibleItems.map((item) => {
          const categoryId = categories.find((c) => c.items.includes(item))?.id ?? activeCategoryId;
          return (
            <button
              key={item.id}
              disabled={!item.isAvailable}
              onClick={() => onSelectItem(categoryId, item)}
              className="flex flex-col items-start rounded-xl border bg-card p-3 text-left shadow-sm transition hover:border-primary hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
            >
              <div className="flex h-20 w-full items-center justify-center rounded-lg bg-muted text-3xl">🍽️</div>
              <div className="mt-2 line-clamp-2 text-sm font-medium">{item.name}</div>
              <div className="mt-1 text-sm font-semibold text-primary">{formatPkr(item.basePricePaisa)}</div>
              {!item.isAvailable && <div className="text-xs text-destructive">Unavailable</div>}
            </button>
          );
        })}
        {visibleItems.length === 0 && (
          <div className="col-span-full py-12 text-center text-sm text-muted-foreground">No items found.</div>
        )}
      </div>
    </div>
  );
}
