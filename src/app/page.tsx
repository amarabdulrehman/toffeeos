import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BRAND_NAME, BRAND_TAGLINE } from "@/config/brand";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-muted/30 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">{BRAND_NAME}</h1>
      <p className="mt-2 max-w-md text-muted-foreground">{BRAND_TAGLINE}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        POS · Kitchen Display · Inventory · Reports — built for dine-in, takeaway, and delivery.
      </p>
      <div className="mt-8 flex gap-3">
        <Button render={<Link href="/signup" />} nativeButton={false} size="lg">
          Start free trial
        </Button>
        <Button render={<Link href="/login" />} nativeButton={false} variant="outline" size="lg">
          Sign in
        </Button>
      </div>
    </div>
  );
}
