import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { resolveConflict } from "@/server/sync-conflicts";

const bodySchema = z.object({ note: z.string().min(1).max(500) });

// POST /api/sync-conflicts/[conflictId]/resolve — a manager marks a conflict reviewed, with a
// required note on what they decided. This is deliberately manual: the whole point of flagging a
// conflict instead of guessing (last-write-wins) is that a human looks at both sides and decides.
export const POST = defineHandler(
  { permission: "sync.conflict.resolve", input: bodySchema },
  async ({ session, params, input }) => {
    const conflict = await resolveConflict(session.tenantId, params.conflictId, session.id, input.note);
    return { conflict };
  }
);
