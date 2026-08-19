"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

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
  return (
    <Button
      variant={onDark ? "ghost" : "outline"}
      size="sm"
      className={className ?? (onDark ? "w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" : "w-full")}
      onClick={() => signOut({ callbackUrl })}
    >
      {label}
    </Button>
  );
}
