import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, UtensilsCrossed } from "lucide-react";
import { auth } from "@/server/auth";
import { BRAND_NAME } from "@/config/brand";
import { SignOutButton } from "@/components/sign-out-button";

// Fullscreen POS shell — deliberately NOT nested under the back-office layout: cashiers/waiters
// live here for a whole shift on a tablet, so it gets its own minimal chrome, not a sidebar.
// The header uses the dark navy "chrome" tokens (independent of light/dark mode) to match the
// reference admin-dashboard look.
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.kind !== "tenant") redirect("/login");
  const user = session.user;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center justify-between bg-sidebar px-5 py-3 text-sidebar-foreground">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <UtensilsCrossed className="size-4" />
          </span>
          <div className="leading-tight">
            <div className="text-base font-semibold tracking-tight">{BRAND_NAME}</div>
            <div className="text-xs text-sidebar-foreground/60">{user.branchName}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/app/dashboard"
            className="flex items-center gap-1 text-sm text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground"
          >
            <ChevronLeft className="size-4" />
            Back office
          </Link>
          <div className="h-6 w-px bg-sidebar-border" />
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
              {user.name
                .split(" ")
                .map((p) => p[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span className="text-sm font-medium">{user.name}</span>
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
