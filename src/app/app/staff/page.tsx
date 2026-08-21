import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { StaffView } from "@/components/staff/staff-view";

export default async function StaffPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("staff.manage") && !user.permissions.includes("staff.invite")) {
    redirect("/app/dashboard");
  }

  return <StaffView canInvite={user.permissions.includes("staff.invite")} canManage={user.permissions.includes("staff.manage")} />;
}
