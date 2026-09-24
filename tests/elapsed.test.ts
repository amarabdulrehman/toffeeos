import { describe, expect, it } from "vitest";
import { formatElapsed } from "@/lib/elapsed";

describe("kitchen ticket timer", () => {
  it("reads minutes and seconds under an hour, as before", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(125)).toBe("2:05");
    expect(formatElapsed(59 * 60 + 59)).toBe("59:59");
  });

  it("switches to hours past an hour, instead of an unreadable minute count", () => {
    expect(formatElapsed(3600)).toBe("1h 00m");
    expect(formatElapsed(3600 + 4 * 60 + 30)).toBe("1h 04m");
  });

  it("switches to days for a ticket that has clearly been forgotten", () => {
    // The real case that prompted this: a ticket left on the board read "29259:41".
    expect(formatElapsed(29259 * 60 + 41)).toBe("20d 7h");
  });
});
