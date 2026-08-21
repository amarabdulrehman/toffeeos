"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Settings {
  enabled: boolean;
  lowStockAlertsEnabled: boolean;
  dailySummaryEnabled: boolean;
  winBackEnabled: boolean;
  deliveryUpdatesEnabled: boolean;
}

interface Recipient {
  id: string;
  label: string;
  phone: string;
}

interface Template {
  id: string;
  key: string;
  name: string;
  bodyText: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
}

interface MessageLogRow {
  id: string;
  toPhone: string;
  templateKey: string;
  status: string;
  createdAt: string;
}

const TEMPLATE_LABELS: Record<string, string> = {
  low_stock_alert: "Low-stock alert (to staff)",
  daily_summary: "Daily business summary (to staff)",
  win_back_30d: "Customer win-back, 30+ days inactive",
  delivery_picked_up: "Delivery picked up (to customer)",
  delivery_delivered: "Delivery delivered (to customer)",
};

const STATUS_VARIANT: Record<Template["status"], "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  PENDING_APPROVAL: "outline",
  APPROVED: "secondary",
  REJECTED: "destructive",
};

export function WhatsAppView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [messages, setMessages] = useState<MessageLogRow[]>([]);
  const [newRecipient, setNewRecipient] = useState({ label: "", phone: "" });
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [sendingWinBack, setSendingWinBack] = useState(false);
  const [sendingSummary, setSendingSummary] = useState(false);

  const load = useCallback(() => {
    fetch("/api/whatsapp/settings").then((r) => r.json()).then(setSettings);
    fetch("/api/whatsapp/recipients").then((r) => r.json()).then((d) => setRecipients(d.recipients ?? []));
    fetch("/api/whatsapp/templates").then((r) => r.json()).then((d) => setTemplates(d.templates ?? []));
    fetch("/api/whatsapp/messages").then((r) => r.json()).then((d) => setMessages(d.messages ?? []));
  }, []);

  useEffect(load, [load]);

  async function toggleSetting(key: keyof Settings, value: boolean) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    const res = await fetch("/api/whatsapp/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    if (!res.ok) {
      toast.error("Could not update setting.");
      load();
    }
  }

  async function addRecipient() {
    if (!newRecipient.label.trim() || !newRecipient.phone.trim()) return;
    const res = await fetch("/api/whatsapp/recipients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newRecipient),
    });
    if (!res.ok) {
      toast.error("Could not add recipient.");
      return;
    }
    setNewRecipient({ label: "", phone: "" });
    load();
  }

  async function removeRecipient(id: string) {
    const res = await fetch(`/api/whatsapp/recipients/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not remove recipient.");
      return;
    }
    load();
  }

  async function templateAction(templateId: string, action: "submit" | "approve" | "reject") {
    const reason = action === "reject" ? window.prompt("Rejection reason?") ?? "" : undefined;
    if (action === "reject" && !reason) return;
    const res = await fetch(`/api/whatsapp/templates/${templateId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: action === "reject" ? JSON.stringify({ reason }) : undefined,
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Action failed.");
      return;
    }
    toast.success(`Template ${action === "submit" ? "submitted for approval" : action === "approve" ? "approved" : "rejected"}.`);
    load();
  }

  async function saveTemplate() {
    if (!editingTemplate) return;
    const res = await fetch("/api/whatsapp/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: editingTemplate.key, name: editingTemplate.name, bodyText: editingTemplate.bodyText }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Could not save template.");
      return;
    }
    toast.success("Draft saved.");
    setEditingTemplate(null);
    load();
  }

  async function sendWinBackNow() {
    setSendingWinBack(true);
    try {
      const res = await fetch("/api/whatsapp/win-back", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not send win-back batch.");
        return;
      }
      toast.success(`Attempted ${data.attempted}, sent ${data.sent}, skipped ${data.skipped}.`);
      load();
    } finally {
      setSendingWinBack(false);
    }
  }

  async function sendDailySummaryNow() {
    setSendingSummary(true);
    try {
      const res = await fetch("/api/whatsapp/daily-summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) {
        toast.error("Could not send daily summary.");
        return;
      }
      toast.success("Daily summary sent.");
      load();
    } finally {
      setSendingSummary(false);
    }
  }

  if (!settings) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MessageCircle className="size-5" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Built against a dev-stub adapter — no live Meta Business account configured yet. Sends are logged,
            not actually delivered, until real Cloud API credentials are wired in.
          </p>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Master switch</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable WhatsApp messaging for this restaurant</Label>
              <p className="text-xs text-muted-foreground">Off by default — nothing sends until this is on.</p>
            </div>
            <Switch checked={settings.enabled} onCheckedChange={(v: boolean) => toggleSetting("enabled", v)} />
          </div>
          <div className="grid grid-cols-2 gap-4 border-t pt-4">
            <ToggleRow label="Low-stock alerts" checked={settings.lowStockAlertsEnabled} onChange={(v) => toggleSetting("lowStockAlertsEnabled", v)} />
            <ToggleRow label="Daily business summary" checked={settings.dailySummaryEnabled} onChange={(v) => toggleSetting("dailySummaryEnabled", v)} />
            <ToggleRow label="Customer win-back" checked={settings.winBackEnabled} onChange={(v) => toggleSetting("winBackEnabled", v)} />
            <ToggleRow label="Delivery status updates" checked={settings.deliveryUpdatesEnabled} onChange={(v) => toggleSetting("deliveryUpdatesEnabled", v)} />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="recipients">Alert recipients</TabsTrigger>
          <TabsTrigger value="log">Message log</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Message templates</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={sendingSummary} onClick={sendDailySummaryNow}>
                  {sendingSummary ? "Sending…" : "Send daily summary now"}
                </Button>
                <Button size="sm" variant="outline" disabled={sendingWinBack} onClick={sendWinBackNow}>
                  {sendingWinBack ? "Sending…" : "Send win-back now"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(TEMPLATE_LABELS).map(([key, label]) => {
                    const t = templates.find((tpl) => tpl.key === key);
                    return (
                      <TableRow key={key}>
                        <TableCell>
                          <div className="font-medium">{label}</div>
                          {t?.status === "REJECTED" && t.rejectionReason && (
                            <div className="text-xs text-destructive">Rejected: {t.rejectionReason}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          {t ? <Badge variant={STATUS_VARIANT[t.status]}>{t.status.replace("_", " ")}</Badge> : <Badge variant="outline">Not created</Badge>}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingTemplate(t ?? { id: "", key, name: label, bodyText: "", status: "DRAFT", rejectionReason: null })}
                          >
                            {t ? "Edit" : "Create"}
                          </Button>
                          {t && (t.status === "DRAFT" || t.status === "REJECTED") && (
                            <Button size="sm" onClick={() => templateAction(t.id, "submit")}>
                              Submit for approval
                            </Button>
                          )}
                          {t && t.status === "PENDING_APPROVAL" && (
                            <>
                              <Button size="sm" onClick={() => templateAction(t.id, "approve")}>
                                Approve
                              </Button>
                              <Button size="sm" variant="outline" className="text-destructive" onClick={() => templateAction(t.id, "reject")}>
                                Reject
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recipients" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Staff numbers for low-stock & daily-summary alerts (your branch)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input placeholder="Label (e.g. Manager)" value={newRecipient.label} onChange={(e) => setNewRecipient((r) => ({ ...r, label: e.target.value }))} />
                <Input placeholder="Phone (+92...)" value={newRecipient.phone} onChange={(e) => setNewRecipient((r) => ({ ...r, phone: e.target.value }))} />
                <Button onClick={addRecipient}>Add</Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipients.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.label}</TableCell>
                      <TableCell>{r.phone}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => removeRecipient(r.id)}>
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="log" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent sends</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>To</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">No messages yet.</TableCell>
                    </TableRow>
                  )}
                  {messages.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{m.toPhone}</TableCell>
                      <TableCell>{TEMPLATE_LABELS[m.templateKey] ?? m.templateKey}</TableCell>
                      <TableCell>
                        <Badge variant={m.status === "SENT" ? "secondary" : m.status === "FAILED" ? "destructive" : "outline"}>{m.status.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell>{new Date(m.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editingTemplate} onOpenChange={(o) => !o && setEditingTemplate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTemplate ? TEMPLATE_LABELS[editingTemplate.key] : ""}</DialogTitle>
          </DialogHeader>
          {editingTemplate && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Use {"{{1}}"}, {"{{2}}"}, ... as placeholders — filled in when the message actually sends.
              </p>
              <Textarea
                rows={5}
                value={editingTemplate.bodyText}
                onChange={(e) => setEditingTemplate((t) => (t ? { ...t, bodyText: e.target.value } : t))}
                placeholder="Hi {{1}}, we miss you at..."
              />
              <Button className="w-full" onClick={saveTemplate}>
                Save draft
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
