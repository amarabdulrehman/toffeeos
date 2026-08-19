import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { takePayment } from "@/server/orders";

const tenderSchema = z.object({
  method: z.enum(["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER", "OTHER"]),
  amountPaisa: z.number().int().positive(),
});

const paySchema = z.object({
  tenders: z.array(tenderSchema).min(1),
  // Only ever sent by the offline sync queue replaying a payment taken while disconnected — see
  // the note on takePayment in src/server/orders.ts.
  actionId: z.string().min(1).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

// This is the authoritative pricing pass (finalizeOrder in src/lib/pricing.ts) — a split
// cash+card payment gets its actual blended Punjab PRA tax rate here, not the provisional
// cash-rate estimate the cart showed while building.
export const POST = defineHandler(
  { permission: "pos.payment.take", input: paySchema },
  async ({ session, params, input }) => {
    const order = await takePayment(
      session.tenantId,
      session.branchId,
      params.orderId,
      session.id,
      { tenders: input.tenders },
      input.actionId,
      input.expectedVersion
    );
    return { order };
  }
);
