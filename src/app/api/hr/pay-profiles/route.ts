import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { listStaffPayProfiles, setPayProfile } from "@/server/hr";
import { resolveReportBranchIds, assertWritableMembership } from "@/server/reports";

export const GET = defineHandler({ permission: "hr.employee.manage" }, async ({ session }) => {
  const branchIds = await resolveReportBranchIds(session);
  const profiles = await listStaffPayProfiles(session.tenantId, branchIds);
  return { profiles };
});

const bodySchema = z.object({
  membershipId: z.string().min(1),
  payType: z.enum(["HOURLY", "MONTHLY"]),
  hourlyRatePaisa: z.number().int().positive().optional(),
  monthlySalaryPaisa: z.number().int().positive().optional(),
});

export const PATCH = defineHandler({ permission: "hr.employee.manage", input: bodySchema }, async ({ session, input }) => {
  // Changing someone's salary is a write at their branch, so it needs the same check.
  const target = await assertWritableMembership(session, input.membershipId);
  const membership = await setPayProfile(session.tenantId, target.membershipId, input);
  return { membership };
});
