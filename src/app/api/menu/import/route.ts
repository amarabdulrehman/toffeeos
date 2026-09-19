import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { applyMenuImport, previewMenuImport } from "@/server/menu-import";

// Each item and each of its sizes is its own write, so a full menu is a few hundred round trips.
// Comfortably inside a minute at any realistic size, but nowhere near the default ten seconds.
// The parser refuses anything large enough to threaten even this.
export const maxDuration = 60;

// Roughly a 5,000-line menu. Large enough for any real café, small enough that a pasted novel is
// refused before it reaches the parser.
const MAX_CSV_BYTES = 512 * 1024;

const schema = z.object({
  csv: z.string().min(1).max(MAX_CSV_BYTES),
  /** Look without touching. The screen always previews first — this is not an optional nicety. */
  dryRun: z.boolean().optional(),
});

// POST /api/menu/import — read a menu out of a spreadsheet.
//
// menu.manage, the same permission as adding one item by hand: this is that action repeated, not a
// more privileged one. Auditing records the counts rather than the file, since a 78-row CSV in an
// audit payload is noise nobody will ever read.
export const POST = defineHandler(
  {
    permission: "menu.manage",
    input: schema,
    audit: (input, result) => {
      const r = result as { summary?: { itemsCreated: number; variantsCreated: number } };
      return {
        action: (input as { dryRun?: boolean }).dryRun ? "menu.import.preview" : "menu.import",
        entityType: "MenuItem",
        metadata: {
          itemsCreated: r.summary?.itemsCreated ?? 0,
          variantsCreated: r.summary?.variantsCreated ?? 0,
        },
      };
    },
  },
  async ({ session, input }) => {
    if (input.dryRun) {
      return { summary: await previewMenuImport(session.tenantId, input.csv) };
    }
    return { summary: await applyMenuImport(session.tenantId, input.csv) };
  }
);
