import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { ChangePasswordView } from "@/components/auth/change-password-view";

// Deliberately its own top-level route, not nested under the app/pos/kds layouts — those layouts
// redirect here when mustChangePassword is true, so living inside one of them would infinite-loop.
export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user || session.user.kind !== "tenant") redirect("/login");
  const user = session.user;

  return (
    <ChangePasswordView
      tenantSlug={user.tenantSlug}
      email={user.email}
      forced={user.mustChangePassword}
    />
  );
}
