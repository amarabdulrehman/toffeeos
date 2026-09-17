import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { listItemModifierGroupIds, setItemModifierGroups } from "@/server/menu-options";

// Which add-on groups this item offers. PUT takes the whole list rather than exposing attach and
// detach separately: the screen shows a checklist, so the list is what it already has, and sending
// it twice changes nothing.
export const GET = defineHandler({ permission: "menu.view" }, async ({ session, params }) => {
  const groupIds = await listItemModifierGroupIds(session.tenantId, params.menuItemId);
  return { groupIds };
});

const schema = z.object({ groupIds: z.array(z.string().min(1)).max(50) });

export const PUT = defineHandler(
  {
    permission: "menu.manage",
    input: schema,
    audit: (input) => ({
      action: "menu_item.modifier_groups.set",
      entityType: "MenuItem",
      metadata: { count: (input as { groupIds: string[] }).groupIds.length },
    }),
  },
  async ({ session, params, input }) => {
    const groupIds = await setItemModifierGroups(session.tenantId, params.menuItemId, input.groupIds);
    return { groupIds };
  }
);
