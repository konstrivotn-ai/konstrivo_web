import { test, ok, assertEq } from './run';

export async function runDrizzleUserUpdateTests() {
  console.log('🧪 Drizzle User Update Tests (memory-mode)\n');
  const { userRepository } = await import('../server/repositories/userRepository');

  await test('userRepository.update updates fields', async () => {
    const u = await userRepository.create({ email: 'du1@test', passwordHash: 'scrypt$1$1$1$a$b', fullName: 'DU 1', phone: '', role: 'artisan', tier: 'FREE', status: 'active' });
    const updated = await userRepository.update(u.id, { fullName: 'DU 1b', phone: '123' } as any);
    assertEq(updated.fullName, 'DU 1b');
    assertEq(updated.phone, '123');
  });
}
