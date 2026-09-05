import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { MfaSettingsCard } from "@/components/platform/mfa-settings-card";
import { AccountSettingsCard } from "@/components/platform/account-settings-card";

export default async function PlatformSettingsPage() {
  const session = await auth();
  if (!session?.user || session.user.kind !== "platform") redirect("/platform/login");

  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Platform admin account security.</p>
      <div className="mt-6 space-y-6">
        <AccountSettingsCard currentEmail={session.user.email} />
        <MfaSettingsCard />
      </div>
    </div>
  );
}
