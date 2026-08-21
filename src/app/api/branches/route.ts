import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { createBranch, listBranches } from "@/server/branches";

export const GET = defineHandler({ permission: "branch.manage" }, async ({ session }) => {
  const branches = await listBranches(session.tenantId);
  return { branches };
});

const createSchema = z.object({
  name: z.string().min(2).max(120),
  address: z.string().max(200).optional(),
});

export const POST = defineHandler(
  {
    permission: "branch.manage",
    input: createSchema,
    audit: (input) => ({ action: "branch.create", entityType: "Branch", metadata: { name: input.name } }),
  },
  async ({ session, input }) => {
    const branch = await createBranch(session.tenantId, input);
    return { branch };
  }
);
