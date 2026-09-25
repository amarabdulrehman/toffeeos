import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { branchPrices, setBranchPrice } from "@/server/branch-prices";
import { assertWritableBranchId } from "@/server/reports";

// GET /api/menu-items/[menuItemId]/branch-prices — the item's price at each branch.
export const GET = defineHandler({ permission: "menu.view" }, async ({ session, params }) => {
  return branchPrices(session.tenantId, params.menuItemId);
});

const schema = z.object({
  branchId: z.string().min(1),
  /** Null goes back to the menu price. */
  pricePaisa: z.number().int().nonnegative().nullable(),
});

// PUT /api/menu-items/[menuItemId]/branch-prices — set (or clear) one branch's own price. A branch
// manager can only price their own branch; assertWritableBranchId is the same rule the drawer and
// payroll use.
export const PUT = defineHandler(
  {
    permission: "menu.priceOverride",
    input: schema,
    audit: (input) => ({ action: "menu.branchPrice.set", entityType: "MenuItem", metadata: { ...input } }),
  },
  async ({ session, params, input }) => {
    const branchId = await assertWritableBranchId(session, input.branchId);
    const row = await setBranchPrice(session.tenantId, params.menuItemId, branchId, input.pricePaisa);
    return { branchId: row.branchId, pricePaisa: row.priceOverridePaisa };
  }
);
