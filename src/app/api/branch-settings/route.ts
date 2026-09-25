import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";
import { MAX_DAY_START_MINUTES } from "@/lib/business-day";

export const GET = defineHandler({ permission: "settings.general.manage" }, async ({ session, db }) => {
  const settings = await db.branchSettings.findUnique({ where: { branchId: session.branchId } });
  return { settings };
});

// Every field optional and independently settable — the PATCH is a partial update (e.g. the
// inventory screen only ever sends defaultStockLocationId), not a full-object replace.
const schema = z.object({
  defaultStockLocationId: z.string().min(1).nullable().optional(),
  // Basis points, 0-10000 (0-100%). Was previously stuck at its BranchSettings.@default(0) forever
  // — no route accepted a write for it, so no tenant could ever turn a service charge on.
  serviceChargeBasisPoints: z.number().int().min(0).max(10000).optional(),
  serviceChargeAppliesTo: z.array(z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY", "SERVICE"])).optional(),
  serviceChargeTaxable: z.boolean().optional(),
  roundingMode: z.enum(["NONE", "NEAREST_1", "NEAREST_5"]).optional(),
  kdsEnabled: z.boolean().optional(),
  showLogoOnReceipt: z.boolean().optional(),
  // Empty string from a cleared textarea is normalised to null by the handler below, so "no header"
  // is one value rather than two that render identically.
  receiptHeader: z.string().max(280).nullable().optional(),
  // Null = overtime off. See the schema comment on BranchSettings and computeHourlyBreakdown in
  // src/server/hr.ts for how these two are actually applied.
  overtimeThresholdHoursPerWeek: z.number().int().min(1).max(168).nullable().optional(),
  overtimeMultiplierBasisPoints: z.number().int().min(10000).max(100000).optional(),
  // Basis points of the amount being discounted. 10000 = 100% = no cap, which is the default and
  // what every branch had before this field existed.
  maxDiscountBasisPoints: z.number().int().min(0).max(10000).optional(),
  // Whole quarter-hours between midnight and 6am, matching the database CHECK constraint.
  dayStartMinutes: z.number().int().min(0).max(MAX_DAY_START_MINUTES).multipleOf(15).optional(),
});

export const PATCH = defineHandler(
  {
    permission: "settings.general.manage",
    input: schema,
    audit: (input) => ({
      action: "branch_settings.update",
      entityType: "BranchSettings",
      metadata: { ...input },
    }),
  },
  async ({ session, db, input }) => {
    // What customers are charged on top of their food is its own permission: someone trusted with
    // the receipt header or the kitchen screen is not thereby trusted to change every bill.
    const touchesServiceCharge =
      input.serviceChargeBasisPoints !== undefined ||
      input.serviceChargeAppliesTo !== undefined ||
      input.serviceChargeTaxable !== undefined;
    if (touchesServiceCharge && !session.permissions.includes("settings.serviceCharge.manage")) {
      throw new HttpError(403, "Changing the service charge needs the \"Manage service charge\" permission.");
    }
    const settings = await db.branchSettings.update({
      where: { branchId: session.branchId },
      data: {
        ...input,
        ...(input.receiptHeader !== undefined
          ? { receiptHeader: input.receiptHeader?.trim() || null }
          : {}),
      },
    });
    return { settings };
  }
);
