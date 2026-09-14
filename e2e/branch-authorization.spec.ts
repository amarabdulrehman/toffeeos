import { test, expect, request as playwrightRequest } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";

/**
 * Branch isolation on HR *writes*.
 *
 * The read paths always went through resolveReportBranchIds, which pins a Branch Manager to their
 * own branch. Three write paths did not: they took a branchId or membershipId straight from the
 * request body and trusted it, so a Branch Manager could record attendance, disburse payroll, or
 * change a salary at a branch that wasn't theirs. tenantDb() blocked cross-*tenant* forgery; this
 * is the cross-*branch* case inside one tenant, which nothing was checking.
 *
 * The demo tenant has two branches and the seeded manager belongs to the first, so "the other
 * branch" here is a real, active branch in their own tenant — exactly the case that used to slip
 * through. A made-up id would have been rejected anyway and would prove nothing.
 */

interface PayProfile {
  membershipId: string;
  userName: string;
  branchName: string;
  payType: string | null;
  hourlyRatePaisa: number | null;
  monthlySalaryPaisa: number | null;
}

/** The session is the authoritative answer for "which branch is this caller in" — the same value
 * the server pins them to — rather than inferring it from a list endpoint. */
async function sessionBranch(ctx: { get: (u: string) => Promise<{ json: () => Promise<unknown> }> }) {
  const s = (await (await ctx.get("/api/auth/session")).json()) as {
    user?: { branchId: string; branchName: string };
  };
  return s.user;
}

