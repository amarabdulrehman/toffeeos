"use client";

import { SectionError } from "@/components/errors/section-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} retry={reset} label="Reports" />;
}
