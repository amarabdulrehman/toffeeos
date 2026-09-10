import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

// Next.js serves its own bare 404 without this. Deliberately the same shape as src/app/error.tsx —
// same centred card, same icon treatment, same button pair — so a wrong URL looks like part of the
// product rather than a crash. No tenant or auth context is assumed: this renders for signed-out
// visitors hitting a bad storefront link as much as for staff mistyping an app route, so it links
// to the sign-in page rather than anywhere inside the app.
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Compass className="size-6" />
        </div>
        <h1 className="font-heading text-lg font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          That link doesn&apos;t point anywhere. It may have been moved, or the address might have a
          typo in it.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          {/* A styled Link rather than a Button: this stays a server component (nothing here needs
              interactivity), and Button renders a real <button>, which must not wrap an anchor. */}
          <Link href="/login" className={buttonVariants({ size: "sm" })}>
            Go to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
