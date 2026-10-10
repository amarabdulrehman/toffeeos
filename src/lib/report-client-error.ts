/**
 * Tells the server about an error a screen caught in the browser — see /api/client-errors.
 *
 * Fire and forget: reporting must never be the thing that fails. keepalive lets it finish even if
 * the cashier taps "Try again" or the page reloads straight away.
 */
export function reportClientError(section: string, error: unknown): void {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        section: section.slice(0, 80),
        name: e.name.slice(0, 80),
        message: e.message.slice(0, 500),
        stack: e.stack?.slice(0, 4000),
        path: window.location.pathname.slice(0, 200),
      }),
    }).catch(() => {});
  } catch {
    // Nothing to do: the screen has already shown its own fallback.
  }
}
