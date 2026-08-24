import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** The shared "hero stat" card used across Reports, Dashboard, Inventory, and the super-admin
 * platform metrics — one visual vocabulary for every KPI number in the app instead of each
 * screen inventing its own. `hero` marks the one number on a panel that matters most (soft
 * primary-tinted glow + top accent bar); use it on at most one card per row. `tone` lets a
 * non-hero card still carry semantic weight (e.g. a warning count) without competing with hero. */
export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  hero,
  tone,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  /** Positive → success-toned "up" treatment, negative → destructive-toned "down". Omit for a
   * plain stat with no directionality (e.g. a raw count). */
  trend?: number | null;
  hero?: boolean;
  tone?: "success" | "warning" | "destructive";
}) {
  const toneTextClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning-foreground"
        : tone === "destructive"
          ? "text-destructive"
          : "text-foreground";
  const toneIconClass =
    tone === "success"
      ? "bg-success/15 text-success"
      : tone === "warning"
        ? "bg-warning/15 text-warning-foreground"
        : tone === "destructive"
          ? "bg-destructive/15 text-destructive"
          : "bg-primary/10 text-primary";
  const toneRingClass =
    tone === "success"
      ? "ring-success/20"
      : tone === "warning"
        ? "ring-warning/25"
        : tone === "destructive"
          ? "ring-destructive/20"
          : "ring-primary/15";
  const toneGlowBgClass =
    tone === "success"
      ? "bg-gradient-to-br from-success/10 via-transparent to-transparent"
      : tone === "warning"
        ? "bg-gradient-to-br from-warning/10 via-transparent to-transparent"
        : tone === "destructive"
          ? "bg-gradient-to-br from-destructive/10 via-transparent to-transparent"
          : "bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent";

  return (
    <Card
      className={cn(
        hero
          ? cn(
              "relative overflow-hidden shadow-lg ring-1 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-gradient-to-r before:from-primary before:via-primary/60 before:to-transparent",
              toneRingClass
            )
          : "shadow-sm transition-shadow hover:shadow-md"
      )}
    >
      <CardContent className={cn("flex items-start justify-between gap-3 pt-6", hero && toneGlowBgClass)}>
        <div className="min-w-0">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
          <div
            className={cn(
              "font-heading font-bold tabular-nums",
              hero ? `mt-1.5 text-3xl ${tone ? toneTextClass : "text-primary"}` : `mt-1 text-2xl ${tone ? toneTextClass : "text-foreground"}`
            )}
          >
            {value}
          </div>
          {trend !== undefined && trend !== null && (
            <div
              className={cn(
                "mt-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold",
                trend >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
              )}
            >
              {trend >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
              {trend >= 0 ? "+" : ""}
              {trend.toFixed(1)}%
            </div>
          )}
        </div>
        {Icon && (
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              hero ? "ring-4 ring-primary/5" : "",
              toneIconClass
            )}
          >
            <Icon className="size-4.5" />
          </span>
        )}
      </CardContent>
    </Card>
  );
}
