"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { BRAND_NAME } from "@/config/brand";

// Catches errors that escape every other boundary, including the root layout itself. Next.js
// renders this as its own standalone document (no access to globals.css / the app's fonts or
// design tokens — see the "Good to know" in the error.js file-convention docs), so this is
// deliberately plain inline-styled HTML rather than Tailwind classes.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#f5f5f7",
          color: "#1a1a2e",
        }}
      >
        <div style={{ maxWidth: 420, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#555", margin: "0 0 20px", lineHeight: 1.5 }}>
            {BRAND_NAME} hit an unexpected error and couldn&apos;t load this page. Your data is safe — try
            reloading, and contact support if it keeps happening.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: "#888", margin: "0 0 20px", fontFamily: "monospace" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={() => retry()}
            style={{
              background: "#6d28d9",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 20px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
