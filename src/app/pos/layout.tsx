import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/server/auth";
import { BRAND_NAME } from "@/config/brand";
import { SignOutButton } from "@/components/sign-out-button";

// Fullscreen POS shell — deliberately NOT nested under the back-office layout: cashiers/waiters
// live here for a whole shift on a tablet, so it gets its own minimal chrome, not a sidebar.
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.kind !== "tenant") redirect("/login");
  const user = session.user;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center justify-between border-b bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="font-bold">{BRAND_NAME} POS</span>
          <span className="text-sm text-muted-foreground">{user.branchName}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm">{user.name}</span>
          <Link href="/app/dashboard" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Back office
          </Link>
          <div className="w-28">
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
