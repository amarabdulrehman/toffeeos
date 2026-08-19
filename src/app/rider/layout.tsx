import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { BRAND_NAME } from "@/config/brand";
import { SignOutButton } from "@/components/sign-out-button";

// Minimal, big-touch-target shell — riders use this one-handed on their own phone, often outdoors.
export default async function RiderLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.kind !== "tenant") redirect("/rider/login");
  const user = session.user;

  if (!user.permissions.includes("delivery.riderApp.access")) {
    redirect("/app/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between border-b bg-card px-4 py-3">
        <div>
          <div className="font-bold">{BRAND_NAME}</div>
          <div className="text-xs text-muted-foreground">{user.name}</div>
        </div>
        <div className="w-24">
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
