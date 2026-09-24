import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, UtensilsCrossed } from "lucide-react";
import { auth } from "@/server/auth";
import { getTenantLayoutDataForTenant } from "@/server/tier";
import { tenantAcceptsLogin } from "@/server/auth/session-user";
import { BRAND_NAME } from "@/config/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { AccountSuspended } from "@/components/tier/account-suspended";

// Fullscreen POS shell — deliberately NOT nested under the back-office layout: cashiers/waiters
// live here for a whole shift on a tablet, so it gets its own minimal chrome, not a sidebar.
// The header uses the dark navy "chrome" tokens (independent of light/dark mode) to match the
// reference admin-dashboard look.
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.kind !== "tenant") redirect("/login");
  const user = session.user;
  if (user.mustChangePassword) redirect("/change-password");

  // The API layer already rejects every request from a suspended/cancelled tenant — this closes
  // the matching page-shell gap so a cashier sees why, instead of a POS that silently fails on
  // every action (Send to Kitchen, Take Payment, etc.).
  const { tenantStatus } = await getTenantLayoutDataForTenant(user.tenantId);
  if (!tenantAcceptsLogin(tenantStatus ?? "")) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <header className="flex shrink-0 items-center justify-between bg-sidebar px-5 py-3 text-sidebar-foreground shadow-md">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <UtensilsCrossed className="size-4.5" />
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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="relative z-10 flex shrink-0 items-center justify-between bg-sidebar px-3 py-2 text-sidebar-foreground shadow-md sm:px-5 sm:py-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <UtensilsCrossed className="size-4.5" />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="font-heading text-base font-semibold tracking-tight">{BRAND_NAME}</div>
            <div className="text-xs text-sidebar-foreground/55">{user.branchName}</div>
          </div>
        </div>
        {/* On a narrow screen the labels go and the controls stay: the header was wrapping to two
            lines on a small tablet and pushing the menu down. */}
        <div className="flex items-center gap-2 sm:gap-4">
          <Link
            href="/app/dashboard"
            aria-label="Back office"
            className="flex min-h-10 items-center gap-1 rounded-full px-2.5 py-1.5 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <ChevronLeft className="size-4" />
            <span className="max-sm:hidden">Back office</span>
          </Link>
          <div className="hidden h-6 w-px bg-sidebar-border sm:block" />
          <div className="flex items-center gap-2">
            <span className="flex size-7.5 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground ring-1 ring-white/10">
              {user.name
                .split(" ")
                .map((p) => p[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span className="hidden text-sm font-medium md:inline">{user.name}</span>
          </div>
          <div className="w-24">
            <SignOutButton onDark />
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
