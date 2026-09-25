import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { listSuppliers, saveSupplier } from "@/server/purchasing";

// GET /api/inventory/suppliers — for the purchase order picker, so anyone who may order may read it.
export const GET = defineHandler({ permission: "inventory.view" }, async ({ session }) => {
  return { suppliers: await listSuppliers(session.tenantId) };
});

const schema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  phone: z.string().max(40).nullish(),
  email: z.string().max(160).nullish(),
  notes: z.string().max(500).nullish(),
  isActive: z.boolean().optional(),
});

// POST /api/inventory/suppliers — add a supplier, or change one (with id).
export const POST = defineHandler(
  {
    permission: "inventory.supplier.manage",
    input: schema,
    audit: (input) => ({ action: input.id ? "supplier.update" : "supplier.create", entityType: "Supplier", entityId: input.id, metadata: { ...input } }),
  },
  async ({ session, input }) => {
    return { supplier: await saveSupplier(session.tenantId, input) };
  }
);
