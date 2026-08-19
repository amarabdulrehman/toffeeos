import Link from "next/link";
import { auth } from "@/server/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function DashboardPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") return null;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Welcome back, {user.name.split(" ")[0]}</h1>
      <p className="text-muted-foreground">{user.tenantName} · {user.branchName}</p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Point of Sale</CardTitle>
            <CardDescription>Punch orders, take payments, manage the floor.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/pos" />} nativeButton={false}>
              Open POS
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Kitchen Display</CardTitle>
            <CardDescription>Live order tickets for the kitchen.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/kds" />} nativeButton={false} variant="outline">
              Open KDS
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Reports</CardTitle>
            <CardDescription>Sales summary and item-wise performance.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/app/reports" />} nativeButton={false} variant="outline">
              View reports
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        Your permissions: {user.permissions.length} granted · role: {user.roleKey.replace("_", " ")}
      </div>
    </div>
  );
}
