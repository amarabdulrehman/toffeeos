import "server-only";
import { tenantDb } from "@/server/db";
import { HttpError } from "@/server/handler";

/**
 * Loyalty is a "signal," not a points engine (per the Phase 3 brief): total orders, total spend,
 * and last-order-date are all computed live from PAID orders rather than stored on Customer, so
 * they can never drift out of sync the way a maintained counter could. Same pattern as the Recipe
 * Cost report's "current ingredient cost" — recompute from source, don't cache.
 */

const PHONE_RE = /^[0-9+][0-9+\-\s]{5,19}$/;

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (!PHONE_RE.test(trimmed)) throw new HttpError(400, "That doesn't look like a valid phone number.");
  return trimmed;
}

export async function findOrCreateCustomer(tenantId: string, phone: string, name?: string) {
  const normalized = normalizePhone(phone);
  const db = tenantDb(tenantId);
  const existing = await db.customer.findUnique({ where: { tenantId_phone: { tenantId, phone: normalized } } });
  if (existing) return existing;
  return db.customer.create({ data: { tenantId, phone: normalized, name: name?.trim() || null } });
}

interface CustomerAggregate {
  totalOrders: number;
  totalSpendPaisa: number;
  lastOrderAt: Date | null;
}

async function aggregatesFor(tenantId: string, customerIds: string[]): Promise<Map<string, CustomerAggregate>> {
  const db = tenantDb(tenantId);
  const orders = await db.order.findMany({
    where: { customerId: { in: customerIds }, status: "PAID" },
    select: { customerId: true, totalPaisa: true, paidAt: true },
  });
  const byCustomer = new Map<string, CustomerAggregate>();
  for (const o of orders) {
    if (!o.customerId) continue;
    const agg = byCustomer.get(o.customerId) ?? { totalOrders: 0, totalSpendPaisa: 0, lastOrderAt: null };
    agg.totalOrders += 1;
    agg.totalSpendPaisa += o.totalPaisa;
    if (o.paidAt && (!agg.lastOrderAt || o.paidAt > agg.lastOrderAt)) agg.lastOrderAt = o.paidAt;
    byCustomer.set(o.customerId, agg);
  }
  return byCustomer;
}

export async function listCustomers(tenantId: string, query?: string) {
  const db = tenantDb(tenantId);
  const q = query?.trim();
  const customers = await db.customer.findMany({
    where: q ? { OR: [{ phone: { contains: q } }, { name: { contains: q, mode: "insensitive" } }] } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const aggregates = await aggregatesFor(tenantId, customers.map((c) => c.id));
  return customers.map((c) => ({
    ...c,
    ...(aggregates.get(c.id) ?? { totalOrders: 0, totalSpendPaisa: 0, lastOrderAt: null }),
  }));
}

export async function getCustomerDetail(tenantId: string, customerId: string) {
  const db = tenantDb(tenantId);
  const customer = await db.customer.findUnique({ where: { id: customerId }, include: { addresses: true } });
  if (!customer) throw new HttpError(404, "Customer not found.");

  const orders = await db.order.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      orderNumber: true,
      type: true,
      status: true,
      totalPaisa: true,
      createdAt: true,
      paidAt: true,
      branch: { select: { name: true } },
    },
  });

  const aggregates = (await aggregatesFor(tenantId, [customerId])).get(customerId) ?? {
    totalOrders: 0,
    totalSpendPaisa: 0,
    lastOrderAt: null,
  };

  return { customer, orders, ...aggregates };
}

/** The underlying query Phase 4's WhatsApp "come back" send will reuse — needed now even though
 * nothing sends yet, per the Phase 3 brief. */
export async function inactiveCustomers(tenantId: string, inactiveDays: number) {
  const db = tenantDb(tenantId);
  const cutoff = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);

  const customers = await db.customer.findMany({ select: { id: true, name: true, phone: true } });
  const aggregates = await aggregatesFor(tenantId, customers.map((c) => c.id));

  return customers
    .map((c) => ({ ...c, ...(aggregates.get(c.id) ?? { totalOrders: 0, totalSpendPaisa: 0, lastOrderAt: null }) }))
    .filter((c) => c.totalOrders > 0 && c.lastOrderAt !== null && c.lastOrderAt < cutoff)
    .sort((a, b) => (a.lastOrderAt as Date).getTime() - (b.lastOrderAt as Date).getTime());
}
