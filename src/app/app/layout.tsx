import { redirect } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { auth } from "@/server/auth";
import { getTenantLayoutDataForTenant } from "@/server/tier";
import { getBranchKdsEnabled } from "@/server/branch-settings";
import { tenantAcceptsLogin } from "@/server/auth/session-user";
import { getBillingStatus } from "@/lib/billing";
import { BRAND_NAME } from "@/config/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { ClockOutButton } from "@/components/clock-out-button";
import { MobileNav } from "@/components/layout/mobile-nav";
import { AppSidebarNav } from "@/components/app-sidebar-nav";
import { AccountSuspended } from "@/components/tier/account-suspended";
import { BranchSwitcher } from "@/components/branch-switcher";
import { listMyBranches } from "@/server/branches";

// Dark navy "chrome" sidebar, same --sidebar tokens as the POS/KDS headers — this is the one nav
// every back-office screen shares, so unifying it here means every screen behind it (Dashboard,
// Reports, Inventory, etc.) already reads as one product before its own pass touches it.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.kind !== "tenant") redirect("/login");
  const user = session.user;
  if (user.mustChangePassword) redirect("/change-password");
  // Read fresh on every request (never cached on the session) so a platform admin's tier change —
  // or a direct per-feature toggle — is reflected on this tenant's very next page load, no re-login
  // required. Also carries the billing dates for the renewal banner below — one query, not two
  // (see getTenantLayoutDataForTenant's doc comment).
  const layoutData = await getTenantLayoutDataForTenant(user.tenantId, user.id, user.sessionsValidFrom);
  const enabledModules = layoutData.enabledModules;

  // The account was deactivated, or these sessions were signed out, after this token was issued.
  // defineHandler already refuses every API call from it; without this the shell still rendered and
  // the person saw a fully-populated app whose every action failed — the same page-shell gap the
  // tenant-suspension branch below exists to close, one level down at the user.
  if (!layoutData.sessionValid) redirect("/login");

  // The API layer already rejects every request from a suspended/cancelled tenant (defineHandler's
  // getTenantGate check) — this is the matching page-shell gap: without it, staff kept seeing the
  // full nav and every screen, just with every action inside silently failing.
  if (!tenantAcceptsLogin(layoutData.tenantStatus ?? "")) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between bg-sidebar px-5 py-3 text-sidebar-foreground shadow-md">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <LayoutGrid className="size-4.5" />
            </span>
            <div className="font-heading text-base font-semibold tracking-tight">{BRAND_NAME}</div>
          </div>
          <div className="w-24">
            <SignOutButton onDark />
          </div>
        </header>
        <AccountSuspended />
      </div>
    );
  }
  const [kdsEnabled, myBranches] = await Promise.all([
    getBranchKdsEnabled(user.tenantId, user.branchId),
    listMyBranches(user.tenantId, user.id),
  ]);

  // Purely a notice — never gates anything. A tenant whose paid period has lapsed keeps working
  // normally until a platform admin manually suspends them; this just tells them to renew.
  const billing = getBillingStatus({
    tenantStatus: (layoutData.tenantStatus as "TRIALING" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | null) ?? "ACTIVE",
    trialEndsAt: layoutData.trialEndsAt,
    currentPeriodEnd: layoutData.currentPeriodEnd,
  });
  const showRenewalNotice = billing.isOverdue || billing.state === "due_soon";

  const navContent = (
    <>
      <div className="mb-6 flex items-center gap-3 px-1">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <LayoutGrid className="size-4.5" />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="font-heading text-base font-semibold tracking-tight">{BRAND_NAME}</div>
          <div className="truncate text-xs text-sidebar-foreground/55">{user.tenantName}</div>
        </div>
      </div>
      <AppSidebarNav permissions={user.permissions} enabledModules={enabledModules} kdsEnabled={kdsEnabled} />
      <div className="mt-auto space-y-2 border-t border-sidebar-border pt-4">
        {myBranches.length > 1 ? (
          <BranchSwitcher branches={myBranches} currentBranchId={user.branchId} />
        ) : (
          <div className="truncate px-1 text-xs text-sidebar-foreground/55">{user.branchName}</div>
        )}
        <div className="px-1 text-xs">
          <div className="font-medium">{user.name}</div>
          <div className="text-sidebar-foreground/55">{user.roleKey.replace("_", " ")}</div>
        </div>
        <ClockOutButton onDark />
        <SignOutButton onDark />
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* h-screen + sticky, not just min-h-screen: AppSidebarNav's list already carries
          `flex-1 overflow-y-auto`, but that can only engage if this container has a bounded height.
          Without the cap the aside simply grew past the viewport and pushed Clock out / Sign out
          below the fold on shorter laptop screens (~700px), where the nav list is now long enough
          to overflow. */}
      {/* Written once, rendered in two places: the fixed sidebar on a laptop, and the drawer on a
          phone. Duplicating it would mean a nav item added in one and forgotten in the other. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground shadow-lg lg:flex">
        {navContent}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileNav>{navContent}</MobileNav>
        {showRenewalNotice && (
          <div className="flex items-center px-4 py-2 text-sm font-medium bg-warning text-warning-foreground">
            {billing.isOverdue
              ? `Your ${BRAND_NAME} subscription lapsed on ${billing.paidThrough?.toLocaleDateString()}. Contact your account manager to renew.`
              : `Your ${BRAND_NAME} subscription renews on ${billing.paidThrough?.toLocaleDateString()} — contact your account manager to extend it.`}
          </div>
        )}
        {user.impersonatedByPlatformUserId && (
          <div className="flex items-center justify-between bg-warning px-4 py-2 text-sm font-medium text-warning-foreground">
            <span>
              Viewing as {user.tenantName} — impersonated by {user.impersonatedByPlatformUserEmail}
            </span>
            <SignOutButton
              label="Exit impersonation"
              callbackUrl="/platform/login"
              className="border-warning-foreground/30 text-warning-foreground hover:bg-warning-foreground/10"
            />
          </div>
        )}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
