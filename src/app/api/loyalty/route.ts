import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { getProgram, saveProgram } from "@/server/loyalty";

// GET /api/loyalty — the restaurant's loyalty scheme. Any till can read it: the payment screen shows
// what a customer's points are worth.
export const GET = defineHandler({ permission: "pos.access" }, async ({ session }) => {
  const p = await getProgram(session.tenantId);
  return { program: { isEnabled: p.isEnabled, pointsPerHundredRupees: p.pointsPerHundredRupees, paisaPerPoint: p.paisaPerPoint } };
});

const schema = z.object({
  isEnabled: z.boolean(),
  pointsPerHundredRupees: z.number().int().min(0).max(100),
  paisaPerPoint: z.number().int().min(1).max(100_000),
});

// PUT /api/loyalty — switch the scheme on or off and set its two numbers.
export const PUT = defineHandler(
  {
    permission: "settings.general.manage",
    input: schema,
    audit: (input) => ({ action: "loyalty.program.update", entityType: "LoyaltyProgram", metadata: { ...input } }),
  },
  async ({ session, input }) => {
    return { program: await saveProgram(session.tenantId, input) };
  }
);
