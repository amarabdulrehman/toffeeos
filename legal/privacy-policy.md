# Privacy Policy

**Last updated: 13 September 2026**

This Privacy Policy explains how **KRIMSOLS** ("ToffeeOS," "we," "us") collects, uses, and protects information through the ToffeeOS platform ("Service").

This policy covers two groups of people differently:
- **Tenants** — the restaurants/cafes and their staff who use ToffeeOS to run their business.
- **End Customers** — the people who order food from a restaurant using ToffeeOS (e.g. via online/QR ordering or WhatsApp), who are customers of the restaurant, not of us directly.

## 1. Information We Collect

**From Tenants (restaurant owners, managers, and staff):**
- Account information: name, email, phone number, password (stored as an irreversible hash, never in plain text), staff PIN (also hashed).
- Business information: restaurant name, branches, menu, pricing, tax settings.
- Operational data: orders, sales, inventory, table/delivery activity.
- HR/payroll data, where the HR module is used: staff names, roles, shift/attendance records, wages, and payslip data. This is sensitive data — see Section 5.
- Two-factor authentication data (for platform administrators): a TOTP secret and one-time backup codes, stored to secure account access.

**From End Customers (via online ordering or WhatsApp), collected on behalf of the Tenant:**
- Name and phone number provided when placing an order.
- Delivery address, if applicable.
- Order history and content of order-related WhatsApp messages (e.g. order confirmations, thank-you messages, delivery updates), only if the Tenant has enabled that feature.

We do not knowingly process payment card numbers, bank details, or other financial-instrument data through the Service — point-of-sale payment methods (e.g. cash, card, or other means) are configured and reconciled by the Tenant using their own arrangements, and we do not store card numbers.

## 2. How We Use Information

We use the information above to:
- Operate, maintain, and secure the Service (authentication, permissions, rate limiting, fraud/abuse prevention);
- Provide the features a Tenant enables (order processing, KDS, reporting, payroll calculations, WhatsApp notifications);
- Send operational communications (e.g. password reset emails, order-related WhatsApp messages a Tenant has configured);
- Monitor for errors and reliability issues (see Section 4 — Sentry);
- Comply with legal obligations.

We do not sell personal data. We do not use End Customer data for advertising.

## 3. Role: Who Controls What

For Tenant account data (the restaurant's own admin/staff accounts), we act as the data controller.

For End Customer data (people ordering food) and for HR/payroll data about a Tenant's staff, we act as a **data processor** on behalf of the Tenant, who is the controller and is responsible for having a lawful basis to collect and use that data (e.g. informing their customers, complying with local labor law for staff records). We process this data only as instructed by the Tenant, through their use of the Service.

## 4. Who We Share Data With

We share data with the following service providers ("sub-processors"), only as needed to run the Service:

| Provider | Purpose | Notes |
|---|---|---|
| Supabase | Database hosting (Postgres) and file storage (backups) | Data region: Singapore |
| Vercel | Application hosting | May process requests in multiple regions |
| Resend | Transactional email (password resets, notifications) | |
| Sentry | Error monitoring (crash/error diagnostics) | Configured to avoid capturing sensitive payloads where possible |
| Meta / WhatsApp Business Platform | Delivering WhatsApp messages, where a Tenant enables this feature | Only phone numbers and message content relevant to messages the Tenant chose to send |

We do not share data with third parties for their own marketing purposes. We may disclose information if required by law, court order, or to protect the rights, safety, or property of ToffeeOS, our Tenants, or others.

## 5. Sensitive Data — Payroll and HR

Where a Tenant uses the payroll/HR module, wage and personal staff data is stored to enable that Tenant's own payroll calculations and record-keeping. This data is isolated per-Tenant (see Section 7) and is not accessible to other Tenants. Tenants are responsible for ensuring their use of this module complies with applicable local labor and data-protection law.

## 6. International Data Transfers

Our infrastructure runs across providers with servers in different countries (e.g. Singapore for the database, and Vercel's hosting network). By using the Service, you acknowledge that data may be processed outside the country where you or your customers are located. We select providers with reasonable security practices, but we do not currently make specific contractual data-transfer representations (e.g. Standard Contractual Clauses) beyond what our providers offer by default — if this matters for your business (e.g. serving EU customers), contact us before relying on the Service for that purpose.

## 7. Data Isolation and Security

- Each Tenant's data is isolated using database-level row security in addition to application-level checks, so one restaurant cannot access another's data.
- Passwords and staff PINs are stored as one-way hashes, never in plain text.
- Login attempts are rate-limited to reduce brute-force risk.
- Platform administrator accounts support two-factor authentication (TOTP).
- Traffic to the Service is encrypted in transit (HTTPS).
- We take regular, encrypted backups of the database, retained for a limited period (currently 14 days), to allow recovery from accidental data loss or corruption. Backups are not a substitute for the Tenant maintaining their own records where required by law.

No system is 100% secure, and we cannot guarantee absolute security. We have not undergone an independent third-party security audit as of this policy's last update.

## 8. Data Retention

We retain Tenant and End Customer data for as long as the Tenant's account is active, plus a reasonable period after closure to allow data export and to meet backup-retention practices described above, after which it is deleted or anonymized, unless a longer period is required by law.

## 9. Your Rights

Depending on applicable law, individuals may have rights to access, correct, or request deletion of their personal data. 
- **Tenant staff/admins**: contact your restaurant's account owner, or us directly at the address below.
- **End Customers**: requests about your order or contact data should go to the restaurant you ordered from, who can relay the request to us, or you may contact us directly and we will coordinate with the relevant Tenant.

## 10. Children's Privacy

The Service is intended for use by business staff and adult customers. We do not knowingly collect personal data from children.

## 11. Cookies and Similar Technologies

We use essential session cookies to keep you logged in and to protect against cross-site request forgery. We do not currently use third-party advertising or tracking cookies.

## 12. Changes to This Policy

We may update this Privacy Policy from time to time. Material changes will be communicated via email or an in-app notice. The "Last updated" date at the top reflects the most recent revision.

## 13. Contact

For privacy questions or requests, contact us at **krimsolcompany@gmail.com**.
