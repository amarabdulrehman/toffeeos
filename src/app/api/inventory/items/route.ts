import { z } from "zod";
import { defineHandler, HttpError } from "@/server/handler";
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
    // Setting when low-stock alerts fire is its own permission (inventory.lowStockAlert.configure):
    // someone may add stock items without deciding when the owner gets messaged about them.
    if (input.lowStockThresholdQty > 0 && !session.permissions.includes("inventory.lowStockAlert.configure")) {
      throw new HttpError(403, "Setting a low-stock alert level needs the \"Configure low-stock alerts\" permission.");
    }
    const item = await createItem(session.tenantId, input);
    return { item };
  }
);
