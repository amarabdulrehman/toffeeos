"use client";

import { useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BRAND_NAME, BRAND_TAGLINE } from "@/config/brand";

export function ChangePasswordView({
  tenantSlug,
  email,
  forced,
}: {
  tenantSlug: string;
  email: string | null;
  forced: boolean;
}) {
  const router = useRouter();
  const { update } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not change password.");
        return;
      }
      // Re-authenticate with the new password so the session's mustChangePassword flag (baked
      // into the JWT at sign-in) refreshes to false, same pattern the signup page uses.
      await signIn("credentials", { tenantSlug, email: email ?? "", password: newPassword, redirect: false });
      // The server just bumped sessionsValidFrom to sign out every other device, which would
      // include this one. Re-issue this token against the new watermark so the person who just
      // changed their password stays signed in here.
      await update({ refresh: true });
      toast.success("Password updated. Any other devices have been signed out.");
      router.push("/app/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{BRAND_NAME}</h1>
        <p className="text-sm text-muted-foreground">{BRAND_TAGLINE}</p>
      </div>
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" />
              {forced ? "Set your password" : "Change password"}
            </CardTitle>
            <CardDescription>
              {forced
                ? "You're signing in with a temporary password. Set your own before continuing."
                : "Enter your current password and choose a new one."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">{forced ? "Temporary password" : "Current password"}</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Updating…" : "Set new password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
