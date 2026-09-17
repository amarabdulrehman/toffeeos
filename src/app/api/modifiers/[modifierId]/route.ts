import { defineHandler } from "@/server/handler";
import { removeModifier } from "@/server/menu-options";

export const DELETE = defineHandler(
  { permission: "menu.manage", audit: () => ({ action: "modifier.delete", entityType: "Modifier" }) },
  async ({ session, params }) => {
    await removeModifier(session.tenantId, params.modifierId);
    return { ok: true };
  }
);
