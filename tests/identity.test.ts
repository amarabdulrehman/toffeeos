import { describe, expect, it } from "vitest";
import { emailInput, normalizeEmail, normalizeSlug, slugInput } from "@/lib/identity";

/**
 * The one rule every login-related schema shares. Pinned here because it is easy to get subtly
 * wrong: normalizing *after* validation would reject " a@b.com" as malformed before ever trimming
 * it, which is exactly the autocomplete-trailing-space failure this exists to fix.
 */
describe("login identifiers", () => {
  it("normalizes an email before validating it", () => {
    expect(emailInput().parse("  Ali@Cafe.COM ")).toBe("ali@cafe.com");
  });

  it("still rejects something that is not an email", () => {
    expect(emailInput().safeParse("not an email").success).toBe(false);
  });

  it("normalizes a restaurant code", () => {
    expect(slugInput().parse(" Karachi-Karahi ")).toBe("karachi-karahi");
    expect(slugInput().safeParse("   ").success, "blank after trimming is still blank").toBe(false);
  });

  it("offers the same rule outside a schema", () => {
    expect(normalizeEmail(" X@Y.pk ")).toBe("x@y.pk");
    expect(normalizeSlug(" ABC ")).toBe("abc");
  });
});
