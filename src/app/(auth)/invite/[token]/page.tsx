import { AcceptInviteView } from "@/components/auth/accept-invite-view";

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptInviteView token={token} />;
}
