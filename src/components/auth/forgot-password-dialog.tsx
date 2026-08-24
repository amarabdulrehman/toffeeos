"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Shared by the tenant and platform-admin login pages — same request/generic-response shape,
 * just a different endpoint and (for the tenant flow) an extra tenantSlug field the request route
 * requires. When `forTenant` is set, the slug is its own editable field (seeded from whatever the
 * outer login form already has typed, but not tied to it) — the request route can't resolve which
 * tenant without one, so the field always needs a real value before submitting, not just whenever
 * the caller happens to have one. Always shows the same "if that account exists..." message
 * regardless of what the API actually found, matching the no-enumeration contract the request
 * routes themselves guarantee. */
export function ForgotPasswordDialog({
  open,
  onClose,
  endpoint,
  forTenant,
  initialTenantSlug,
}: {
  open: boolean;
  onClose: () => void;
  endpoint: string;
  forTenant?: boolean;
  initialTenantSlug?: string;
}) {
  const [tenantSlug, setTenantSlug] = useState(initialTenantSlug ?? "");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  function close() {
    onClose();
    // Reset after the close animation rather than immediately, so the dialog doesn't visibly
    // flash back to the form while it's still fading out.
    setTimeout(() => {
      setEmail("");
      setSent(false);
    }, 200);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(forTenant ? { tenantSlug, email } : { email }),
      });
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Too many requests — please wait a while and try again.");
        return;
      }
      // Any other response (200, or a 400 from a malformed email/slug) still shows the generic
      // confirmation — the backend never reveals whether the account actually exists, and the UI
      // shouldn't either.
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading">Reset your password</DialogTitle>
        </DialogHeader>
        {sent ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              If an account exists for that {forTenant ? "restaurant and email" : "email"}, we&apos;ve sent a password
              reset link to it. The link expires in 30 minutes.
            </p>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {forTenant && (
              <div className="space-y-2">
                <Label htmlFor="forgot-slug">Restaurant URL</Label>
                <Input id="forgot-slug" value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value.trim())} required />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <Input id="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={submitting || !email || (forTenant && !tenantSlug)}>
                {submitting ? "Sending…" : "Send reset link"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
