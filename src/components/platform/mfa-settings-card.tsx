"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { generateQrDataUrl } from "@/lib/qr";

type Step = "idle" | "enrolling" | "backupCodes";

export function MfaSettingsCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [secret, setSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [code, setCode] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/platform/mfa/status")
      .then((r) => r.json())
      .then((d) => setEnabled(d.totpEnabled ?? false))
      .catch(() => setEnabled(false));
  }, []);

  async function startEnroll() {
    setBusy(true);
    try {
      const res = await fetch("/api/platform/mfa/enroll/start", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not start enrollment.");
        return;
      }
      setSecret(data.secret);
      setQrDataUrl(await generateQrDataUrl(data.otpauthUrl));
      setStep("enrolling");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll() {
    if (code.trim().length === 0 || confirmPassword.trim().length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/platform/mfa/enroll/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: confirmPassword, secret, code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not verify that code.");
        return;
      }
      setBackupCodes(data.backupCodes);
      setStep("backupCodes");
      setEnabled(true);
    } finally {
      setBusy(false);
    }
  }

  function finishEnrollment() {
    setStep("idle");
    setCode("");
    setConfirmPassword("");
    setSecret("");
    setQrDataUrl("");
    setBackupCodes([]);
  }

  async function disable() {
    if (disablePassword.trim().length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/platform/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not disable two-factor authentication.");
        return;
      }
      setEnabled(false);
      setDisableOpen(false);
      setDisablePassword("");
      toast.success("Two-factor authentication disabled.");
    } finally {
      setBusy(false);
    }
  }

  if (enabled === null) return null;

  return (
    <>
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center gap-2.5">
          <span
            className={`flex size-8 items-center justify-center rounded-lg ${enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}
          >
            {enabled ? <ShieldCheck className="size-4" /> : <ShieldOff className="size-4" />}
          </span>
          <div>
            <CardTitle className="font-heading text-base">Two-factor authentication</CardTitle>
            <CardDescription>
              {enabled
                ? "Enabled — an authenticator code is required at sign-in."
                : "Off — only a password protects this account right now."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {step === "idle" &&
            (enabled ? (
              <Button variant="outline" className="text-destructive" onClick={() => setDisableOpen(true)}>
                Disable two-factor authentication
              </Button>
            ) : (
              <Button onClick={startEnroll} disabled={busy}>
                Enable two-factor authentication
              </Button>
            ))}

          {step === "enrolling" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Scan this with an authenticator app (Google Authenticator, Authy, 1Password, etc.), or enter the code
                manually.
              </p>
              {qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- a locally-generated data: URI, not a remote image
                <img src={qrDataUrl} alt="Authenticator QR code" className="size-48 rounded-lg border p-2" />
              )}
              <div className="rounded-lg bg-muted/40 p-2 font-mono text-xs break-all">{secret}</div>
              <div className="space-y-1.5">
                <Label htmlFor="enroll-code">Enter the 6-digit code to confirm</Label>
                <Input
                  id="enroll-code"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="enroll-password">Confirm your password</Label>
                <Input
                  id="enroll-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={finishEnrollment} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  onClick={confirmEnroll}
                  disabled={busy || code.trim().length === 0 || confirmPassword.trim().length === 0}
                >
                  Verify & enable
                </Button>
              </div>
            </div>
          )}

          {step === "backupCodes" && (
            <div className="space-y-4">
              <p className="text-sm font-medium text-destructive">
                Save these backup codes now — each works once, and this is the only time they&apos;re shown. If you lose
                your authenticator app, one of these is the only way back into this account.
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 font-mono text-sm">
                {backupCodes.map((c) => (
                  <div key={c}>{c}</div>
                ))}
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(backupCodes.join("\n"));
                  toast.success("Copied to clipboard.");
                }}
              >
                <Copy className="size-4" />
                Copy codes
              </Button>
              <Button className="w-full" onClick={finishEnrollment}>
                I&apos;ve saved these — done
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent className="dark">
          <DialogHeader>
            <DialogTitle>Disable two-factor authentication</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="disable-password">Confirm your password</Label>
            <Input
              id="disable-password"
              type="password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableOpen(false)} disabled={busy}>
              Never mind
            </Button>
            <Button variant="destructive" onClick={disable} disabled={busy || disablePassword.trim().length === 0}>
              Disable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
