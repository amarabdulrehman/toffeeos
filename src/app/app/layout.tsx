import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { BRAND_NAME } from "@/config/brand";
import { SignOutButton } from "@/components/sign-out-button";

const NAV = [
  { href: "/app/dashboard", label: "Dashboard" },
  { href: "/pos", label: "POS" },
  { href: "/kds", label: "KDS" },
  { href: "/app/tables", label: "Tables" },
  { href: "/app/inventory", label: "Inventory" },
  { href: "/app/delivery", label: "Delivery" },
  { href: "/app/reports", label: "Reports" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.kind !== "tenant") redirect("/login");
  const user = session.user;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r bg-muted/30 p-4">
        <div className="mb-6">
          <div className="text-lg font-bold">{BRAND_NAME}</div>
          <div className="text-xs text-muted-foreground">{user.tenantName}</div>
          <div className="text-xs text-muted-foreground">{user.branchName}</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-2 border-t pt-4">
          <div className="text-xs">
            <div className="font-medium">{user.name}</div>
            <div className="text-muted-foreground">{user.roleKey.replace("_", " ")}</div>
          </div>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
