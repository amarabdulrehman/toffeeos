"use client";

import * as Sentry from "@sentry/nextjs";
import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/report-client-error";

/**
 * Keeps one part of a screen from taking the rest of it down.
 *
 * The POS had a single boundary for the whole page (src/app/pos/error.tsx). Any error anywhere in
 * it — the queue, a dialog, one odd order — replaced the entire till with "POS hit a problem", and
 * "Try again" remounted it with an empty cart. On 9 October 2026 a café hit that on and off during
 * service. Wrapping each part separately means the part that failed says so and offers to retry,
 * while the menu, the cart and everything already rung up stay exactly where they were.
 *
 * Every catch is reported (to Sentry through the server, tagged with the part's name, and to the
 * console as "[POS] name"),
 * so a contained failure is still a bug someone hears about rather than one the till quietly lives
 * with. e2e/pos-resilience.spec.ts fails on that console line.
 *
 * `resetKeys`: when any of them changes, the part tries again by itself — a dialog reopened for
 * another order, the queue reopened.
 */
export class PanelBoundary extends Component<
  {
    name: string;
    children: ReactNode;
    /** What to show instead. Defaults to a short notice with Try again; null shows nothing. */
    fallback?: ReactNode | ((retry: () => void) => ReactNode);
    /** Told once per failure, e.g. to close the dialog that failed. */
    onCaught?: (error: Error) => void;
    resetKeys?: unknown[];
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    Sentry.captureException(error, { tags: { section: `POS · ${this.props.name}` } });
    // The browser has no Sentry client unless NEXT_PUBLIC_SENTRY_DSN is set; the server does.
    reportClientError(`POS · ${this.props.name}`, error);
    console.error(`[POS] ${this.props.name}:`, error);
    this.props.onCaught?.(error);
  }

  componentDidUpdate(prev: { resetKeys?: unknown[] }) {
    if (!this.state.error) return;
    const a = prev.resetKeys ?? [];
    const b = this.props.resetKeys ?? [];
    if (a.length !== b.length || a.some((k, i) => !Object.is(k, b[i]))) this.setState({ error: null });
  }

  retry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    const { fallback, name } = this.props;
    if (typeof fallback === "function") return fallback(this.retry);
    if (fallback !== undefined) return fallback;
    return (
      <div role="alert" className="flex flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" />
        </div>
        <p className="text-sm font-semibold">{name} hit a problem</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          The rest of the till is fine, and nothing already rung up has been lost.
        </p>
        <Button size="sm" variant="outline" onClick={this.retry}>
          Try again
        </Button>
      </div>
    );
  }
}
