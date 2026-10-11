"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordDialog } from "@/components/auth/forgot-password-dialog";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");

  const [tenantSlug, setTenantSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const result = await signIn("credentials", {
      tenantSlug,
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      const statusRes = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/status`);
      const { status } = await statusRes.json();
      if (status === "SUSPENDED" || status === "CANCELLED") {
        toast.error("This restaurant's account is suspended. Contact support to reactivate it.");
      } else {
        toast.error("Invalid restaurant, email, or password.");
      }
      return;
    }
    router.push(nextParam ?? (await landingFor()));
    router.refresh();
  }

  /** A rider's work is the rider app, not the back office; everyone else starts on the dashboard.
   * The rider app sends anyone it won't serve back to the dashboard, so this can't loop. */
  async function landingFor(): Promise<string> {
    try {
      const session = await fetch("/api/auth/session").then((r) => r.json());
      if (session?.user?.roleKey === "rider") return "/rider/orders";
    } catch {
      // Fall through to the dashboard.
    }
    return "/app/dashboard";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Enter your restaurant&apos;s URL and your staff login.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tenantSlug">Restaurant URL</Label>
            <div className="flex items-center gap-1">
              <Input
                id="tenantSlug" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                placeholder="your-restaurant"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value.trim())}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <button
                type="button"
                onClick={() => setForgotOpen(true)}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <ForgotPasswordDialog
          open={forgotOpen}
          onClose={() => setForgotOpen(false)}
          endpoint="/api/auth/request-password-reset"
          forTenant
          initialTenantSlug={tenantSlug}
        />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Don&apos;t have a restaurant yet?{" "}
          <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
            Start your free trial
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          <Link href="/platform/login" className="underline-offset-4 hover:underline">
            Platform admin login
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
