import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { addModifier } from "@/server/menu-options";

// priceDeltaPaisa, not an absolute price: an add-on is what it adds to whatever it is added to.
// Negative is allowed on purpose — "no cheese, take 50 off" is a real thing on a menu.
const schema = z.object({
  name: z.string().min(1).max(80),
  priceDeltaPaisa: z.number().int().min(-1_000_000).max(1_000_000),
});

export const POST = defineHandler(
  {
    permission: "menu.manage",
    input: schema,
    audit: (input, result) => ({
      action: "modifier.create",
      entityType: "Modifier",
      entityId: (result as { modifier: { id: string } }).modifier.id,
      metadata: { name: input.name, priceDeltaPaisa: input.priceDeltaPaisa },
    }),
  },
  async ({ session, params, input }) => {
    const modifier = await addModifier(session.tenantId, params.groupId, input);
    return { modifier };
  }
);
