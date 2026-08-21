import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChefHat } from "lucide-react";
import { auth } from "@/server/auth";
import { BRAND_NAME } from "@/config/brand";
import { SignOutButton } from "@/components/sign-out-button";

// `dark` on the root wrapper scopes the whole KDS subtree to the dark palette (globals.css .dark
// block) via CSS variables. The header itself uses the dedicated sidebar/chrome tokens (always
// dark navy, independent of light/dark mode) for the same look as the POS header.
export default async function KdsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.kind !== "tenant") redirect("/login");
  const user = session.user;
  if (user.mustChangePassword) redirect("/change-password");

  return (
    <div className="dark flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="relative z-10 flex shrink-0 items-center justify-between bg-sidebar px-5 py-3 text-sidebar-foreground shadow-md">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <ChefHat className="size-4.5" />
          </span>
          <div className="leading-tight">
            <div className="font-heading text-base font-semibold tracking-tight">{BRAND_NAME} KDS</div>
            <div className="text-xs text-sidebar-foreground/55">{user.branchName}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/app/dashboard"
            className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <ChevronLeft className="size-4" />
            Back office
          </Link>
          <div className="h-6 w-px bg-sidebar-border" />
          <span className="text-sm font-medium">{user.name}</span>
          <div className="w-24">
            <SignOutButton onDark />
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