test.describe("Branch isolation on HR writes", () => {
  test.use({ storageState: authFile("manager") });

  test("a branch manager cannot record attendance at another branch", async ({ request, baseURL }) => {
    const me = await sessionBranch(request);
    expect(me?.branchId, "manager session should carry a branch").toBeTruthy();

    // Managers lack branch.manage, so the branch list comes from the owner.
    const owner = await playwrightRequest.newContext({ baseURL, storageState: authFile("owner") });
    const { branches } = (await (await owner.get("/api/branches")).json()) as {
      branches: { id: string; isActive: boolean }[];
    };
    await owner.dispose();
    const elsewhere = branches.find((b) => b.id !== me!.branchId && b.isActive);
    test.skip(!elsewhere, "demo tenant needs a second active branch for this test");

    const res = await request.post("/api/hr/attendance/manual", {
      data: {
        branchId: elsewhere!.id,
        userId: "00000000-0000-0000-0000-000000000000",
        clockInAt: new Date(Date.UTC(2026, 7, 1, 9)).toISOString(),
        note: "cross-branch probe",
      },
    });
    expect(res.status(), "attendance at another branch must be refused").toBe(403);
    expect(await res.text()).toMatch(/own branch/i);
  });

  test("a branch manager cannot change pay or disburse at another branch", async ({ request, baseURL }) => {
    const me = await sessionBranch(request);

    // The owner can see every branch's staff; find one who works somewhere else.
    const owner = await playwrightRequest.newContext({ baseURL, storageState: authFile("owner") });
    const all = (await (await owner.get("/api/hr/pay-profiles")).json()) as { profiles: PayProfile[] };
    let foreign = all.profiles.find((p) => p.branchName !== me!.branchName);

    // This used to `test.skip` when it found nobody. The seed creates the second branch and never
    // staffs it, so the condition was always true and this test — the one covering cross-branch
    // *payroll* writes — never ran a single assertion in any run. A guard that silently excuses
    // itself is worse than no guard: it reports green. So hire someone at the other branch instead.
    let hiredMembershipId: string | undefined;
    if (!foreign) {
      const { roles, branches } = (await (await owner.get("/api/staff")).json()) as {
        roles: { id: string; key: string }[];
        branches: { id: string; name: string }[];
      };
      const otherBranch = branches.find((b) => b.name !== me!.branchName);
      expect(otherBranch, "the demo tenant needs a second active branch for this test").toBeTruthy();
      const role = roles.find((r) => r.key === "waiter") ?? roles[0];

      const email = `e2e-crossbranch-${uniqueSuffix()}@example.com`;
      const invite = await owner.post("/api/staff/invites", {
        data: { email, roleId: role.id, branchId: otherBranch!.id },
      });
      expect(invite.ok(), await invite.text()).toBeTruthy();
      const { token } = await invite.json();

      const anon = await playwrightRequest.newContext({ baseURL });
      const accepted = await anon.post(`/api/invites/${token}/accept`, {
        data: { name: "E2E Cross Branch Staff", password: "CrossBranchPassw0rd!" },
      });
      expect(accepted.ok(), await accepted.text()).toBeTruthy();
      await anon.dispose();

      const after = (await (await owner.get("/api/hr/pay-profiles")).json()) as { profiles: PayProfile[] };
      foreign = after.profiles.find((p) => p.branchName !== me!.branchName);
      hiredMembershipId = foreign?.membershipId;
    }
    expect(foreign, "a staff member at another branch is the whole point of this test").toBeTruthy();

    const payProfile = await request.patch("/api/hr/pay-profiles", {
      data: { membershipId: foreign!.membershipId, payType: "MONTHLY", monthlySalaryPaisa: 100 },
    });
    expect(payProfile.status(), "changing another branch's salary must be refused").toBe(403);

    const disburse = await request.post("/api/hr/payroll/disburse", {
      data: {
        membershipId: foreign!.membershipId,
        branchId: me!.branchId, // even claiming their *own* branch must not launder the membership
        periodStart: new Date(Date.UTC(2026, 7, 1)).toISOString(),
        periodEnd: new Date(Date.UTC(2026, 7, 31)).toISOString(),
        regularHours: 1,
        grossPayPaisa: 100,
      },
    });
    expect(disburse.status(), "paying another branch's staff must be refused").toBe(403);

    // Deactivate rather than delete: the membership is what order and audit history points at, and
    // /api/staff/members has no DELETE for that reason.
    if (hiredMembershipId) {
      await owner.patch(`/api/staff/members/${hiredMembershipId}`, { data: { isActive: false } });
    }
    await owner.dispose();
  });

  test("a branch manager can still act on their own branch", async ({ request }) => {
    // The fix must refuse the foreign branch without breaking the ordinary case.
    const me = await sessionBranch(request);
    const mine = (await (await request.get("/api/hr/pay-profiles")).json()) as { profiles: PayProfile[] };
    const target = mine.profiles[0];
    test.skip(!target, "no staff at the manager's own branch");
    expect(target.branchName, "a manager must only ever see their own branch").toBe(me!.branchName);

    const res = await request.patch("/api/hr/pay-profiles", {
      data: {
        membershipId: target.membershipId,
        payType: target.payType === "HOURLY" ? "HOURLY" : "MONTHLY",
        ...(target.payType === "HOURLY"
          ? { hourlyRatePaisa: target.hourlyRatePaisa ?? 1000 }
          : { monthlySalaryPaisa: target.monthlySalaryPaisa ?? 3_000_000 }),
      },
    });
    expect(res.status(), "a manager must still be able to edit their own branch's pay").toBe(200);
  });
});

test.describe("Branch isolation — the owner is unaffected", () => {
  test.use({ storageState: authFile("owner") });

  test("an owner may still write across branches", async ({ request }) => {
    // Owners hold orders.viewAllBranches, which is what the new check keys off.
    const all = (await (await request.get("/api/hr/pay-profiles")).json()) as { profiles: PayProfile[] };
    const target = all.profiles[0];
    expect(target, "owner should see staff pay profiles").toBeTruthy();

    const res = await request.patch("/api/hr/pay-profiles", {
      data: {
        membershipId: target.membershipId,
        payType: target.payType === "HOURLY" ? "HOURLY" : "MONTHLY",
        ...(target.payType === "HOURLY"
          ? { hourlyRatePaisa: target.hourlyRatePaisa ?? 1000 }
          : { monthlySalaryPaisa: target.monthlySalaryPaisa ?? 3_000_000 }),
      },
    });
    expect(res.status(), "an owner must still be allowed to edit pay").toBe(200);
  });
});
