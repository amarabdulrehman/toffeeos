import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { BRAND_NAME, COMPANY_NAME } from "@/config/brand";

export const metadata: Metadata = {
  title: `Terms of Service — ${BRAND_NAME}`,
  description: `The agreement between ${COMPANY_NAME} and restaurants using ${BRAND_NAME}.`,
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <LegalPage file="terms-of-service" title="Terms of Service" />;
}
