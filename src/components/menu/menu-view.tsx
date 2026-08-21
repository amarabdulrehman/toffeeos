"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BookOpen, ChefHat, Lock, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPkr } from "@/lib/money";

interface MenuItemRow {
  id: string;
  name: string;
  categoryName: string;
  basePricePaisa: number;
  hasRecipe: boolean;
  isAvailable: boolean;
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

export function MenuView({ recipeEnabled }: { recipeEnabled: boolean }) {
  const [items, setItems] = useState<MenuItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItemRow | null>(null);

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
      await load();
    })();
  }, [load]);

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
      <div className="flex items-center gap-3">
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

      <Card className="mt-6 shadow-sm">
        <CardHeader>
          <CardTitle className="font-heading">Items</CardTitle>
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
                      <Button size="sm" variant="outline" onClick={() => toggleAvailability(item)}>
                        {item.isAvailable ? "Mark unavailable" : "Mark available"}
                      </Button>
                      {recipeEnabled && (
                        <Button size="sm" variant="outline" onClick={() => setEditingItem(item)}>
                          <ChefHat className="size-3.5" />
                          Edit recipe
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RecipeDialog
        item={editingItem}
        onClose={() => setEditingItem(null)}
        onSaved={() => {
          load();
        }}
      />
    </div>
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
