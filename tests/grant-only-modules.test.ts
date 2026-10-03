import { describe, it, expect } from "vitest";
import { defaultModulesForTier, GRANT_ONLY_KEYS, TIER_ORDER } from "@/lib/tiers";

/**
 * Deleting orders is given out restaurant by restaurant from the admin panel, never with a plan.
 * If a plan's defaults ever included it, every upgrade would hand out the power to remove sales.
 */
describe("grant-only features", () => {
  it("includes order deletion", () => {
    expect(GRANT_ONLY_KEYS).toContain("orderDelete");
  });

  it("are never switched on by any plan", () => {
    for (const tier of TIER_ORDER) {
      for (const key of GRANT_ONLY_KEYS) {
        expect(defaultModulesForTier(tier), `${tier} must not include ${key}`).not.toContain(key);
      }
    }
  });
});
