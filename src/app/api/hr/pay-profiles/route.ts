import { z } from "zod";
import { defineHandler } from "@/server/handler";
import { listStaffPayProfiles, setPayProfile } from "@/server/hr";
import { resolveReportBranchIds } from "@/server/reports";

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
  const membership = await setPayProfile(session.tenantId, input.membershipId, input);
  return { membership };
});
