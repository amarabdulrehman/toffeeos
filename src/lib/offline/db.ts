"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { MenuCategoryDto, OrderDto, OrderType, FloorDto, Discount } from "@/components/pos/types";

export type QueuedActionStatus = "pending" | "syncing" | "conflict" | "failed";

interface QueuedActionBase {
  actionId: string;
  orderId: string;
  createdAt: number;
  status: QueuedActionStatus;
  error?: string;
}

export interface CreateOrderPayload {
  id: string;
  type: OrderType;
  tableId?: string;
  customerId?: string;
  lines: {
    menuItemId: string;
    variantId?: string;
    modifierIds?: string[];
    quantity: number;
    notes?: string;
    discount?: Discount;
  }[];
  orderDiscount?: Discount;
  idempotencyKey: string;
}

export interface CreateOrderAction extends QueuedActionBase {
  type: "createOrder";
  payload: CreateOrderPayload;
  sendToKitchen: boolean;
  /** Local snapshot of the order this action will create, shown in the UI (queue panel) before
   * the server has ever confirmed it exists. */
  localOrder: OrderDto;
}

export interface PayOrderAction extends QueuedActionBase {
  type: "pay";
  payload: { tenders: { method: string; amountPaisa: number }[] };
  expectedVersion?: number;
}

export interface VoidOrderAction extends QueuedActionBase {
  type: "void";
  payload: { reason?: string };
  expectedVersion?: number;
}

export type QueuedAction = CreateOrderAction | PayOrderAction | VoidOrderAction;

interface OfflineDBSchema extends DBSchema {
  queue: {
    key: string;
    value: QueuedAction;
    indexes: { "by-createdAt": number; "by-orderId": string };
  };
  cache: {
    key: string;
    value: { key: string; data: unknown; cachedAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDBSchema>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDBSchema>("tableos-offline", 1, {
      upgrade(db) {
        const queue = db.createObjectStore("queue", { keyPath: "actionId" });
        queue.createIndex("by-createdAt", "createdAt");
        queue.createIndex("by-orderId", "orderId");
        db.createObjectStore("cache", { keyPath: "key" });
      },
    });
  }
  return dbPromise;
}

// ---- Write queue ----

export async function enqueueAction(action: QueuedAction) {
  const db = await getDb();
  await db.put("queue", action);
}

export async function updateAction(actionId: string, patch: Partial<QueuedAction>) {
  const db = await getDb();
  const existing = await db.get("queue", actionId);
  if (!existing) return;
  await db.put("queue", { ...existing, ...patch } as QueuedAction);
}

export async function removeAction(actionId: string) {
  const db = await getDb();
  await db.delete("queue", actionId);
}

export async function listQueue(): Promise<QueuedAction[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("queue", "by-createdAt");
  return all;
}

export async function listActionsForOrder(orderId: string): Promise<QueuedAction[]> {
  const db = await getDb();
  return db.getAllFromIndex("queue", "by-orderId", orderId);
}

export async function pendingCount(): Promise<number> {
  const all = await listQueue();
  return all.filter((a) => a.status === "pending" || a.status === "syncing").length;
}

export async function conflictCount(): Promise<number> {
  const all = await listQueue();
  return all.filter((a) => a.status === "conflict" || a.status === "failed").length;
}

// ---- Read-through cache: menu, tables, open orders ----
// Kept warm on every successful online fetch; read back only when offline or the live fetch fails.

async function cachePut(key: string, data: unknown) {
  const db = await getDb();
  await db.put("cache", { key, data, cachedAt: Date.now() });
}

async function cacheGet<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.get("cache", key);
  return (row?.data as T) ?? null;
}

export const cacheMenu = (categories: MenuCategoryDto[]) => cachePut("menu", categories);
export const getCachedMenu = () => cacheGet<MenuCategoryDto[]>("menu");

export const cacheTables = (floors: FloorDto[]) => cachePut("tables", floors);
export const getCachedTables = () => cacheGet<FloorDto[]>("tables");

export const cacheOpenOrders = (orders: OrderDto[]) => cachePut("openOrders", orders);
export const getCachedOpenOrders = () => cacheGet<OrderDto[]>("openOrders");
