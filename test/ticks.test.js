import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubicBezier, tickTimes, REEL_EASING } from '../src/ticks.js';

test('the easing curve matches CSS cubic-bezier', () => {
  // CSS "ease" is cubic-bezier(.25,.1,.25,1); at half time it is ~80.24% done.
  const ease = cubicBezier(0.25, 0.1, 0.25, 1);
  assert.ok(Math.abs(ease(0.5) - 0.8024) < 0.001, `got ${ease(0.5)}`);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  const linear = cubicBezier(0, 0, 1, 1);
  assert.ok(Math.abs(linear(0.3) - 0.3) < 1e-6);
});

test('one tick for every symbol that crosses the centre line', () => {
  // 30 filler symbols scroll by before the landing symbol arrives.
  assert.equal(tickTimes({ durationMs: 5000, symbols: 30 }).length, 30);
  assert.equal(tickTimes({ durationMs: 5000, symbols: 12 }).length, 12);
});

test('a symbol ticks when its middle reaches the line', () => {
  // With linear movement over 3000ms and 30 symbols, symbol k is half way
  // across at (k - 0.5) * 100ms.
  const times = tickTimes({ durationMs: 3000, symbols: 30, easing: [0, 0, 1, 1] });
  times.forEach((t, i) => assert.ok(Math.abs(t - (i + 0.5) * 100) < 0.5, `tick ${i} at ${t}`));
});

test('ticks start fast and slow down as the reel stops', () => {
  const times = tickTimes({ durationMs: 5000, symbols: 30 });
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] >= gaps[i - 1] - 0.5, `gap ${i} shrank`);
  assert.ok(gaps[0] < 60, `first gap ${gaps[0]}ms is not fast`);
  assert.ok(gaps.at(-1) > 250, `last gap ${gaps.at(-1)}ms does not slow down`);
});

test('the last tick lands near the end without a long silent creep', () => {
  const times = tickTimes({ durationMs: 5000, symbols: 30 });
  assert.ok(times.every((t) => t > 0 && t < 5000));
  assert.ok(5000 - times.at(-1) < 1200, `${5000 - times.at(-1)}ms of silence before the stop`);
});

test('the reel easing is a valid CSS curve', () => {
  assert.equal(REEL_EASING.length, 4);
  assert.ok(REEL_EASING[0] >= 0 && REEL_EASING[0] <= 1 && REEL_EASING[2] >= 0 && REEL_EASING[2] <= 1);
});
