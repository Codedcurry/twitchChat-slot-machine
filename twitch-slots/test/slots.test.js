import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickReward, buildReels, spin, symbolPool, validateRewards } from '../src/slots.js';

const always = (value) => () => value;

const rewards = [
  { name: 'Hydrate', symbol: '🍒', weight: 3 },
  { name: 'VIP', symbol: '💎', weight: 1 },
];

test('rewards are picked by weight', () => {
  // Total weight is 4: rolls below 3/4 land on Hydrate, the rest on VIP.
  assert.equal(pickReward(rewards, always(0)).name, 'Hydrate');
  assert.equal(pickReward(rewards, always(0.74)).name, 'Hydrate');
  assert.equal(pickReward(rewards, always(0.75)).name, 'VIP');
  assert.equal(pickReward(rewards, always(0.9999)).name, 'VIP');
});

test('a reward with weight 0 is never picked', () => {
  const list = [
    { name: 'Off', symbol: '🚫', weight: 0 },
    { name: 'On', symbol: '✅', weight: 1 },
  ];
  for (const roll of [0, 0.5, 0.9999]) {
    assert.equal(pickReward(list, always(roll)).name, 'On');
  }
});

test('picks follow the weights over many spins', () => {
  let seed = 12345;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let hydrate = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) if (pickReward(rewards, rng).name === 'Hydrate') hydrate++;
  assert.ok(Math.abs(hydrate / n - 0.75) < 0.02, `Hydrate share was ${hydrate / n}`);
});

test('a winning reward shows three matching symbols', () => {
  assert.deepEqual(buildReels(rewards[1], ['🍒', '💎'], Math.random), ['💎', '💎', '💎']);
});

test('a reward without a symbol never shows three matching symbols', () => {
  const symbols = ['🍒', '💎', '🔔'];
  // A roll of 0 every time would pick the same symbol three times.
  const reels = buildReels({ name: 'Nothing' }, symbols, always(0));
  assert.equal(reels.length, 3);
  assert.ok(reels.every((s) => symbols.includes(s)));
  assert.ok(new Set(reels).size > 1, `reels were ${reels}`);

  for (const roll of [0.1, 0.5, 0.9999]) {
    const r = buildReels({ name: 'Nothing' }, symbols, always(roll));
    assert.ok(new Set(r).size > 1, `reels were ${r}`);
  }
});

test('spin returns the reward and matching reels', () => {
  const list = [...rewards, { name: 'Nothing', weight: 4 }];
  const win = spin(list, always(0));
  assert.deepEqual(win, { reward: 'Hydrate', win: true, reels: ['🍒', '🍒', '🍒'] });

  const lose = spin(list, always(0.99));
  assert.equal(lose.reward, 'Nothing');
  assert.equal(lose.win, false);
  assert.ok(new Set(lose.reels).size > 1);
});

test('the symbol pool lists each symbol once', () => {
  assert.deepEqual(
    symbolPool([...rewards, { name: 'Again', symbol: '🍒', weight: 1 }, { name: 'Nothing', weight: 1 }]),
    ['🍒', '💎'],
  );
});

test('bad reward settings are rejected with a clear message', () => {
  assert.throws(() => validateRewards([]), /at least one reward/);
  assert.throws(() => validateRewards('nope'), /at least one reward/);
  assert.throws(() => validateRewards([{ symbol: '🍒', weight: 1 }]), /name/);
  assert.throws(() => validateRewards([{ name: 'A', symbol: '🍒', weight: -1 }]), /weight/);
  assert.throws(() => validateRewards([{ name: 'A', symbol: '🍒', weight: '5' }]), /weight/);
  assert.throws(() => validateRewards([{ name: 'A', symbol: '🍒', weight: 0 }]), /above 0/);
  assert.throws(() => validateRewards([{ name: 'A', symbol: '', weight: 1 }]), /symbol/);
  assert.throws(
    () => validateRewards([{ name: 'A', symbol: '🍒', weight: 1 }, { name: 'Nothing', weight: 1 }]),
    /two symbols/,
  );
  assert.equal(validateRewards(rewards), rewards);
});
