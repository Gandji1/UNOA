import assert from 'node:assert/strict';

const origin = process.env.UNOA_TEST_URL || 'http://localhost:3912';
const home = await fetch(new URL('/', origin));
assert.equal(home.status, 200);
assert.match(await home.text(), /Le campus numérique/);
for (const [endpoint, status] of [['live', 'alive'], ['ready', 'ready']]) {
  const response = await fetch(new URL('/api/v1/health/' + endpoint, origin));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { service: 'web', status });
}
console.log('Accueil et sondes HTTP vérifiés.');
