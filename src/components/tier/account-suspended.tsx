import { Ban } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BRAND_NAME } from "@/config/brand";

/**
 * Rendered in place of the app/POS/KDS shell's content when the tenant's account is suspended or
 * cancelled. The API layer (defineHandler's getTenantGate check) already rejects every request
 * from a suspended tenant with a 403 — this closes the matching gap on the page-shell side, so
 * staff see a clear reason instead of a shell that quietly fails every action they try inside it.
 */
export function AccountSuspended() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <Card className="mx-auto max-w-md text-center shadow-sm">
        <CardHeader className="items-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Ban className="size-5" />
          </span>
          <CardTitle className="font-heading">This account is no longer active</CardTitle>
          <CardDescription>
            Your restaurant&apos;s {BRAND_NAME} subscription has been suspended or cancelled. Contact your platform
            admin to reactivate it — none of the actions on this screen will work until then.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
