import { test, expect, request as playwrightRequest } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/test-data";

test.use({ storageState: authFile("owner") });

test("staff invite -> public accept -> login carries the invited role and branch, not the inviter's", async ({
  request,
  baseURL,
}) => {
  const staffRes = await request.get("/api/staff");
  const { roles, branches } = await staffRes.json();
  const waiterRole = roles.find((r: { key: string }) => r.key === "waiter");
  expect(waiterRole).toBeTruthy();
  expect(branches.length).toBeGreaterThan(0);
  const targetBranch = branches[0];

  const email = `e2e-invite-${uniqueSuffix()}@example.com`;
  const inviteRes = await request.post("/api/staff/invites", {
    data: { email, roleId: waiterRole.id, branchId: targetBranch.id },
  });
  expect(inviteRes.ok(), await inviteRes.text()).toBeTruthy();
  const { token } = await inviteRes.json();

  // The invite lookup must work unauthenticated — a brand new hire has no session yet.
  const anon = await playwrightRequest.newContext({ baseURL });
  const lookupRes = await anon.get(`/api/invites/${token}`);
  expect(lookupRes.ok(), await lookupRes.text()).toBeTruthy();
  const invitePreview = await lookupRes.json();
  expect(invitePreview.email).toBe(email);
  expect(invitePreview.roleName).toMatch(/waiter/i);

  const password = "InvitedStaffPassw0rd!";
  const acceptRes = await anon.post(`/api/invites/${token}/accept`, {
    data: { name: "E2E Invited Waiter", password },
  });
  expect(acceptRes.ok(), await acceptRes.text()).toBeTruthy();
  await anon.dispose();

  const loginCtx = await playwrightRequest.newContext({ baseURL });
  const csrfRes = await loginCtx.get("/api/auth/csrf");
  const { csrfToken } = await csrfRes.json();
  await loginCtx.post("/api/auth/callback/credentials", {
    form: { tenantSlug: "karachi-karahi", email, password, csrfToken, json: "true" },
  });

  const sessionRes = await loginCtx.get("/api/auth/session");
  const session = await sessionRes.json();
  expect(session.user.email).toBe(email);
  expect(session.user.roleKey).toBe("waiter");
  expect(session.user.branchId).toBe(targetBranch.id);
  expect(session.user.permissions).toContain("pos.order.create");
  expect(session.user.permissions).not.toContain("staff.manage");

  await loginCtx.dispose();
});
