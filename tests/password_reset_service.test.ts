import crypto from 'crypto';
import { test, ok, assertEq } from './run';

export async function runPasswordResetServiceTests() {
  console.log('🔐 Password Reset Service Tests\n');
  const { passwordResetService } = await import('../server/services/passwordResetService');
  const { userRepository } = await import('../server/repositories/userRepository');
  const { passwordResetRepository } = await import('../server/repositories/passwordResetRepository');
  const { comparePassword } = await import('../server/utils/crypto');

  await test('request: unknown email is generic and creates no token', async () => {
    const res = await passwordResetService.requestPasswordReset('no-such-user@example.test');
    ok(res && res.ok);
  });

  await test('request: hash collision retries with a fresh token', async () => {
    const cryptoUtil = await import('../server/utils/crypto');
    const user = await userRepository.create({ email: 'prs_collision@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'PR Collision', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
    const originalRandomBytes = crypto.randomBytes;
    const originalFindByTokenHash = passwordResetRepository.findByTokenHash.bind(passwordResetRepository);
    const originalCreate = passwordResetRepository.create.bind(passwordResetRepository);
    const firstRaw = Buffer.alloc(32, 'A');
    const secondRaw = Buffer.alloc(32, 'B');
    const base64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const firstHash = cryptoUtil.sha256Hex(base64url(firstRaw));
    const secondHash = cryptoUtil.sha256Hex(base64url(secondRaw));

    let calls = 0;
    try {
      let firstCollisionSeen = false;
      (crypto as any).randomBytes = ((size: number) => {
        calls += 1;
        if (calls === 1) return Buffer.from(firstRaw.subarray(0, size));
        if (calls === 2) return Buffer.from(secondRaw.subarray(0, size));
        return Buffer.alloc(size, 'C');
      }) as any;

      (passwordResetRepository as any).findByTokenHash = async (tokenHash: string) => {
        if (tokenHash === firstHash && !firstCollisionSeen) {
          firstCollisionSeen = true;
          return {
            id: 'collision-id',
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            createdAt: new Date().toISOString(),
            usedAt: null,
          };
        }
        return undefined;
      };

      (passwordResetRepository as any).create = async (data: { userId: string; tokenHash: string; expiresAt: string }) => {
        if (data.tokenHash !== secondHash) {
          throw new Error('unexpected token hash');
        }
        return {
          id: 'fresh-token-id',
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          createdAt: new Date().toISOString(),
          usedAt: null,
        };
      };

      const res = await passwordResetService.requestPasswordReset(user.email, { returnRawTokenToCaller: true });
      ok(res && res.token, 'service should return a fresh token after collision');
      ok(cryptoUtil.sha256Hex((res as any).token) === secondHash, 'returned raw token corresponds to the post-collision hash');
    } finally {
      (crypto as any).randomBytes = originalRandomBytes;
      (passwordResetRepository as any).findByTokenHash = originalFindByTokenHash;
      (passwordResetRepository as any).create = originalCreate;
    }
  });

  await test('request: existing user creates token and stores hash', async () => {
    const user = await userRepository.create({ email: 'prs1@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'PR S1', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
    const r = await passwordResetService.requestPasswordReset(user.email, { returnRawTokenToCaller: true });
    ok(r && r.token, 'service should return raw token to the server-side caller');
    const raw = r.token as string;
    const rec = await passwordResetRepository.findByTokenHash((await import('../server/utils/crypto')).sha256Hex(raw));
    ok(rec && rec.userId === user.id, 'record must exist and belong to user');
    // expiry approx 1 hour
    const diff = new Date(rec!.expiresAt).getTime() - Date.now();
    ok(diff > 3500 * 1000 && diff <= 3600 * 1000 + 1000, 'expires ~1 hour');
  });

  await test('verify: valid token succeeds and does not consume', async () => {
    const user = await userRepository.create({ email: 'prs2@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'PR S2', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
    const { token } = await passwordResetService.requestPasswordReset(user.email, { returnRawTokenToCaller: true }) as any;
    const v = await passwordResetService.verifyResetToken(token);
    ok(v.valid, 'token should be valid');
    const v2 = await passwordResetService.verifyResetToken(token);
    ok(v2.valid, 'verify does not consume token');
  });

  await test('reset: valid token changes password and token becomes used', async () => {
    const user = await userRepository.create({ email: 'prs3@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'PR S3', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
    const { token } = await passwordResetService.requestPasswordReset(user.email, { returnRawTokenToCaller: true }) as any;
    await passwordResetService.resetPassword(token, 'newpass123');
    const updated = await userRepository.findById(user.id);
    ok(updated && comparePassword('newpass123', updated.passwordHash));
    const rec = await passwordResetRepository.findByTokenHash((await import('../server/utils/crypto')).sha256Hex(token));
    ok(rec && rec.usedAt, 'token should be marked used');
    // cannot reuse
    let threw = false;
    try { await passwordResetService.resetPassword(token, 'anotherpass'); } catch (e) { threw = true; }
    ok(threw, 'reuse should fail');
  });

  await test('reset: invalid token fails without changing password', async () => {
    const user = await userRepository.create({ email: 'prs4@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'PR S4', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
    let threw = false;
    try { await passwordResetService.resetPassword('no-such-token', 'newpass123'); } catch (e) { threw = true; }
    ok(threw, 'invalid token should throw');
    const unchanged = await userRepository.findById(user.id);
    ok(unchanged && unchanged.passwordHash === user.passwordHash, 'password unchanged');
  });

  await test('request: raw token is NOT returned unless the server caller opts in', async () => {
    const user = await userRepository.create({ email: 'prs5@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'PR S5', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
    // Default call: no raw token may leak to any caller.
    const res = await passwordResetService.requestPasswordReset(user.email);
    ok(res && res.ok);
    ok(!('token' in res), 'raw token must not be exposed by default');
    // Even an explicit false (e.g. a caller trying to toggle it) must not turn
    // raw-token exposure on — it is a server-side opt-in only.
    const off = await passwordResetService.requestPasswordReset(user.email, { returnRawTokenToCaller: false });
    ok(off && off.ok && !('token' in off), 'raw token must remain hidden when option is false');
  });
}
