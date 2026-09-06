"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BRAND_NAME } from "@/config/brand";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export default function SignupPage() {
  const router = useRouter();
  const [restaurantName, setRestaurantName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [branchName, setBranchName] = useState("Main Branch");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantName, slug, branchName, ownerName, ownerEmail, ownerPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Signup failed");
        return;
      }
      // Signup deliberately does NOT sign you in. It used to, and that was the last thing telling
      // an attacker whether an email was already registered: a free email landed on the dashboard,
      // a taken one bounced to /login, so the outcome was readable from the browser even once the
      // API response had been made identical. Everyone now takes the same path, which costs a
      // genuine new signup one extra step — they have just typed the password — and closes it.
      toast.success(`Welcome to ${BRAND_NAME}! Sign in to start your 14-day trial.`);
      router.push("/login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start your free trial</CardTitle>
        <CardDescription>14 days free, no card required. Set up your first branch in a minute.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="restaurantName">Restaurant name</Label>
            <Input
              id="restaurantName"
              value={restaurantName}
              onChange={(e) => {
                setRestaurantName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">Restaurant URL</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branchName">First branch name</Label>
            <Input id="branchName" value={branchName} onChange={(e) => setBranchName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ownerName">Your name</Label>
            <Input id="ownerName" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ownerEmail">Your email</Label>
            <Input
              id="ownerEmail"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ownerPassword">Password</Label>
            <Input
              id="ownerPassword"
              type="password"
              minLength={8}
              value={ownerPassword}
              onChange={(e) => setOwnerPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating your restaurant…" : "Start free trial"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
