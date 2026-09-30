import "dotenv/config";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile } from "./fixtures/test-data";

/**
 * Building a floor plan: how many tables a floor holds, and what a clashing name does.
 *
 * Written after a report that a floor was "locked at 10 tables". There was no cap — table labels
 * were unique per *branch*, so the moment a name was already used anywhere in the restaurant the
 * insert failed, and because the duplicate-key error was unhandled it surfaced as a bare
 * "Internal error". A limit nobody wrote looked real because the error explained nothing, so these
 * tests pin both halves: the count that is allowed, and the message when a name genuinely clashes.
 */

/** Tracks everything created so a failed assertion still leaves the branch's floor plan as it was. */
function tracker(request: APIRequestContext) {
  const floors: string[] = [];
  const tables: string[] = [];
  return {
    floors,
    tables,
    async floor(name: string) {
      const res = await request.post("/api/floors", { data: { name } });
      expect(res.ok(), await res.text()).toBeTruthy();
      const id = (await res.json()).floor.id as string;
      floors.push(id);
      return id;
    },
    async table(floorId: string, label: string) {
      const res = await request.post("/api/tables", { data: { floorId, label, seats: 4 } });
      if (res.ok()) tables.push((await res.json()).table.id);
      return res;
    },
    async cleanup() {
      for (const id of tables) await request.delete(`/api/tables/${id}`);
      for (const id of floors) await request.delete(`/api/floors/${id}`);
    },
  };
}

test.describe("Floor plan", () => {
  test.use({ storageState: authFile("owner") });

  test("a floor takes far more than ten tables", async ({ request }) => {
    // Twelve round trips to a database in another region, plus the same again tearing down, runs
    // past the default timeout on a slow link — the count is the point of the test, so the budget
    // is raised rather than the count lowered below what proves it.
    test.setTimeout(180_000);
    const t = tracker(request);
    try {
      const floorId = await t.floor(`E2E Capacity ${Date.now()}`);
      for (let i = 1; i <= 12; i++) {
        const res = await t.table(floorId, `${i}`);
        expect(res.status(), `table ${i} should have been accepted`).toBe(200);
      }

      const layout = await (await request.get("/api/tables")).json();
      const floor = layout.floors.find((f: { id: string }) => f.id === floorId);
      expect(floor.tables).toHaveLength(12);
    } finally {
      await t.cleanup();
    }
  });

  test("two floors can number their tables the same way", async ({ request }) => {
    // The actual bug: numbering 1-10 downstairs and 1-10 upstairs is how restaurants label tables,
    // and a branch-wide constraint made the second floor impossible to set up.
    const t = tracker(request);
    try {
      const stamp = Date.now();
      const ground = await t.floor(`E2E Ground ${stamp}`);
      const first = await t.floor(`E2E First ${stamp}`);

      // Three each is enough: what is under test is whether the name may repeat across floors at
      // all, not how many times it can.
      for (let i = 1; i <= 3; i++) expect((await t.table(ground, `${i}`)).status()).toBe(200);
      for (let i = 1; i <= 3; i++) {
        const res = await t.table(first, `${i}`);
        expect(res.status(), `"${i}" upstairs must not collide with "${i}" downstairs`).toBe(200);
      }
    } finally {
      await t.cleanup();
    }
  });

  test("a name already used on that floor is refused, and says so", async ({ request }) => {
    const t = tracker(request);
    try {
      const floorId = await t.floor(`E2E Duplicate ${Date.now()}`);
      expect((await t.table(floorId, "7")).status()).toBe(200);

      const dup = await t.table(floorId, "7");
      expect(dup.status()).toBe(409);
      const { error } = await dup.json();
      // The point of the fix: a manager can read this and know exactly what to change.
      expect(error).toContain("7");
      expect(error).toMatch(/already has a table/i);
      expect(error, "the old behaviour was a bare Internal error").not.toMatch(/internal error/i);
    } finally {
      await t.cleanup();
    }
  });

  test("a table cannot be filed under another branch's floor", async ({ request, browser, baseURL }) => {
    // floorId comes from the client while branchId comes from the session; nothing used to check
    // the two belonged together, so a table could land on a floor plan its own branch never shows.
    const t = tracker(request);
    try {
      const floorId = await t.floor(`E2E Foreign ${Date.now()}`);

      const other = await browser.newContext({ baseURL, storageState: authFile("manager") });
      try {
        const mine = await other.request.get("/api/tables");
        const managerFloors = (await mine.json()).floors as { id: string }[];
        // Only meaningful when the manager is scoped to a different branch than the owner's default.
        test.skip(managerFloors.some((f) => f.id === floorId), "manager shares the owner's branch here");

        const res = await other.request.post("/api/tables", {
          data: { floorId, label: `X${Date.now()}`, seats: 4 },
        });
        expect([403, 404]).toContain(res.status());
      } finally {
        await other.close();
      }
    } finally {
      await t.cleanup();
    }
  });
});
