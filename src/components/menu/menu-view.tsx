"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BookOpen, ChefHat, Lock, Pencil, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPkr } from "@/lib/money";
import { ItemOptionsDialog, ModifierGroupsDialog } from "./menu-options-dialogs";
import { BranchPricesDialog } from "./branch-prices-dialog";
import { MenuImportDialog } from "./menu-import-dialog";

interface MenuItemRow {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  description: string | null;
  basePricePaisa: number;
  hasRecipe: boolean;
  isAvailable: boolean;
}
interface CategoryRow {
  id: string;
  name: string;
  /** Live items in it — shown before a delete, since an empty category and a full one are very
   * different things to remove. */
  itemCount?: number;
}
interface InventoryItem {
  id: string;
  name: string;
  unitOfMeasure: string;
}
interface RecipeLine {
  id: string;
  quantityPerUnit: number;
  inventoryItem: InventoryItem;
}

export function MenuView({ recipeEnabled, canPricePerBranch = false }: { recipeEnabled: boolean; canPricePerBranch?: boolean }) {
  const [pricingItem, setPricingItem] = useState<{ id: string; name: string } | null>(null);
  const [items, setItems] = useState<MenuItemRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItemRow | null>(null);
  const [detailsItem, setDetailsItem] = useState<MenuItemRow | null>(null);
  const [deletingItem, setDeletingItem] = useState<MenuItemRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function deleteItem() {
    if (!deletingItem) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/menu-items/${deletingItem.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not delete this item.");
        return;
      }
      toast.success(`${deletingItem.name} removed from the menu.`);
      setDeletingItem(null);
      load();
    } finally {
      setDeleting(false);
    }
  }
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [optionsItem, setOptionsItem] = useState<MenuItemRow | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const loadCategories = useCallback(async () => {
    const r = await fetch("/api/menu/categories");
    const body = await r.json().catch(() => ({}));
    if (r.ok) setCategories(body.categories ?? []);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/menu-items");
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(body.error ?? "Could not load the menu.");
        return;
      }
      setError(null);
      setItems(body.items ?? []);
    } catch {
      setError("Could not load the menu.");
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([load(), loadCategories()]);
    })();
  }, [load, loadCategories]);

  async function toggleAvailability(item: MenuItemRow) {
    const res = await fetch(`/api/menu-items/${item.id}/availability`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isAvailable: !item.isAvailable }),
    });
    if (!res.ok) {
      toast.error("Could not update availability.");
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isAvailable: !i.isAvailable } : i)));
  }

  return (
    <div className="p-8">
      {/* Wraps rather than shrinks: at 390px the title and two buttons do not fit on one line, and a
          shrink-0 button group with nowhere to go pushes the whole page sideways instead. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BookOpen className="size-5" />
          </span>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">Menu</h1>
            <p className="text-sm text-muted-foreground">
              Set a recipe per item to enable automatic stock deduction and cost/margin reporting. Availability here is
              what POS, KDS, and the online ordering site all read — mark an item unavailable (&ldquo;86 it&rdquo;) and
              it greys out everywhere at once, for this branch.
            </p>
          </div>
        </div>
        {/* Wraps and may shrink. Three buttons do not fit beside the title at 390px, and a
            shrink-0 row with nowhere to go pushes the whole page sideways — which is exactly what
            adding the third one did, caught by the responsive suite at 393 against 390. */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            Import menu
          </Button>
          <Button variant="outline" onClick={() => setGroupsOpen(true)}>
            Add-on groups
          </Button>
          <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
            Categories
          </Button>
          <Button variant="outline" onClick={() => setAddCategoryOpen(true)}>
            + Add category
          </Button>
        </div>
      </div>

      <Card className="mt-6 shadow-sm transition-shadow hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-heading">Items</CardTitle>
          <Button
            size="sm"
            onClick={() => setAddItemOpen(true)}
            disabled={categories.length === 0}
            title={categories.length === 0 ? "Add a category first" : undefined}
          >
            + Add item
          </Button>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <Lock className="size-6 text-muted-foreground/50" />
              {error}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Price</TableHead>
                  {recipeEnabled && <TableHead>Recipe</TableHead>}
                  <TableHead>Available</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={recipeEnabled ? 6 : 5} className="py-10 text-center text-muted-foreground">
                      {categories.length === 0
                        ? "No categories yet — add one to start building your menu."
                        : "No items yet — add your first menu item."}
                    </TableCell>
                  </TableRow>
                )}
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className={`font-medium ${!item.isAvailable ? "text-muted-foreground line-through" : ""}`}>
                      {item.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.categoryName}</TableCell>
                    <TableCell className="tabular-nums">{formatPkr(item.basePricePaisa)}</TableCell>
                    {recipeEnabled && (
                      <TableCell>
                        {item.hasRecipe ? (
                          <Badge variant="success">Recipe set</Badge>
                        ) : (
                          <Badge variant="warning">No recipe</Badge>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant={item.isAvailable ? "success" : "destructive"}>
                        {item.isAvailable ? "Available" : "86'd"}
                      </Badge>
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => setDetailsItem(item)}>
                        <Pencil className="size-3.5" />
                        Edit details
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => toggleAvailability(item)}>
                        {item.isAvailable ? "Mark unavailable" : "Mark available"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setOptionsItem(item)}>
                        <SlidersHorizontal className="size-3.5" />
                        Sizes &amp; add-ons
                      </Button>
                      {recipeEnabled && (
                        <Button size="sm" variant="outline" onClick={() => setEditingItem(item)}>
                          <ChefHat className="size-3.5" />
                          Edit recipe
                        </Button>
                      )}
                      {canPricePerBranch && (
                        <Button size="sm" variant="outline" onClick={() => setPricingItem({ id: item.id, name: item.name })}>
                          Branch prices
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeletingItem(item)}
                        aria-label={`Delete ${item.name}`}
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CategoriesDialog
        open={categoriesOpen}
        categories={categories}
        onClose={() => setCategoriesOpen(false)}
        onChanged={() => {
          loadCategories();
          load();
        }}
      />

      <EditItemDialog
        key={detailsItem?.id ?? "closed"}
        item={detailsItem}
        categories={categories}
        onClose={() => setDetailsItem(null)}
        onSaved={() => {
          setDetailsItem(null);
          load();
        }}
      />

      <Dialog open={!!deletingItem} onOpenChange={(o) => !o && setDeletingItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">Delete {deletingItem?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            It comes off the till and the online menu straight away. Past orders, receipts and sales
            reports that include it are kept exactly as they are.
          </p>
          <p className="text-sm text-muted-foreground">
            Only out for today? Use <span className="font-medium text-foreground">Mark unavailable</span> instead — that is
            undone with one click.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingItem(null)} disabled={deleting}>
              Never mind
            </Button>
            <Button variant="destructive" onClick={deleteItem} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecipeDialog
        item={editingItem}
        onClose={() => setEditingItem(null)}
        onSaved={() => {
          load();
        }}
      />

      <AddCategoryDialog
        open={addCategoryOpen}
        onClose={() => setAddCategoryOpen(false)}
        onCreated={() => {
          setAddCategoryOpen(false);
          loadCategories();
        }}
      />

      <ItemOptionsDialog item={optionsItem} onClose={() => setOptionsItem(null)} />

      <BranchPricesDialog item={pricingItem} onClose={() => setPricingItem(null)} />

      <ModifierGroupsDialog open={groupsOpen} onClose={() => setGroupsOpen(false)} />

      <MenuImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          load();
          loadCategories();
        }}
      />

      <AddItemDialog
        open={addItemOpen}
        categories={categories}
        onClose={() => setAddItemOpen(false)}
        onCreated={() => {
          setAddItemOpen(false);
          load();
        }}
      />
    </div>
  );
}

function AddCategoryDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not create category.");
        return;
      }
      toast.success("Category added.");
      setName("");
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading">New category</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="categoryName">Category name</Label>
          <Input
            id="categoryName"
            placeholder="e.g. Starters"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? "Adding…" : "Add category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Every category with how many items it holds, and a way to delete one.
 *
 * Deleting takes the category's items off the menu with it — the alternative, refusing until each
 * item has been removed by hand, is a chore nobody deleting a whole section wants. The confirm step
 * says how many items go before anything happens.
 */
function CategoriesDialog({
  open,
  categories,
  onClose,
  onChanged,
}: {
  open: boolean;
  categories: CategoryRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState<CategoryRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirming) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/menu/categories/${confirming.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not delete this category.");
        return;
      }
      toast.success(
        data.itemsRemoved > 0
          ? `${confirming.name} and its ${data.itemsRemoved} item${data.itemsRemoved === 1 ? "" : "s"} removed from the menu.`
          : `${confirming.name} removed.`
      );
      setConfirming(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const count = confirming?.itemCount ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setConfirming(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        {confirming ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-heading">Delete {confirming.name}?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {count > 0 ? (
                <>
                  Its <span className="font-medium text-foreground">{count} item{count === 1 ? "" : "s"}</span> come off
                  the till and the online menu with it.
                </>
              ) : (
                <>It has no items on the menu.</>
              )}{" "}
              Past orders, receipts and sales reports are kept exactly as they are.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
                Never mind
              </Button>
              <Button variant="destructive" onClick={remove} disabled={busy}>
                {busy ? "Deleting…" : count > 0 ? `Delete category and ${count} item${count === 1 ? "" : "s"}` : "Delete category"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-heading">Categories</DialogTitle>
            </DialogHeader>
            {categories.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No categories yet.</p>
            ) : (
              <ul className="max-h-[60dvh] divide-y overflow-y-auto">
                {categories.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.itemCount ?? 0} item{c.itemCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setConfirming(c)}
                      aria-label={`Delete category ${c.name}`}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Name, category, price and description of an existing item — the fields chosen when it was made. */
function EditItemDialog({
  item,
  categories,
  onClose,
  onSaved,
}: {
  item: MenuItemRow | null;
  categories: CategoryRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Remounted per item (key on the caller), so these start from the item every time it opens.
  const [name, setName] = useState(item?.name ?? "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "");
  const [price, setPrice] = useState(item ? String(item.basePricePaisa / 100) : "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [saving, setSaving] = useState(false);

  const priceNumber = Number(price);
  const valid = name.trim() !== "" && categoryId !== "" && price.trim() !== "" && Number.isFinite(priceNumber) && priceNumber >= 0;

  async function save() {
    if (!item || !valid) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/menu-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          categoryId,
          basePricePaisa: Math.round(priceNumber * 100),
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not save changes.");
        return;
      }
      toast.success("Changes saved.");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading">Edit {item?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="editItemName">Item name</Label>
            <Input id="editItemName" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={(v) => v && setCategoryId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a category">
                  {(v: string) => categories.find((c) => c.id === v)?.name ?? item?.categoryName ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="editItemPrice">Price (Rs)</Label>
            <Input
              id="editItemPrice"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            {/* Orders already on the floor keep the price they were rung up at; only new ones change. */}
            <p className="text-xs text-muted-foreground">Applies to new orders. Orders already placed keep their price.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="editItemDescription">Description (optional)</Label>
            <Input id="editItemDescription" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !valid}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddItemDialog({
  open,
  categories,
  onClose,
  onCreated,
}: {
  open: boolean;
  categories: CategoryRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName("");
    setCategoryId("");
    setPrice("");
    setDescription("");
  }

  async function submit() {
    if (!name.trim() || !categoryId || !price) {
      toast.error("Name, category, and price are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/menu-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          categoryId,
          basePricePaisa: Math.round(Number(price) * 100),
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not create item.");
        return;
      }
      toast.success("Item added.");
      reset();
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading">New menu item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="itemName">Item name</Label>
            <Input id="itemName" placeholder="e.g. Chicken Karahi" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={(v) => v && setCategoryId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a category">
                  {(v: string) => categories.find((c) => c.id === v)?.name ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="itemPrice">Price (Rs)</Label>
            <Input id="itemPrice" type="number" placeholder="e.g. 450" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="itemDescription">Description (optional)</Label>
            <Input id="itemDescription" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={submitting || !name.trim() || !categoryId || !price}>
            {submitting ? "Adding…" : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecipeDialog({
  item,
  onClose,
  onSaved,
}: {
  item: MenuItemRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [ingredients, setIngredients] = useState<InventoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ingredientId, setIngredientId] = useState("");
  const [qty, setQty] = useState("");

  useEffect(() => {
    if (!item) return;
    (async () => {
      setError(null);
      try {
        const [recipeRes, ingredientsRes] = await Promise.all([
          fetch(`/api/menu-items/${item.id}/recipe`),
          fetch("/api/inventory/items"),
        ]);
        const recipeBody = await recipeRes.json().catch(() => ({}));
        const ingredientsBody = await ingredientsRes.json().catch(() => ({}));
        if (!recipeRes.ok) {
          setError(recipeBody.error ?? "Could not load this recipe.");
          return;
        }
        setLines(recipeBody.lines ?? []);
        setIngredients(ingredientsRes.ok ? ingredientsBody.items ?? [] : []);
      } catch {
        setError("Could not load this recipe.");
      }
    })();
  }, [item]);

  async function addLine() {
    if (!item || !ingredientId || !qty) return;
    const res = await fetch(`/api/menu-items/${item.id}/recipe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventoryItemId: ingredientId, quantityPerUnit: Number(qty) }),
    });
    if (!res.ok) {
      toast.error("Could not add ingredient.");
      return;
    }
    setQty("");
    setIngredientId("");
    const refreshed = await fetch(`/api/menu-items/${item.id}/recipe`).then((r) => r.json());
    setLines(refreshed.lines ?? []);
    onSaved();
  }

  async function removeLine(lineId: string) {
    const res = await fetch(`/api/recipe-lines/${lineId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not remove ingredient.");
      return;
    }
    setLines((prev) => prev.filter((l) => l.id !== lineId));
    onSaved();
  }

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading">Recipe — {item?.name}</DialogTitle>
        </DialogHeader>
        {error ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <Lock className="size-6 text-muted-foreground/50" />
            {error}
          </div>
        ) : (
          <div className="space-y-3">
            {lines.length === 0 && <p className="text-sm text-muted-foreground">No ingredients yet.</p>}
            {lines.map((line) => (
              <div key={line.id} className="flex items-center justify-between rounded-xl border bg-muted/20 p-2.5">
                <span className="text-sm">
                  <span className="font-medium">{line.inventoryItem.name}</span>
                  <span className="text-muted-foreground"> — {line.quantityPerUnit} {line.inventoryItem.unitOfMeasure} / unit sold</span>
                </span>
                <button
                  onClick={() => removeLine(line.id)}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}

            <div className="flex gap-2 border-t pt-3">
              <Select value={ingredientId} onValueChange={(v) => v && setIngredientId(v)}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Ingredient">
                    {(v: string) => {
                      const i = ingredients.find((ing) => ing.id === v);
                      return i ? `${i.name} (${i.unitOfMeasure})` : v;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ingredients.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name} ({i.unitOfMeasure})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Qty per unit"
                className="w-32"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
              <Button onClick={addLine}>Add</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
