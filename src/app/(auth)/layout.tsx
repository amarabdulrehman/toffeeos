import { BRAND_NAME, BRAND_TAGLINE } from "@/config/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{BRAND_NAME}</h1>
        <p className="text-sm text-muted-foreground">{BRAND_TAGLINE}</p>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
