import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { auth } from "@/server/auth";
import { BRAND_NAME } from "@/config/brand";
import { SignOutButton } from "@/components/sign-out-button";

// Scoped to the (app) route group deliberately, same reason as rider/(app): /platform/login is a
// sibling OUTSIDE this group, so an unauthenticated visit never gets caught in a redirect-to-itself
// loop. Permanently dark, same `.dark`-class technique as KDS — this is the one other screen in the
// product meant to feel like distinct, serious infrastructure rather than day-to-day staff tooling.
export default async function PlatformAppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.kind !== "platform") redirect("/platform/login");

  return (
    <div className="dark flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between bg-sidebar px-6 py-3.5 text-sidebar-foreground shadow-md">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <ShieldCheck className="size-4.5" />
          </span>
          <div className="leading-tight">
            <div className="font-heading text-base font-semibold tracking-tight">{BRAND_NAME} Platform</div>
            <div className="text-xs text-sidebar-foreground/55">{session.user.email}</div>
          </div>
        </div>
        <div className="w-28">
          <SignOutButton onDark callbackUrl="/platform/login" />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
