import { redirect } from "next/navigation";
import { CreditCard } from "lucide-react";
import { auth } from "@/server/auth";
import { rawDb, tenantDb } from "@/server/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBillingStatus, PAYMENT_METHODS, type BillingStatus } from "@/lib/billing";

/** The status's colour, as a dot beside dark text. */
const DOT: Record<string, string> = {
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  destructive: "bg-destructive",
  outline: "bg-muted-foreground",
};

/** One line under the status, saying what it means for the restaurant. */
function statusNote(status: BillingStatus): string {
  if (status.state === "inactive") return "Your account is paused. Please contact ToffeeOS support.";
  if (status.isOverdue) return "Payment is overdue. Please pay and send the reference to ToffeeOS support.";
  // Nothing recorded is not the same as paid up — it used to say "Thank you — you are paid up".
  if (status.state === "unbilled") return "No billing period is on record yet.";
  if (status.isTrial) return "You are on a free trial.";
  return "Thank you — you are paid up.";
}

/**
 * Plan & billing — what the restaurant is on, whether it is paid up, and when it paid.
 *
 * No money figures, by the owner's decision: prices are agreed with ToffeeOS directly, so the page
 * shows the plan, the status and the dates each payment covered, and neither the rate nor the
 * amounts. They are not even read from the database, so they can't reach the page by accident.
 *
 * Read-only. Billing is handled by hand: the platform records each payment as it arrives by bank
 * transfer, JazzCash and so on, so there is nothing here to change or pay online. What an owner
 * needs is the answer to "am I paid up, and until when?" without having to phone and ask.
 *
 * Reads through tenantDb, so row-level security confines it to this restaurant's own subscription
 * and payments; the tenant's status comes from the Tenant row the app is already allowed to read.
 */
export default async function BillingPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.kind !== "tenant") redirect("/login");
  if (!user.permissions.includes("billing.view")) redirect("/app/dashboard");

  const db = tenantDb(user.tenantId);
  const [subscription, payments, activeBranches, tenant] = await Promise.all([
    db.subscription.findFirst({
      select: {
        trialEndsAt: true,
        currentPeriodEnd: true,
        plan: { select: { name: true, maxBranches: true } },
      },
    }),
    db.subscriptionPayment.findMany({
      where: { voidedAt: null },
      orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
      take: 24,
      select: { id: true, periodStart: true, periodEnd: true, method: true },
    }),
    db.branch.count({ where: { isActive: true } }),
    rawDb.tenant.findUnique({ where: { id: user.tenantId }, select: { status: true } }),
  ]);

  const status = subscription
    ? getBillingStatus({
        tenantStatus: tenant?.status ?? "ACTIVE",
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodEnd: subscription.currentPeriodEnd,
      })
    : null;
  const methodLabel = (m: string) => PAYMENT_METHODS.find((p) => p.value === m)?.label ?? m;

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <CreditCard className="size-5" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Plan &amp; billing</h1>
          <p className="text-sm text-muted-foreground">Your plan, whether you are paid up, and your payments.</p>
        </div>
      </div>

      {!subscription || !status ? (
        <Card className="mt-6">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No plan is set up for this restaurant yet. Contact ToffeeOS support.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardDescription>Plan</CardDescription>
                <CardTitle className="font-heading text-xl">{subscription.plan.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {subscription.plan.maxBranches == null
                  ? "Unlimited branches"
                  : `Up to ${subscription.plan.maxBranches} branch${subscription.plan.maxBranches === 1 ? "" : "es"}`}
                {" · "}
                {activeBranches} active
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Status</CardDescription>
                {/* Dark text beside a coloured dot rather than the tinted badge: the badge's green on
                    pale green is below the contrast a status this important should have (2.8:1). */}
                <CardTitle className="flex items-center gap-2 font-heading text-xl">
                  <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${DOT[status.badgeVariant]}`} />
                  {status.state === "inactive" ? "Account paused" : status.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{statusNote(status)}</CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="font-heading text-base">Payments</CardTitle>
              <CardDescription>The period each payment covered, newest first</CardDescription>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Covers</TableHead>
                      <TableHead>Paid by</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap">
                          {p.periodStart.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })} –{" "}
                          {p.periodEnd.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}
                        </TableCell>
                        <TableCell>{methodLabel(p.method)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
