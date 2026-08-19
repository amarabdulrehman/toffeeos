import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { getBranchPricingContext } from "@/server/orders";
import { computeProvisionalTotal, type PricingLineInput } from "@/lib/pricing";

const discountSchema = z.object({ type: z.enum(["PERCENT", "FIXED"]), value: z.number().int().nonnegative() });

const previewSchema = z.object({
  type: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY", "SERVICE"]),
  lines: z.array(
    z.object({
      unitPricePaisa: z.number().int(),
      quantity: z.number().int(),
      discount: discountSchema.optional(),
    })
  ),
  orderDiscount: discountSchema.optional(),
});

/** Live subtotal/service-charge/tax/total for the cart currently being built, before the order is
 * punched — recomputed on every cart change so the POS total never lags the pricing engine. */
export const POST = defineHandler({ permission: "pos.access", input: previewSchema }, async ({ session, input }) => {
  const { settings, taxRules } = await getBranchPricingContext(session.tenantId, session.branchId, input.type);
  const lines: PricingLineInput[] = input.lines.map((l, i) => ({ id: String(i), ...l }));
  return computeProvisionalTotal(lines, input.orderDiscount, taxRules, settings);
});
