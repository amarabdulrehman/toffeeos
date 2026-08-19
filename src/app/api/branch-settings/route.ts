import { z } from "zod";
import { defineHandler } from "@/server/handler";

export const GET = defineHandler({ permission: "settings.general.manage" }, async ({ session, db }) => {
  const settings = await db.branchSettings.findUnique({ where: { branchId: session.branchId } });
  return { settings };
});

const schema = z.object({ defaultStockLocationId: z.string().min(1).nullable() });

export const PATCH = defineHandler(
  { permission: "settings.general.manage", input: schema },
  async ({ session, db, input }) => {
    const settings = await db.branchSettings.update({
      where: { branchId: session.branchId },
      data: { defaultStockLocationId: input.defaultStockLocationId },
    });
    return { settings };
  }
);
