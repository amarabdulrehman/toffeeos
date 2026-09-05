"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  Boxes,
  Lock,
  MapPin,
  Package,
  PackagePlus,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Warehouse,
} from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface Location {
  id: string;
  name: string;
}
interface Item {
  id: string;
  name: string;
  unitOfMeasure: string;
  lowStockThresholdQty: number;
}
interface StockRow {
  locationId: string;
  locationName: string;
  itemId: string;
  itemName: string;
  unitOfMeasure: string;
  quantity: number;
  thresholdQty: number;
  belowThreshold: boolean;
}

/** GET-only fetch that never lets a non-200 body get treated as real data — same pattern as
 * Reports/CRM (see reports-view.tsx / customers-view.tsx for the fuller writeup of why). */
async function safeGet<T>(url: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const r = await fetch(url);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { data: null, error: body.error ?? "Could not load this." };
    return { data: body as T, error: null };
  } catch {
    return { data: null, error: "Could not load this." };
  }
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
      <Lock className="size-6 text-muted-foreground/50" />
      {message}
    </div>
  );
}

export function InventoryView() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [report, setReport] = useState<StockRow[]>([]);
  const [belowOnly, setBelowOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [locRes, itemRes] = await Promise.all([
      safeGet<{ locations: Location[] }>("/api/inventory/locations"),
      safeGet<{ items: Item[] }>("/api/inventory/items"),
    ]);
    if (locRes.error || itemRes.error) {
      setError(locRes.error ?? itemRes.error);
      return;
    }
    setError(null);
    setLocations(locRes.data?.locations ?? []);
    setItems(itemRes.data?.items ?? []);
  }, []);

  const loadReport = useCallback(async () => {
    const res = await safeGet<{ rows: StockRow[] }>(
      `/api/inventory/report${belowOnly ? "?belowThresholdOnly=true" : ""}`
    );
    if (res.error) {
      setError(res.error);
      return;
    }
    setReport(res.data?.rows ?? []);
  }, [belowOnly]);

  useEffect(() => {
    (async () => {
      await loadAll();
    })();
  }, [loadAll]);
  useEffect(() => {
    (async () => {
      await loadReport();
    })();
  }, [loadReport]);

  return (
    <div className="p-8">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Boxes className="size-5" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground">Stock locations, items, and movements for this branch.</p>
        </div>
      </div>

      {error ? (
        <Card className="mt-6 shadow-sm transition-shadow hover:shadow-md">
          <CardContent className="pt-6">
            <LoadError message={error} />
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="report" className="mt-6">
          <TabsList className="h-auto flex-wrap gap-1 bg-muted/60 p-1">
            <TabsTrigger value="report" className="gap-1.5"><Warehouse className="size-3.5" />Stock report</TabsTrigger>
            <TabsTrigger value="locations" className="gap-1.5"><MapPin className="size-3.5" />Locations</TabsTrigger>
            <TabsTrigger value="items" className="gap-1.5"><Package className="size-3.5" />Items</TabsTrigger>
            <TabsTrigger value="grn" className="gap-1.5"><PackagePlus className="size-3.5" />Receive stock</TabsTrigger>
            <TabsTrigger value="adjustment" className="gap-1.5"><SlidersHorizontal className="size-3.5" />Adjust</TabsTrigger>
            <TabsTrigger value="transfer" className="gap-1.5"><ArrowLeftRight className="size-3.5" />Transfer</TabsTrigger>
          </TabsList>

          <TabsContent value="report" className="mt-4 space-y-4">
            {report.length > 0 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <StatCard label="Items tracked" value={report.length} icon={Package} hero />
                <StatCard
                  label="Below threshold"
                  value={report.filter((r) => r.belowThreshold).length}
                  icon={TriangleAlert}
                  tone={report.some((r) => r.belowThreshold) ? "warning" : undefined}
                  hero={report.some((r) => r.belowThreshold)}
                />
              </div>
            )}
            <Card className="shadow-sm transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-heading">Current stock</CardTitle>
                <Button size="sm" variant={belowOnly ? "default" : "outline"} onClick={() => setBelowOnly((b) => !b)}>
                  {belowOnly ? "Showing: below threshold" : "Show below threshold only"}
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Threshold</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                          No stock recorded yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {report.map((r) => (
                      <TableRow
                        key={`${r.locationId}-${r.itemId}`}
                        className={r.belowThreshold ? "border-l-2 border-l-warning" : ""}
                      >
                        <TableCell className="font-medium">{r.itemName}</TableCell>
                        <TableCell className="text-muted-foreground">{r.locationName}</TableCell>
                        <TableCell className="tabular-nums">
                          {r.quantity} {r.unitOfMeasure}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {r.thresholdQty} {r.unitOfMeasure}
                        </TableCell>
                        <TableCell>
                          {r.belowThreshold ? (
                            <Badge variant="warning">Low stock</Badge>
                          ) : (
                            <Badge variant="success">OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="locations" className="mt-4">
            <LocationsTab locations={locations} onChanged={loadAll} />
          </TabsContent>

          <TabsContent value="items" className="mt-4">
            <ItemsTab items={items} onChanged={loadAll} />
          </TabsContent>

          <TabsContent value="grn" className="mt-4">
            <GrnTab locations={locations} items={items} onChanged={loadReport} />
          </TabsContent>

          <TabsContent value="adjustment" className="mt-4">
            <AdjustmentTab locations={locations} items={items} onChanged={loadReport} />
          </TabsContent>

          <TabsContent value="transfer" className="mt-4">
            <TransferTab locations={locations} items={items} onChanged={loadReport} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function LocationsTab({ locations, onChanged }: { locations: Location[]; onChanged: () => void }) {
  const [name, setName] = useState("");

  async function create() {
    if (!name.trim()) return;
    const res = await fetch("/api/inventory/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      toast.error("Could not create location.");
      return;
    }
    setName("");
    onChanged();
  }

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="font-heading">Stock locations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input placeholder="e.g. Main storeroom" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={create}>Add</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {locations.map((l) => (
            <Badge key={l.id} variant="secondary" className="gap-1 py-1">
              <MapPin className="size-3" />
              {l.name}
            </Badge>
          ))}
          {locations.length === 0 && <p className="text-sm text-muted-foreground">No locations yet.</p>}
        </div>
      </CardContent>
      <CardContent className="border-t pt-4">
        <DefaultConsumptionLocation locations={locations} />
      </CardContent>
    </Card>
  );
}

/** Which location recipe consumption (Phase 3) deducts from when an order is paid. Falls back to
 * the branch's oldest location automatically if left unset — this is optional, not required. */
function DefaultConsumptionLocation({ locations }: { locations: Location[] }) {
  const [value, setValue] = useState<string>("");

  useEffect(() => {
    safeGet<{ settings?: { defaultStockLocationId?: string } }>("/api/branch-settings").then(({ data }) => {
      setValue(data?.settings?.defaultStockLocationId ?? "");
    });
  }, []);

  async function save(locationId: string) {
    setValue(locationId);
    const res = await fetch("/api/branch-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultStockLocationId: locationId }),
    });
    if (!res.ok) toast.error("Could not save.");
  }

  return (
    <div className="space-y-1.5">
      <Label>Recipe consumption location</Label>
      <p className="text-xs text-muted-foreground">
        When an order is paid, recipe ingredients are deducted from this location. Defaults to the oldest location if unset.
      </p>
      <Select value={value} onValueChange={(v) => v && save(v)}>
        <SelectTrigger className="w-64">
          <SelectValue placeholder="Auto (oldest location)">
            {(v: string) => locations.find((l) => l.id === v)?.name ?? v}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {locations.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ItemsTab({ items, onChanged }: { items: Item[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [threshold, setThreshold] = useState("0");
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function create() {
    if (!name.trim() || !unit.trim()) return;
    const res = await fetch("/api/inventory/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, unitOfMeasure: unit, lowStockThresholdQty: Number(threshold) || 0 }),
    });
    if (!res.ok) {
      toast.error("Could not create item.");
      return;
    }
    setName("");
    setUnit("");
    setThreshold("0");
    onChanged();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/inventory/items/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not delete item.");
        return;
      }
      toast.success(`${deleteTarget.name} deleted.`);
      setDeleteTarget(null);
      onChanged();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="font-heading">Inventory items</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Input placeholder="Item name (e.g. Chicken)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Unit (kg, ltr, pcs)" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <Input
            type="number"
            placeholder="Low-stock threshold"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
          <Button onClick={create}>Add item</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Threshold</TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No items yet.
                </TableCell>
              </TableRow>
            )}
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium">{i.name}</TableCell>
                <TableCell className="text-muted-foreground">{i.unitOfMeasure}</TableCell>
                <TableCell className="tabular-nums">{i.lowStockThresholdQty}</TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(i)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes it from stock-in, adjustment, transfer, and recipe pickers going forward. Past
            stock movements, reports, and any recipes already using it are kept exactly as they are.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Never mind
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ItemLocationPicker({
  locations,
  items,
  locationId,
  itemId,
  onLocationChange,
  onItemChange,
}: {
  locations: Location[];
  items: Item[];
  locationId: string;
  itemId: string;
  onLocationChange: (v: string) => void;
  onItemChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Select value={locationId} onValueChange={(v) => v && onLocationChange(v)}>
        <SelectTrigger>
          <SelectValue placeholder="Location">{(v: string) => locations.find((l) => l.id === v)?.name ?? v}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {locations.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={itemId} onValueChange={(v) => v && onItemChange(v)}>
        <SelectTrigger>
          <SelectValue placeholder="Item">
            {(v: string) => {
              const i = items.find((it) => it.id === v);
              return i ? `${i.name} (${i.unitOfMeasure})` : v;
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name} ({i.unitOfMeasure})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function GrnTab({ locations, items, onChanged }: { locations: Location[]; items: Item[]; onChanged: () => void }) {
  const [locationId, setLocationId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");

  async function submit() {
    if (!locationId || !itemId || !quantity) {
      toast.error("Location, item, and quantity are required.");
      return;
    }
    const res = await fetch("/api/inventory/grn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId,
        itemId,
        quantity: Number(quantity),
        costPaisa: cost ? Math.round(Number(cost) * 100) : undefined,
        supplierName: supplier || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Could not record stock in.");
      return;
    }
    toast.success("Stock received.");
    setQuantity("");
    setCost("");
    setSupplier("");
    onChanged();
  }

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="font-heading">Receive stock (GRN)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ItemLocationPicker
          locations={locations}
          items={items}
          locationId={locationId}
          itemId={itemId}
          onLocationChange={setLocationId}
          onItemChange={setItemId}
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Quantity received</Label>
            <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Cost (Rs, optional)</Label>
            <Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Supplier (optional)</Label>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
        </div>
        <Button variant="success" onClick={submit}>Record stock in</Button>
      </CardContent>
    </Card>
  );
}

function AdjustmentTab({ locations, items, onChanged }: { locations: Location[]; items: Item[]; onChanged: () => void }) {
  const [locationId, setLocationId] = useState("");
  const [itemId, setItemId] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  async function submit() {
    if (!locationId || !itemId || !delta || !reason.trim()) {
      toast.error("Location, item, quantity, and reason are all required.");
      return;
    }
    const res = await fetch("/api/inventory/adjustment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, itemId, quantityDelta: Number(delta), reason }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Could not record adjustment.");
      return;
    }
    toast.success("Adjustment recorded.");
    setDelta("");
    setReason("");
    onChanged();
  }

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="font-heading">Stock adjustment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ItemLocationPicker
          locations={locations}
          items={items}
          locationId={locationId}
          itemId={itemId}
          onLocationChange={setLocationId}
          onItemChange={setItemId}
        />
        <div className="space-y-1">
          <Label>Quantity change (negative for a decrease, e.g. -2.5 for spoilage)</Label>
          <Input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Reason (required)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Spoilage — 2.5kg discarded" />
        </div>
        <Button onClick={submit}>Record adjustment</Button>
      </CardContent>
    </Card>
  );
}

function TransferTab({ locations, items, onChanged }: { locations: Location[]; items: Item[]; onChanged: () => void }) {
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");

  async function submit() {
    if (!fromLocationId || !toLocationId || !itemId || !quantity) {
      toast.error("All fields are required.");
      return;
    }
    const res = await fetch("/api/inventory/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromLocationId, toLocationId, itemId, quantity: Number(quantity) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Could not record transfer.");
      return;
    }
    toast.success("Transfer recorded.");
    setQuantity("");
    onChanged();
  }

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="font-heading">Stock transfer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>From location</Label>
            <Select value={fromLocationId} onValueChange={(v) => v && setFromLocationId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Source">{(v: string) => locations.find((l) => l.id === v)?.name ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>To location</Label>
            <Select value={toLocationId} onValueChange={(v) => v && setToLocationId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Destination">{(v: string) => locations.find((l) => l.id === v)?.name ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Select value={itemId} onValueChange={(v) => v && setItemId(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Item">
                {(v: string) => {
                  const i = items.find((it) => it.id === v);
                  return i ? `${i.name} (${i.unitOfMeasure})` : v;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {items.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name} ({i.unitOfMeasure})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="number" placeholder="Quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <Button onClick={submit}>
          <ArrowLeftRight className="size-4" />
          Record transfer
        </Button>
      </CardContent>
    </Card>
  );
}
