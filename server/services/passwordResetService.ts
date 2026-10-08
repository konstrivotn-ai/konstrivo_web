import crypto from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { sha256Hex, hashPassword } from '../utils/crypto';
import { passwordResetRepository } from '../repositories/passwordResetRepository';
import { userRepository } from '../repositories/userRepository';
import { getDatabase } from '../db/client';

function base64url(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export class PasswordResetService {
  // Generate secure token and store only its SHA-256 hash.
  async requestPasswordReset(email: string, opts?: { returnRawTokenToCaller?: boolean }) {
    const normalized = (email || '').toLowerCase().trim();
    const user = await userRepository.findByEmail(normalized);

    if (!user) {
      // Generate token regardless of user existence to avoid enumeration timing differences.
      const raw = crypto.randomBytes(32);
      const rawToken = base64url(raw);
      if (opts?.returnRawTokenToCaller) return { ok: true, token: rawToken };
      return { ok: true };
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const raw = crypto.randomBytes(32);
      const rawToken = base64url(raw);
      const tokenHash = sha256Hex(rawToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

      const existing = await passwordResetRepository.findByTokenHash(tokenHash);
      if (existing) continue;

      await passwordResetRepository.create({ userId: user.id, tokenHash, expiresAt });

      // Don't reveal existence of user; return generic success. Server-side callers
      // may request the raw token for internal use (email building) via the
      // `returnRawTokenToCaller` option. This option must be provided by server
      // code only and is not controllable by HTTP clients.
      if (opts?.returnRawTokenToCaller) return { ok: true, token: rawToken };
      return { ok: true };
    }

    throw new Error('PASSWORD_RESET_TOKEN_GENERATION_FAILED');
  }

  async verifyResetToken(rawToken: string) {
    const tokenHash = sha256Hex(rawToken);
    const rec = await passwordResetRepository.findByTokenHash(tokenHash);
    if (!rec) return { valid: false };
    if (rec.usedAt) return { valid: false };
    if (new Date(rec.expiresAt).getTime() <= Date.now()) return { valid: false };
    const user = await userRepository.findById(rec.userId);
    if (!user) return { valid: false };
    return { valid: true, user, tokenId: rec.id };
  }

  async resetPassword(rawToken: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) throw new Error('PASSWORD_TOO_SHORT');
    const tokenHash = sha256Hex(rawToken);

    // Prefer transactional DB path when available
    const db = await getDatabase();
    if (db) {
      const { password_reset_tokens, users } = await import('../db/schema');
      // Use callback-style transaction to ensure compatibility with Drizzle transaction API.
      try {
        await db.transaction(async (tx: any) => {
          // Find token row
          const rows = await tx.select().from(password_reset_tokens).where(eq(password_reset_tokens.tokenHash, tokenHash)).limit(1);
          if (!rows || !rows[0]) {
            const e: any = new Error('INVALID_OR_EXPIRED_RESET_TOKEN'); e.code = 'INVALID_OR_EXPIRED_RESET_TOKEN'; throw e;
          }
          const r = rows[0];
          if (r.usedAt || r.used_at) { const e: any = new Error('INVALID_OR_EXPIRED_RESET_TOKEN'); e.code = 'INVALID_OR_EXPIRED_RESET_TOKEN'; throw e; }
          const expires = r.expiresAt || r.expires_at;
          if (new Date(expires).getTime() <= Date.now()) { const e: any = new Error('INVALID_OR_EXPIRED_RESET_TOKEN'); e.code = 'INVALID_OR_EXPIRED_RESET_TOKEN'; throw e; }

          // Update user's password and mark token used atomically
          const newHash = hashPassword(newPassword);
          const [updatedUser] = await tx.update(users).set({ passwordHash: newHash }).where(eq(users.id, r.userId || r.user_id)).returning();
          if (!updatedUser) throw new Error('User update failed');

          // Mark token used only if not already used
          const res = await tx.update(password_reset_tokens).set({ usedAt: new Date() }).where(and(
            eq(password_reset_tokens.id, r.id || r.id),
            isNull(password_reset_tokens.usedAt)
          )).returning();
          if (!res || res.length === 0) { const e: any = new Error('INVALID_OR_EXPIRED_RESET_TOKEN'); e.code = 'INVALID_OR_EXPIRED_RESET_TOKEN'; throw e; }
        });

        return { ok: true };
      } catch (err) {
        throw err;
      }
    }

    // Memory-mode path
    const rec = await passwordResetRepository.findByTokenHash(tokenHash);
    if (!rec) throw Object.assign(new Error('INVALID_OR_EXPIRED_RESET_TOKEN'), { code: 'INVALID_OR_EXPIRED_RESET_TOKEN' });
    if (rec.usedAt) throw Object.assign(new Error('INVALID_OR_EXPIRED_RESET_TOKEN'), { code: 'INVALID_OR_EXPIRED_RESET_TOKEN' });
    if (new Date(rec.expiresAt).getTime() <= Date.now()) throw Object.assign(new Error('INVALID_OR_EXPIRED_RESET_TOKEN'), { code: 'INVALID_OR_EXPIRED_RESET_TOKEN' });

    const user = await userRepository.findById(rec.userId);
    if (!user) throw Object.assign(new Error('INVALID_OR_EXPIRED_RESET_TOKEN'), { code: 'INVALID_OR_EXPIRED_RESET_TOKEN' });

    const newHash = hashPassword(newPassword);
    await userRepository.update(user.id, { passwordHash: newHash });
    await passwordResetRepository.markUsed(rec.id);
    return { ok: true };
  }
}

export const passwordResetService = new PasswordResetService();
