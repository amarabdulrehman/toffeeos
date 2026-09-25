import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { StaffView } from "@/components/staff/staff-view";

export default async function StaffPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  const can = (p: string) => user.permissions.includes(p);
  if (!can("staff.manage") && !can("staff.invite") && !can("staff.roles.manage")) {
    redirect("/app/dashboard");
  }

  return <StaffView canInvite={can("staff.invite")} canManage={can("staff.manage")} canManageRoles={can("staff.roles.manage")} />;
}
