import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { createItem, listItems } from "@/server/inventory";

export const GET = defineHandler({ permission: "inventory.view" }, async ({ session }) => {
  const items = await listItems(session.tenantId);
  return { items };
});

const schema = z.object({
  name: z.string().min(1).max(120),
  unitOfMeasure: z.string().min(1).max(20),
  lowStockThresholdQty: z.number().nonnegative(),
});

export const POST = defineHandler(
  { permission: "inventory.item.manage", input: schema },
  async ({ session, input }) => {
    const item = await createItem(session.tenantId, input);
    return { item };
  }
);
