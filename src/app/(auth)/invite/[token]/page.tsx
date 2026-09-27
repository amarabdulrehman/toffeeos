import { AcceptInviteView } from "@/components/auth/accept-invite-view";
import type { Metadata } from "next";
import { BRAND_NAME } from "@/config/brand";

// An account page, not a marketing one: kept out of search results.
export const metadata: Metadata = {
  title: `Accept your invitation — ${BRAND_NAME}`,
  robots: { index: false, follow: false },
};

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptInviteView token={token} />;
}
