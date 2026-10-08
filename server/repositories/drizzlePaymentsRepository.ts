/**
 * Phase E — Drizzle Payments Repository
 *
 * Thin PostgreSQL backend for the `payments` table.
 * - Mirrors the conventions of drizzleSubscriptionsRepository.ts (getDatabase,
 *   optimistic version check, row mapping with normalisation).
 * - updatePaymentStatus enforces the transaction state machine at the DB layer:
 *   terminal statuses (succeeded/refunded/reversed) can never move again, so no
 *   downgrade can ever reach the database even if a caller races.
 *
 * No Flouci logic lives here — this layer only persists provider-agnostic rows.
 */
import { getDatabase } from '../db/client';
import { payments } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import type { Payment, PaymentStatus, PaymentType } from '../types';

/** Input used to create a payment row. `amount` is in TND units (numeric 12,2). */
export interface CreatePaymentInput {
  companyId: string;
  provider: string;
  providerPaymentId?: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentType: PaymentType;
  subscriptionId?: string | null;
  invoiceNumber?: string | null;
  metadata?: unknown;
  retryCount?: number;
  lastError?: string | null;
}

/** Optional patch carried by a status transition. */
export interface PaymentTransitionPatch {
  lastError?: string;
  subscriptionId?: string | null;
  providerPaymentId?: string | null;
  invoiceNumber?: string | null;
  metadata?: unknown;
  retryCount?: number;
  expectedVersion?: number;
}

/** Terminal statuses — the DB layer refuses any further transition from these. */
export const TERMINAL_PAYMENT_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  'succeeded',
  'refunded',
  'reversed',
]);
function toPayment(row: any): Payment {
  return {
    id: row.id,
    companyId: row.companyId,
    provider: row.provider,
    providerPaymentId: row.providerPaymentId ?? '',
    amount: Number(row.amount ?? 0),
    currency: row.currency ?? 'TND',
    status: row.status as PaymentStatus,
    paymentType: row.paymentType as PaymentType,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    version: row.version ?? 1,
    subscriptionId: row.subscriptionId ?? undefined,
    invoiceNumber: row.invoiceNumber ?? undefined,
    metadata: row.metadata ?? undefined,
    retryCount: row.retryCount ?? 0,
    lastError: row.lastError ?? undefined,
  };
}

export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');

  const [inserted] = await db
    .insert(payments)
    .values({
      companyId: input.companyId,
      provider: input.provider,
      providerPaymentId: input.providerPaymentId ?? undefined,
      amount: String(input.amount),
      currency: input.currency,
      status: input.status,
      paymentType: input.paymentType,
      subscriptionId: input.subscriptionId ?? undefined,
      invoiceNumber: input.invoiceNumber ?? undefined,
      metadata: input.metadata ?? [],
      retryCount: input.retryCount ?? 0,
      lastError: input.lastError ?? undefined,
    })
    .returning();

  return toPayment(inserted);
}

export async function findPaymentById(id: string): Promise<Payment | undefined> {
  const db = await getDatabase();
  if (!db) return undefined;
  const rows = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  if (!rows || rows.length === 0) return undefined;
  return toPayment(rows[0]);
}
/** Idempotency lookup keyed by the provider-assigned transaction id. */
export async function findPaymentByProviderPaymentId(
  provider: string,
  providerPaymentId: string,
): Promise<Payment | undefined> {
  const db = await getDatabase();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.provider, provider), eq(payments.providerPaymentId, providerPaymentId)))
    .limit(1);
  if (!rows || rows.length === 0) return undefined;
  return toPayment(rows[0]);
}

/** Optional lookup by our own invoice/reference number. */
export async function findPaymentByInvoiceNumber(
  provider: string,
  invoiceNumber: string,
): Promise<Payment | undefined> {
  const db = await getDatabase();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.provider, provider), eq(payments.invoiceNumber, invoiceNumber)))
    .limit(1);
  if (!rows || rows.length === 0) return undefined;
  return toPayment(rows[0]);
}

/**
 * Transition a payment to a new status.
 *
 * SAFETY: if the current status is terminal (succeeded/refunded/reversed) the
 * update is a NO-OP regardless of the requested target — the terminal state is
 * immutable and can never be downgraded. Optimistic version check → 409-style
 * error on stale writes (mirrors updateSubscription).
 */
export async function updatePaymentStatus(
  id: string,
  status: PaymentStatus,
  patch: PaymentTransitionPatch = {},
): Promise<Payment> {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');

  const existing = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  if (!existing || existing.length === 0) throw new Error('Payment not found');

  const current = existing[0];
  const expectedVersion =
    patch.expectedVersion !== undefined
      ? Number(patch.expectedVersion)
      : Number(current.version ?? 1);

  if (expectedVersion !== Number(current.version ?? 1)) {
    const err: any = new Error(
      `Version conflict: expected ${expectedVersion}, server has ${current.version}`,
    );
    err.statusCode = 409;
    err.code = 'CONFLICT';
    throw err;
  }

  // Immutable terminal state: never allow a downgrade to reach the database.
  if (TERMINAL_PAYMENT_STATUSES.has(current.status as PaymentStatus)) {
    return toPayment(current);
  }

  const [updated] = await db
    .update(payments)
    .set({
      status,
      lastError: patch.lastError ?? current.lastError ?? undefined,
      subscriptionId:
        patch.subscriptionId !== undefined ? patch.subscriptionId : current.subscriptionId,
      providerPaymentId:
        patch.providerPaymentId !== undefined ? patch.providerPaymentId : current.providerPaymentId,
      invoiceNumber:
        patch.invoiceNumber !== undefined ? patch.invoiceNumber : current.invoiceNumber,
      metadata: patch.metadata !== undefined ? patch.metadata : current.metadata,
      retryCount: patch.retryCount !== undefined ? patch.retryCount : current.retryCount,
      updatedAt: new Date(),
      version: (current.version || 1) + 1,
    })
    .where(eq(payments.id, id))
    .returning();

  return toPayment(updated);
}

/** List payments for a company (oldest first) — convenience for future routes. */
export async function listPaymentsByCompany(
  companyId: string,
  limit = 50,
): Promise<Payment[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.companyId, companyId))
    .orderBy(payments.createdAt)
    .limit(limit);
  return (rows ?? []).map(toPayment);
}