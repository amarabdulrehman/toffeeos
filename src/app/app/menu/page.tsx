"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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

export default function MenuManagementPage() {
  const [items, setItems] = useState<MenuItemRow[]>([]);
  const [editingItem, setEditingItem] = useState<MenuItemRow | null>(null);

  const load = useCallback(() => {
    fetch("/api/menu-items")
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []));
  }, []);

  useEffect(load, [load]);

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
      <h1 className="text-2xl font-bold">Menu</h1>
      <p className="text-muted-foreground">
        Set a recipe per item to enable automatic stock deduction and cost/margin reporting. Availability here is what
        POS, KDS, and the online ordering site all read — mark an item unavailable (&ldquo;86 it&rdquo;) and it greys
        out everywhere at once, for this branch.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Recipe</TableHead>
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
                  <TableCell>{item.categoryName}</TableCell>
                  <TableCell>{formatPkr(item.basePricePaisa)}</TableCell>
                  <TableCell>
                    {item.hasRecipe ? (
                      <Badge variant="secondary">Recipe set</Badge>
                    ) : (
                      <Badge variant="destructive">No recipe</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.isAvailable ? "secondary" : "destructive"}>
                      {item.isAvailable ? "Available" : "86'd"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => toggleAvailability(item)}>
                      {item.isAvailable ? "Mark unavailable" : "Mark available"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingItem(item)}>
                      Edit recipe
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
  const [ingredientId, setIngredientId] = useState("");
  const [qty, setQty] = useState("");

  useEffect(() => {
    if (!item) return;
    fetch(`/api/menu-items/${item.id}/recipe`)
      .then((r) => r.json())
      .then((d) => setLines(d.lines ?? []));
    fetch("/api/inventory/items")
      .then((r) => r.json())
      .then((d) => setIngredients(d.items ?? []));
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
          <DialogTitle>Recipe — {item?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {lines.length === 0 && <p className="text-sm text-muted-foreground">No ingredients yet.</p>}
          {lines.map((line) => (
            <div key={line.id} className="flex items-center justify-between rounded-lg border p-2">
              <span>
                {line.inventoryItem.name} — {line.quantityPerUnit} {line.inventoryItem.unitOfMeasure} / unit sold
              </span>
              <button onClick={() => removeLine(line.id)} className="text-muted-foreground hover:text-destructive">
                ✕
              </button>
            </div>
          ))}

          <div className="flex gap-2 border-t pt-3">
            <Select value={ingredientId} onValueChange={(v) => v && setIngredientId(v)}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Ingredient" />
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
      </DialogContent>
    </Dialog>
  );
}
