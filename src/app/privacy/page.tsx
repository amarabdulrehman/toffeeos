import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { BRAND_NAME, COMPANY_NAME } from "@/config/brand";

export const metadata: Metadata = {
  title: `Privacy Policy — ${BRAND_NAME}`,
  description: `How ${COMPANY_NAME} collects, uses and protects information through ${BRAND_NAME}.`,
};

export default function PrivacyPage() {
  return <LegalPage file="privacy-policy" title="Privacy Policy" />;
}
