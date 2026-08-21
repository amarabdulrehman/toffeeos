"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LayoutGrid, QrCode, Trash2 } from "lucide-react";
import { generateQrDataUrl } from "@/lib/qr";

interface TableRow {
  id: string;
  label: string;
  seats: number;
  status: "AVAILABLE" | "RESERVED" | "BOOKED" | "OCCUPIED";
}
interface FloorRow {
  id: string;
  name: string;
  tables: TableRow[];
}

// Same status→color language as the POS Tables dialog (src/components/pos/tables-dialog.tsx) —
// one table's status should read the same whether a manager is looking at it here or a cashier is
// looking at it mid-shift.
const STATUS_VARIANT: Record<TableRow["status"], "secondary" | "info" | "default" | "warning"> = {
  AVAILABLE: "secondary",
  RESERVED: "info",
  BOOKED: "default",
  OCCUPIED: "warning",
};

export function TablesSettingsView({ qrOrderingEnabled }: { qrOrderingEnabled: boolean }) {
  const [floors, setFloors] = useState<FloorRow[]>([]);
  const [floorsLoading, setFloorsLoading] = useState(true);
  const [newFloorName, setNewFloorName] = useState("");
  const [addFloorOpen, setAddFloorOpen] = useState(false);
  const [addTableFor, setAddTableFor] = useState<string | null>(null);
  const [tableLabel, setTableLabel] = useState("");
  const [tableSeats, setTableSeats] = useState("4");
  const [tenantSlug, setTenantSlug] = useState("");
  const [qrTable, setQrTable] = useState<TableRow | null>(null);

  function load() {
    fetch("/api/tables")
      .then((r) => r.json())
      .then((d) => setFloors(d.floors ?? []))
      .finally(() => setFloorsLoading(false));
  }

  useEffect(load, []);
  useEffect(() => {
    // /api/tenant-branding is a Complete-tier ("online") feature — only fetch it if QR ordering is
    // actually available, so a Starter/Growth tenant doesn't take a 403 on every Tables page load.
    if (!qrOrderingEnabled) return;
    fetch("/api/tenant-branding")
      .then((r) => r.json())
      .then((d) => setTenantSlug(d.slug ?? ""));
  }, [qrOrderingEnabled]);

  async function createFloor() {
    if (!newFloorName.trim()) return;
    const res = await fetch("/api/floors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFloorName }),
    });
    if (!res.ok) {
      toast.error("Could not create floor.");
      return;
    }
    setNewFloorName("");
    setAddFloorOpen(false);
    load();
  }

  async function deleteFloor(id: string) {
    const res = await fetch(`/api/floors/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Could not delete floor.");
      return;
    }
    load();
  }

  async function createTable() {
    if (!addTableFor || !tableLabel.trim()) return;
    const res = await fetch("/api/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ floorId: addTableFor, label: tableLabel, seats: Number(tableSeats) || 4 }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Could not create table.");
      return;
    }
    setTableLabel("");
    setTableSeats("4");
    setAddTableFor(null);
    load();
  }

  async function deleteTable(id: string) {
    const res = await fetch(`/api/tables/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Could not delete table.");
      return;
    }
    load();
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Tables & Floors</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your floor plan for the dine-in POS flow.</p>
        </div>
        <Dialog open={addFloorOpen} onOpenChange={setAddFloorOpen}>
          <DialogTrigger render={<Button>+ Add floor</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-heading">New floor</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="floorName">Floor name</Label>
              <Input
                id="floorName"
                placeholder="e.g. First Floor"
                value={newFloorName}
                onChange={(e) => setNewFloorName(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button onClick={createFloor}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mt-8 space-y-6">
        {floorsLoading ? (
          <div className="space-y-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i} className="shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between">
                  <Skeleton className="h-5 w-32" />
                  <div className="flex gap-2">
                    <Skeleton className="h-8 w-24 rounded-md" />
                    <Skeleton className="h-8 w-24 rounded-md" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {Array.from({ length: 4 }).map((__, j) => (
                      <Skeleton key={j} className="h-14 w-32 rounded-xl" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <>
            {floors.length === 0 && (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-16 text-center">
                <LayoutGrid className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">No floors yet — add one to get started.</p>
              </div>
            )}
            {floors.map((floor) => (
              <Card key={floor.id} className="shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="font-heading text-base">{floor.name}</CardTitle>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setAddTableFor(floor.id)}>
                      + Add table
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => deleteFloor(floor.id)}>
                      Delete floor
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {floor.tables.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tables on this floor yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {floor.tables.map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 py-2 pl-3.5 pr-2 shadow-xs transition-colors hover:border-border"
                        >
                          <div>
                            <div className="text-sm font-semibold">{t.label}</div>
                            <div className="text-xs text-muted-foreground">{t.seats} seats</div>
                          </div>
                          <Badge variant={STATUS_VARIANT[t.status]}>{t.status}</Badge>
                          {qrOrderingEnabled && (
                            <Button size="icon-sm" variant="ghost" onClick={() => setQrTable(t)} title="QR code">
                              <QrCode className="size-4" />
                            </Button>
                          )}
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => deleteTable(t.id)}
                            title="Delete table"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>

      <Dialog open={!!addTableFor} onOpenChange={(o) => !o && setAddTableFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">New table</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="tableLabel">Table name / number</Label>
              <Input id="tableLabel" placeholder="T9" value={tableLabel} onChange={(e) => setTableLabel(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tableSeats">Seats</Label>
              <Input
                id="tableSeats"
                type="number"
                min={1}
                value={tableSeats}
                onChange={(e) => setTableSeats(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={createTable}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QrCodeDialog table={qrTable} tenantSlug={tenantSlug} onClose={() => setQrTable(null)} />
    </div>
  );
}

function QrCodeDialog({ table, tenantSlug, onClose }: { table: TableRow | null; tenantSlug: string; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const orderUrl =
    table && typeof window !== "undefined" ? `${window.location.origin}/order/${tenantSlug}?tableId=${table.id}` : "";

  useEffect(() => {
    if (!table || !orderUrl) return;
    generateQrDataUrl(orderUrl).then(setDataUrl);
  }, [table, orderUrl]);

  return (
    <Dialog open={!!table} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading">QR code — Table {table?.label}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, not a remote image
            <img src={dataUrl} alt={`QR code for table ${table?.label}`} className="size-64 rounded-xl border p-2 shadow-xs" />
          ) : (
            <div className="flex size-64 items-center justify-center rounded-xl border text-sm text-muted-foreground">
              Generating…
            </div>
          )}
          <p className="rounded-md bg-muted/60 px-3 py-1.5 text-center text-xs break-all text-muted-foreground">{orderUrl}</p>
          {dataUrl && (
            <a href={dataUrl} download={`table-${table?.label}-qr.png`}>
              <Button variant="outline">Download PNG</Button>
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
