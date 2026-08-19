"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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

export default function InventoryPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [report, setReport] = useState<StockRow[]>([]);
  const [belowOnly, setBelowOnly] = useState(false);

  const loadAll = useCallback(() => {
    fetch("/api/inventory/locations")
      .then((r) => r.json())
      .then((d) => setLocations(d.locations ?? []));
    fetch("/api/inventory/items")
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []));
  }, []);

  const loadReport = useCallback(() => {
    fetch(`/api/inventory/report${belowOnly ? "?belowThresholdOnly=true" : ""}`)
      .then((r) => r.json())
      .then((d) => setReport(d.rows ?? []));
  }, [belowOnly]);

  useEffect(loadAll, [loadAll]);
  useEffect(loadReport, [loadReport]);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Inventory</h1>
      <p className="text-muted-foreground">Stock locations, items, and movements for this branch.</p>

      <Tabs defaultValue="report" className="mt-6">
        <TabsList>
          <TabsTrigger value="report">Stock report</TabsTrigger>
          <TabsTrigger value="locations">Locations</TabsTrigger>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="grn">Receive stock</TabsTrigger>
          <TabsTrigger value="adjustment">Adjust</TabsTrigger>
          <TabsTrigger value="transfer">Transfer</TabsTrigger>
        </TabsList>

        <TabsContent value="report" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Current stock</CardTitle>
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
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No stock recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {report.map((r) => (
                    <TableRow key={`${r.locationId}-${r.itemId}`}>
                      <TableCell>{r.itemName}</TableCell>
                      <TableCell>{r.locationName}</TableCell>
                      <TableCell>
                        {r.quantity} {r.unitOfMeasure}
                      </TableCell>
                      <TableCell>
                        {r.thresholdQty} {r.unitOfMeasure}
                      </TableCell>
                      <TableCell>
                        {r.belowThreshold ? (
                          <Badge variant="destructive">Low stock</Badge>
                        ) : (
                          <Badge variant="secondary">OK</Badge>
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
    <Card>
      <CardHeader>
        <CardTitle>Stock locations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input placeholder="e.g. Main storeroom" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={create}>Add</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {locations.map((l) => (
            <Badge key={l.id} variant="secondary">
              {l.name}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ItemsTab({ items, onChanged }: { items: Item[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [threshold, setThreshold] = useState("0");

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory items</CardTitle>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.name}</TableCell>
                <TableCell>{i.unitOfMeasure}</TableCell>
                <TableCell>{i.lowStockThresholdQty}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
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
          <SelectValue placeholder="Location" />
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
          <SelectValue placeholder="Item" />
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
    <Card>
      <CardHeader>
        <CardTitle>Receive stock (GRN)</CardTitle>
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
        <Button onClick={submit}>Record stock in</Button>
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
    <Card>
      <CardHeader>
        <CardTitle>Stock adjustment</CardTitle>
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
    <Card>
      <CardHeader>
        <CardTitle>Stock transfer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>From location</Label>
            <Select value={fromLocationId} onValueChange={(v) => v && setFromLocationId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Source" />
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
                <SelectValue placeholder="Destination" />
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
              <SelectValue placeholder="Item" />
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
        <Button onClick={submit}>Record transfer</Button>
      </CardContent>
    </Card>
  );
}
