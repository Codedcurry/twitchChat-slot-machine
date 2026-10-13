import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SpinDisplay, nameView, machineVisible, HIDE_AFTER_MS } from '../src/display.js';

function setup(t) {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const changes = [];
  const display = new SpinDisplay({ onChange: (s) => changes.push(s) });
  return { display, changes, view: () => nameView(display.state) };
}

test('the name hides 7 seconds after a spin finishes', () => {
  assert.equal(HIDE_AFTER_MS, 7000);
});

test('nothing is shown before any spin', (t) => {
  const { view } = setup(t);
  assert.equal(view().visible, false);
  assert.equal(view().text, '');
});

test('the chatter name shows while the reels spin, without a check mark', (t) => {
  const { display, view } = setup(t);
  display.start('alice');
  assert.equal(view().visible, true);
  assert.equal(view().text, 'alice');
  assert.ok(!view().className.split(' ').includes('done'));
});

test('a finished spin adds a check mark and the green "done" style', (t) => {
  const { display, view } = setup(t);
  display.start('alice');
  display.finish('VIP');
  assert.equal(view().visible, true);
  assert.equal(view().text, 'alice ✓');
  assert.ok(view().className.split(' ').includes('done'));
  assert.equal(display.state.reward, 'VIP');
});

test('the name disappears exactly 7 seconds after the spin finishes', (t) => {
  const { display, view } = setup(t);
  display.start('alice');
  mock.timers.tick(4000);
  display.finish('VIP');
  mock.timers.tick(6999);
  assert.equal(view().visible, true);
  mock.timers.tick(1);
  assert.equal(view().visible, false);
});

test('the name never hides by itself while still spinning', (t) => {
  const { display, view } = setup(t);
  display.start('alice');
  mock.timers.tick(60000);
  assert.equal(view().text, 'alice');
});

test('a new spin during the 7 seconds is not hidden early', (t) => {
  const { display, view } = setup(t);
  display.start('alice');
  display.finish('VIP');
  mock.timers.tick(5000);
  display.start('bob');
  mock.timers.tick(3000);
  assert.equal(view().text, 'bob');
  display.finish('Hydrate');
  mock.timers.tick(6999);
  assert.equal(view().text, 'bob ✓');
  mock.timers.tick(1);
  assert.equal(view().visible, false);
});

test('finish without a running spin does nothing', (t) => {
  const { display, changes, view } = setup(t);
  display.finish('VIP');
  assert.equal(view().visible, false);
  assert.equal(changes.length, 0);
});

test('every change is reported so the overlay can redraw', (t) => {
  const { display, changes } = setup(t);
  display.start('alice');
  display.finish('VIP');
  mock.timers.tick(HIDE_AFTER_MS);
  assert.deepEqual(changes.map((s) => s.phase), ['spinning', 'done', 'hidden']);
});

test('the slot machine is off screen until a spin starts', (t) => {
  const { display } = setup(t);
  assert.equal(machineVisible(display.state), false);
});

test('the slot machine shows while spinning and while the result is shown', (t) => {
  const { display } = setup(t);
  display.start('alice');
  assert.equal(machineVisible(display.state), true);
  display.finish('VIP');
  mock.timers.tick(HIDE_AFTER_MS - 1);
  assert.equal(machineVisible(display.state), true);
});

test('the slot machine leaves together with the name', (t) => {
  const { display } = setup(t);
  display.start('alice');
  display.finish('VIP');
  mock.timers.tick(HIDE_AFTER_MS);
  assert.equal(machineVisible(display.state), false);
});

test('back to back spins keep the slot machine on screen without flickering', (t) => {
  const { display, changes } = setup(t);
  display.start('alice');
  display.finish('VIP');
  mock.timers.tick(3000);
  display.start('bob');
  display.finish('Hydrate');
  mock.timers.tick(3000);
  assert.ok(changes.every((s) => machineVisible(s)), 'it never left between the two spins');
  mock.timers.tick(HIDE_AFTER_MS);
  assert.equal(machineVisible(display.state), false);
});
