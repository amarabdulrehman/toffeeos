import { redirect } from "next/navigation";
import { Truck } from "lucide-react";
import { auth } from "@/server/auth";
import { getTenantModulesForTenant } from "@/server/tier";
import { BRAND_NAME } from "@/config/brand";
import { SignOutButton } from "@/components/sign-out-button";

// Minimal, big-touch-target shell — riders use this one-handed on their own phone, often outdoors.
// Scoped to the (app) route group deliberately — /rider/login is a sibling OUTSIDE this group so
// it never shares this auth-guarded layout. It used to (a plain src/app/rider/layout.tsx wrapped
// both), which meant an unauthenticated visit to /rider/login redirected to /rider/login,
// looping forever — a rider who wasn't already signed in could never reach the login page.
export default async function RiderAppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.kind !== "tenant") redirect("/rider/login");
  const user = session.user;

  if (!user.permissions.includes("delivery.riderApp.access")) {
    redirect("/app/dashboard");
  }

  // Delivery & Rider Management is a gateable module — mirrors the same check the underlying
  // /api/rider/* routes already get automatically via defineHandler, but this is a page (not an
  // API route), so it needs its own explicit check.
  const enabledModules = await getTenantModulesForTenant(user.tenantId);
  if (!enabledModules.includes("delivery")) {
    redirect("/app/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <header className="flex items-center justify-between bg-background px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Truck className="size-4.5" />
          </span>
          <div className="leading-tight">
            <div className="font-heading text-sm font-bold">{BRAND_NAME}</div>
            <div className="text-xs text-muted-foreground">{user.name}</div>
          </div>
        </div>
        <div className="w-24">
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
