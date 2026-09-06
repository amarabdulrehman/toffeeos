"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { revokeMySessions } from "@/server/session-revocation";
import { toast } from "sonner";
import { UserCog } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Change the platform admin's own email and/or password — the only other path (the "forgot
 * password" email link) needs a working email provider and isn't the right tool for "I'm already
 * logged in and just want to update this." Requires the current password either way. */
export function AccountSettingsCard({ currentEmail }: { currentEmail: string }) {
  const [newEmail, setNewEmail] = useState(currentEmail);
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const emailChanged = newEmail.trim() !== currentEmail;
  const passwordChanged = newPassword.trim().length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailChanged && !passwordChanged) return;
    setBusy(true);
    try {
      const res = await fetch("/api/platform/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          ...(emailChanged ? { newEmail: newEmail.trim() } : {}),
          ...(passwordChanged ? { newPassword } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not update your account.");
        return;
      }
      toast.success("Updated — sign in again with your new details.");
      // A password change already revokes every session for this account server-side; an email-only
      // change does not, so revoke here too. Otherwise "sign out" on this screen would clear only
      // this browser's cookie and leave any other copy of the token working until it expired.
      await revokeMySessions().catch(() => {});
      await signOut({ callbackUrl: "/platform/login" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UserCog className="size-4" />
        </span>
        <div>
          <CardTitle className="font-heading text-base">Account</CardTitle>
          <CardDescription>Change your sign-in email and/or password.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-email">Email</Label>
            <Input id="new-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              placeholder="Leave blank to keep your current password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Confirm your current password</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            disabled={busy || currentPassword.trim().length === 0 || (!emailChanged && !passwordChanged)}
          >
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
