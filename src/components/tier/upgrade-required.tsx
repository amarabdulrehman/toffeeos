import { Lock } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TIER_LABEL, type TierKey } from "@/lib/tiers";

/**
 * Rendered instead of a feature page when the tenant's plan doesn't include it — a plain "server
 * component, no data fetch" card, so it's cheap to drop into any Server Component page. Distinct
 * from a permission failure (which still redirects to /app/dashboard, an existing convention):
 * this is reachable-but-not-entitled, so the tenant should understand *why*, not just bounce.
 */
export function UpgradeRequired({ feature, requiredTier }: { feature: string; requiredTier: TierKey }) {
  return (
    <div className="p-8">
      <Card className="mx-auto mt-12 max-w-md text-center shadow-sm">
        <CardHeader className="items-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="size-5" />
          </span>
          <CardTitle className="font-heading">{feature} isn&apos;t enabled</CardTitle>
          <CardDescription>
            {feature} is available on the {TIER_LABEL[requiredTier]} plan and above, and can also be enabled
            individually. Ask your platform admin to turn it on for this restaurant.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
