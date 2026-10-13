import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpinQueue } from '../src/queue.js';

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'spinq-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a new queue is empty', () => {
  const q = new SpinQueue();
  assert.equal(q.count, 0);
  assert.deepEqual(q.list(), []);
  assert.equal(q.next(), null);
});

test('saved spins come out in the order they were redeemed', () => {
  const q = new SpinQueue();
  q.add('alice');
  q.add('bob');
  q.add('carol');
  assert.equal(q.count, 3);
  assert.equal(q.next().user, 'alice');
  assert.equal(q.next().user, 'bob');
  assert.equal(q.count, 1);
  assert.equal(q.list()[0].user, 'carol');
});

test('the same chatter can have several spins saved', () => {
  const q = new SpinQueue();
  q.add('alice');
  q.add('alice');
  assert.equal(q.count, 2);
});

test('usernames are trimmed and blank ones are rejected', () => {
  const q = new SpinQueue();
  assert.equal(q.add('  alice ').user, 'alice');
  assert.throws(() => q.add('   '));
  assert.throws(() => q.add(''));
  assert.throws(() => q.add(undefined));
  assert.throws(() => q.add(42));
  assert.equal(q.count, 1);
});

test('each entry has a unique id and can be removed by it', () => {
  const q = new SpinQueue();
  const a = q.add('alice');
  const b = q.add('bob');
  assert.notEqual(a.id, b.id);
  assert.equal(q.remove(a.id), true);
  assert.deepEqual(q.list().map((e) => e.user), ['bob']);
  assert.equal(q.remove('no-such-id'), false);
  assert.equal(q.count, 1);
});

test('list returns a copy that cannot change the queue', () => {
  const q = new SpinQueue();
  q.add('alice');
  const list = q.list();
  list.pop();
  list.push({ id: 'x', user: 'mallory' });
  assert.deepEqual(q.list().map((e) => e.user), ['alice']);
});

test('saved spins survive a restart when a file is given', (t) => {
  const file = join(tempDir(t), 'nested', 'queue.json');
  const q1 = new SpinQueue({ file });
  q1.add('alice');
  const bob = q1.add('bob');
  q1.add('carol');
  q1.next();
  q1.remove(bob.id);

  const q2 = new SpinQueue({ file });
  assert.deepEqual(q2.list().map((e) => e.user), ['carol']);
  const dave = q2.add('dave');
  assert.notEqual(dave.id, q2.list()[0].id);
});

test('a missing or broken save file starts an empty queue', (t) => {
  const dir = tempDir(t);
  assert.equal(new SpinQueue({ file: join(dir, 'missing.json') }).count, 0);

  const broken = join(dir, 'broken.json');
  writeFileSync(broken, 'this is not json');
  assert.equal(new SpinQueue({ file: broken }).count, 0);

  const wrongShape = join(dir, 'wrong.json');
  writeFileSync(wrongShape, JSON.stringify([{ id: 'a', user: 'ok' }, { nope: true }, null]));
  assert.deepEqual(new SpinQueue({ file: wrongShape }).list().map((e) => e.user), ['ok']);
});
