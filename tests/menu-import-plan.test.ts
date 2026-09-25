import { describe, expect, it } from "vitest";
import { planItemUpdate, type ExistingItem } from "@/lib/menu-import-plan";
import type { ParsedItem } from "@/lib/menu-csv";

function file(p: Partial<ParsedItem>): ParsedItem {
  return { category: "Coffee", name: "Latte", variants: [], pricePaisa: 0, line: 2, ...p };
}

const single: ExistingItem = { id: "i1", basePricePaisa: 48_000, description: "Hot", variants: [] };
const sized: ExistingItem = {
  id: "i2",
  basePricePaisa: 59_900,
  description: null,
  variants: [
    { id: "v12", name: "12oz", priceDeltaPaisa: 0 },
    { id: "v16", name: "16oz", priceDeltaPaisa: 10_000 },
  ],
};

describe("re-importing an item that is already on the menu", () => {
  it("changes nothing when the file matches", () => {
    expect(planItemUpdate(single, file({ pricePaisa: 48_000 }))).toEqual({ kind: "same" });
    expect(
      planItemUpdate(
        sized,
        file({
          pricePaisa: 59_900,
          variants: [
            { name: "12oz", pricePaisa: 59_900, line: 2 },
            { name: "16oz", pricePaisa: 69_900, line: 3 },
          ],
        })
      )
    ).toEqual({ kind: "same" });
  });

  it("takes a new single price", () => {
    const plan = planItemUpdate(single, file({ pricePaisa: 52_000 }));
    expect(plan.kind).toBe("update");
    if (plan.kind !== "update") return;
    expect(plan.basePricePaisa).toBe(52_000);
    expect(plan.changes).toEqual(["price Rs 480 → Rs 520"]);
  });

  it("reprices one size and keeps the other where it was, even though the base moves", () => {
    // The 12oz goes up to Rs 649, so the cheapest — and the base — becomes 649. The 16oz must still
    // cost Rs 699 afterwards, which means its stored difference has to be worked out again.
    const plan = planItemUpdate(
      sized,
      file({
        pricePaisa: 64_900,
        variants: [
          { name: "12oz", pricePaisa: 64_900, line: 2 },
          { name: "16oz", pricePaisa: 69_900, line: 3 },
        ],
      })
    );
    expect(plan.kind).toBe("update");
    if (plan.kind !== "update") return;
    expect(plan.basePricePaisa).toBe(64_900);
    expect(plan.variantPrices).toEqual([
      { id: "v12", pricePaisa: 64_900 },
      { id: "v16", pricePaisa: 69_900 },
    ]);
    expect(plan.changes).toEqual(["12oz Rs 599 → Rs 649"]);
  });

  it("adds a size the menu doesn't have, and never removes one the file leaves out", () => {
    const plan = planItemUpdate(
      sized,
      file({
        pricePaisa: 59_900,
        variants: [
          { name: "12oz", pricePaisa: 59_900, line: 2 },
          { name: "20oz", pricePaisa: 79_900, line: 3 },
        ],
      })
    );
    expect(plan.kind).toBe("update");
    if (plan.kind !== "update") return;
    expect(plan.newVariants).toEqual([{ name: "20oz", pricePaisa: 79_900 }]);
    // 16oz is not in the file: it stays, at its old price.
    expect(plan.variantPrices).toContainEqual({ id: "v16", pricePaisa: 69_900 });
  });

  it("matches sizes regardless of capitals", () => {
    const plan = planItemUpdate(
      sized,
      file({
        pricePaisa: 59_900,
        variants: [
          { name: "12OZ", pricePaisa: 59_900, line: 2 },
          { name: "16Oz", pricePaisa: 69_900, line: 3 },
        ],
      })
    );
    expect(plan).toEqual({ kind: "same" });
  });

  it("gives a single-price item sizes when the file lists them", () => {
    const plan = planItemUpdate(
      single,
      file({
        pricePaisa: 45_000,
        variants: [
          { name: "Half", pricePaisa: 45_000, line: 2 },
          { name: "Full", pricePaisa: 80_000, line: 3 },
        ],
      })
    );
    expect(plan.kind).toBe("update");
    if (plan.kind !== "update") return;
    expect(plan.basePricePaisa).toBe(45_000);
    expect(plan.newVariants.map((v) => v.name)).toEqual(["Half", "Full"]);
    expect(plan.changes).toEqual(["sizes added: Half, Full"]);
  });

  it("leaves an item with sizes alone when the file gives it one price, and says why", () => {
    const plan = planItemUpdate(sized, file({ pricePaisa: 50_000 }));
    expect(plan).toEqual({ kind: "leftAlone", reason: "has sizes on the menu (12oz, 16oz) but one price in the file" });
  });

  it("updates a description the file gives, and keeps one the file leaves blank", () => {
    const changed = planItemUpdate(single, file({ pricePaisa: 48_000, description: "Very hot" }));
    expect(changed.kind === "update" && changed.description).toBe("Very hot");
    expect(planItemUpdate(single, file({ pricePaisa: 48_000, description: undefined }))).toEqual({ kind: "same" });
  });
});
