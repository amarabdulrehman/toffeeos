"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BRAND_NAME } from "@/config/brand";

// Phone + OTP, not email/password — the "otp" Auth.js provider already built in Phase 1 for staff
// login in general; this page is just a rider-focused entry point onto the same flow.
export default function RiderLoginPage() {
  const router = useRouter();
  const [tenantSlug, setTenantSlug] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [loading, setLoading] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantSlug, phone }),
      });
      toast.success("Code sent — check your phone (or the server console in dev).");
      setStep("code");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await signIn("otp", { tenantSlug, phone, code, redirect: false });
      if (result?.error) {
        toast.error("Invalid or expired code.");
        return;
      }
      router.push("/rider/orders");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/20 px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
          <Truck className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">{BRAND_NAME}</h1>
          <p className="text-sm text-muted-foreground">Rider sign in</p>
        </div>
      </div>
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader>
          <CardTitle className="font-heading">{step === "phone" ? "Enter your phone number" : "Enter the code"}</CardTitle>
          <CardDescription>
            {step === "phone"
              ? "We'll text you a one-time code."
              : `Code sent to ${phone}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "phone" ? (
            <form onSubmit={requestCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tenantSlug">Restaurant URL</Label>
                <Input
                  id="tenantSlug" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  placeholder="karachi-karahi"
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value.trim())}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="03xxxxxxxxx"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.trim())}
                  required
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? "Sending…" : "Send code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">6-digit code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.trim())}
                  className="text-center text-2xl tracking-[0.5em]"
                  required
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? "Verifying…" : "Sign in"}
              </Button>
              <button
                type="button"
                onClick={() => setStep("phone")}
                className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Use a different number
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
