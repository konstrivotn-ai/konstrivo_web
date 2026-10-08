import { test, ok, assertEq } from './run';

export async function runPasswordResetRepositoryTests() {
  console.log('🔑 Password Reset Repository Tests\n');
  const { passwordResetRepository } = await import('../server/repositories/passwordResetRepository');
  const { userRepository } = await import('../server/repositories/userRepository');

  await test('create inserts record and fields are present', async () => {
    const user = await userRepository.create({
      email: 'pr_test1@test.tn',
      passwordHash: 'scrypt$1$1$1$abc$def',
      fullName: 'PR Test',
      phone: '',
      role: 'artisan',
      tier: 'FREE',
      status: 'active',
    });
    const rec = await passwordResetRepository.create({ userId: user.id, tokenHash: 'hash1', expiresAt: new Date(Date.now()+3600*1000).toISOString() });
    ok(rec.id, 'id should be set');
    assertEq(rec.userId, user.id);
    assertEq(rec.tokenHash, 'hash1');
    ok(rec.createdAt, 'createdAt set');
    ok(rec.usedAt === null || rec.usedAt === undefined);
  });

  await test('findByTokenHash returns record when exists', async () => {
    const rec = await passwordResetRepository.findByTokenHash('hash1');
    ok(!!rec, 'record must be found');
    assertEq(rec!.tokenHash, 'hash1');
  });

  await test('markUsed sets usedAt', async () => {
    const rec = await passwordResetRepository.findByTokenHash('hash1');
    ok(rec && rec.id);
    await passwordResetRepository.markUsed(rec!.id);
    const rec2 = await passwordResetRepository.findByTokenHash('hash1');
    ok(rec2 && rec2.usedAt, 'usedAt must be set');
  });

  await test('cleanupExpired removes expired records', async () => {
    const user = await userRepository.create({
      email: 'pr_test2@test.tn',
      passwordHash: 'scrypt$1$1$1$abc$def',
      fullName: 'PR Test 2',
      phone: '',
      role: 'artisan',
      tier: 'FREE',
      status: 'active',
    });
    const past = new Date(Date.now() - 3600*1000).toISOString();
    await passwordResetRepository.create({ userId: user.id, tokenHash: 'oldhash', expiresAt: past });
    const removed = await passwordResetRepository.cleanupExpired(new Date().toISOString());
    ok(removed >= 1, 'should remove at least one expired record');
  });

  await test('duplicate token_hash must fail', async () => {
    const user = await userRepository.create({
      email: 'pr_test3@test.tn',
      passwordHash: 'scrypt$1$1$1$abc$def',
      fullName: 'PR Test 3',
      phone: '',
      role: 'artisan',
      tier: 'FREE',
      status: 'active',
    });
    const tok = 'dupHash';
    await passwordResetRepository.create({ userId: user.id, tokenHash: tok, expiresAt: new Date(Date.now()+3600*1000).toISOString() });
    let threw = false;
    try {
      await passwordResetRepository.create({ userId: user.id, tokenHash: tok, expiresAt: new Date(Date.now()+3600*1000).toISOString() });
    } catch (err) {
      threw = true;
    }
    ok(threw, 'duplicate tokenHash should throw');
  });

  await test('findByTokenHash for unknown returns undefined', async () => {
    const res = await passwordResetRepository.findByTokenHash('no-such-hash');
    ok(res === undefined);
  });
}
