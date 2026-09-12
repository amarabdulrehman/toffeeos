"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { revokeMySessions } from "@/server/session-revocation";

/**
 * Drops the service worker's cached page HTML on the way out.
 *
 * Those pages are rendered for one person — /pos has the cashier's branch and permission flags
 * baked into the HTML — and a café tablet is shared. Without this, the next cashier could be handed
 * the previous one's page from cache during an outage. Best-effort: a sign-out must never be
 * blocked by the cache refusing to clear.
 */
async function clearOfflinePageCache() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    registration?.active?.postMessage({ type: "CLEAR_PAGES" });
  } catch {
    // No worker, or messaging failed — sign out regardless.
  }
}

/** `onDark` swaps to a variant legible on the dark navy chrome (POS/KDS headers) instead of the
 * default bordered button, which would render as a light box against a dark bar. */
export function SignOutButton({
  onDark = false,
  label = "Sign out",
  callbackUrl = "/login",
  className,
}: {
  onDark?: boolean;
  label?: string;
  callbackUrl?: string;
  className?: string;
}) {
  const [signingOut, setSigningOut] = useState(false);

  /**
   * Revoke server-side first, then clear the cookie. Order matters: signOut() navigates away, so a
   * revocation fired after it can be cut short by the page unload and leave the token still valid.
   * If revocation fails we still sign out locally — refusing to clear the cookie would strand the
   * user in a session they are actively trying to leave, which is worse than the cookie-only
   * behaviour we already had.
   */
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await revokeMySessions();
    } catch {
      // fall through
    }
    await clearOfflinePageCache();
    await signOut({ callbackUrl });
  };

  return (
    <Button
      variant={onDark ? "ghost" : "outline"}
      size="sm"
      className={className ?? (onDark ? "w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" : "w-full")}
      onClick={handleSignOut}
      disabled={signingOut}
    >
      {signingOut ? "Signing out…" : label}
    </Button>
  );
}
