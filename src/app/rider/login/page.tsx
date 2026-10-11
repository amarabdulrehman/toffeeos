import { otpDeliveryAvailable } from "@/server/auth/otp-store";
import { RiderLoginForm } from "@/components/auth/rider-login-form";

export default function RiderLoginPage() {
  return <RiderLoginForm otpAvailable={otpDeliveryAvailable()} />;
}
