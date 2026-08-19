import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { signupTenant } from "@/server/tenant-signup";

// Public, unauthenticated — this is the one route that legitimately creates a Tenant. No session
// exists yet, so it does not go through defineHandler (which requires one).
const signupSchema = z.object({
  restaurantName: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  ownerName: z.string().min(2).max(120),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8, "Password must be at least 8 characters"),
  branchName: z.string().min(2).max(120),
  city: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => ({}));
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await signupTenant(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signup failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
