"use client";

import { useEffect, useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function ImpersonateHandoff() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [signInFailed, setSignInFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    signIn("impersonate", { token, redirect: false }).then((result) => {
      if (result?.error) {
        setSignInFailed(true);
        return;
      }
      router.push("/app/dashboard");
      router.refresh();
    });
    // Runs once per mount with the token from the URL — re-running on every searchParams object
    // identity change would fire duplicate signIn calls against a single-use token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token || signInFailed) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        That impersonation link has expired or was already used. Go back to the platform panel and try again.
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Signing you in…
    </div>
  );
}

export default function ImpersonatePage() {
  return (
    <Suspense>
      <ImpersonateHandoff />
    </Suspense>
  );
}
