import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { SpinQueue } from '../src/queue.js';

const rewards = [
  { name: 'Hydrate', symbol: '🍒', weight: 1 },
  { name: 'Nothing', weight: 1 },
];

async function start(t, opts = {}) {
  let time = 1000;
  const clock = { now: () => time, advance: (ms) => (time += ms) };
  const app = createApp({
    queue: new SpinQueue(),
    rewards,
    spinDurationMs: 4000,
    now: clock.now,
    rng: () => 0,
    ...opts,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (path, body = {}, headers = { 'content-type': 'application/json' }) =>
    fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const state = async () => (await fetch(base + '/api/state')).json();
  return { app, base, clock, post, state };
}

test('the starting state is empty', async (t) => {
  const { state } = await start(t);
  assert.deepEqual(await state(), {
    count: 0,
    pending: [],
    spinning: false,
    spinDurationMs: 4000,
    history: [],
    twitch: 'not connected',
  });
});

test('a redeem is saved instead of spinning right away', async (t) => {
  const { post, state } = await start(t);
  const res = await post('/api/redeem', { user: 'alice' });
  assert.equal(res.status, 201);
  const s = await state();
  assert.equal(s.count, 1);
  assert.equal(s.pending[0].user, 'alice');
  assert.equal(s.history.length, 0);
  assert.equal(s.spinning, false);
});

test('a blank username is refused', async (t) => {
  const { post, state } = await start(t);
  assert.equal((await post('/api/redeem', { user: '  ' })).status, 400);
  assert.equal((await state()).count, 0);
});

test('spinning with nothing saved is refused', async (t) => {
  const { post } = await start(t);
  const res = await post('/api/spin');
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /no spins/i);
});

test('the streamer spins saved redeems one at a time, oldest first', async (t) => {
  const { post, state } = await start(t);
  await post('/api/redeem', { user: 'alice' });
  await post('/api/redeem', { user: 'bob' });

  const res = await post('/api/spin');
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.user, 'alice');
  assert.equal(result.reward, 'Hydrate');
  assert.deepEqual(result.reels, ['🍒', '🍒', '🍒']);
  assert.equal(result.durationMs, 4000);

  const s = await state();
  assert.equal(s.count, 1);
  assert.equal(s.pending[0].user, 'bob');
  assert.equal(s.history[0].user, 'alice');
  assert.equal(s.history[0].reward, 'Hydrate');
  assert.equal(s.spinning, true);
});

test('a second spin waits until the current one has finished', async (t) => {
  const { post, clock, state } = await start(t);
  await post('/api/redeem', { user: 'alice' });
  await post('/api/redeem', { user: 'bob' });
  await post('/api/spin');

  clock.advance(3999);
  const blocked = await post('/api/spin');
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /still/i);
  assert.equal((await state()).count, 1);

  clock.advance(1);
  const ok = await post('/api/spin');
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).user, 'bob');
});

test('history keeps the newest spin first and is capped', async (t) => {
  const { post, clock, state } = await start(t, { historySize: 3 });
  for (const user of ['a', 'b', 'c', 'd']) {
    await post('/api/redeem', { user });
    await post('/api/spin');
    clock.advance(4000);
  }
  assert.deepEqual((await state()).history.map((h) => h.user), ['d', 'c', 'b']);
});

test('a saved spin can be removed by the streamer', async (t) => {
  const { post, state } = await start(t);
  const entry = await (await post('/api/redeem', { user: 'alice' })).json();
  assert.equal((await post('/api/remove', { id: entry.id })).status, 200);
  assert.equal((await state()).count, 0);
  assert.equal((await post('/api/remove', { id: entry.id })).status, 404);
});

test('Twitch redeems added by the server show up in the queue', async (t) => {
  const { app, state } = await start(t);
  app.addRedeem('alice');
  assert.equal((await state()).pending[0].user, 'alice');
  app.setTwitchStatus('connected');
  assert.equal((await state()).twitch, 'connected');
});

test('spins are pushed live to the overlay', { timeout: 5000 }, async (t) => {
  const { base, post } = await start(t);
  const abort = new AbortController();
  t.after(() => abort.abort());
  const res = await fetch(base + '/events', { signal: abort.signal });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  await post('/api/redeem', { user: 'alice' });
  await post('/api/spin');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!/event: spin\ndata: .*\n\n/.test(text)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  const block = text.split('\n\n').find((b) => b.startsWith('event: spin'));
  const data = JSON.parse(block.split('\n').find((l) => l.startsWith('data: ')).slice(6));
  assert.equal(data.user, 'alice');
  assert.equal(data.reward, 'Hydrate');
  assert.ok(text.startsWith('event: state'), 'the first message is the current state');
});

test('POSTs must be JSON so other websites cannot trigger spins', async (t) => {
  const { post, state } = await start(t);
  const res = await post('/api/redeem', { user: 'alice' }, { 'content-type': 'text/plain' });
  assert.equal(res.status, 415);
  assert.equal((await state()).count, 0);
});

test('broken JSON is refused', async (t) => {
  const { base } = await start(t);
  const res = await fetch(base + '/api/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{nope',
  });
  assert.equal(res.status, 400);
});

test('the overlay, control panel and login pages are served', async (t) => {
  const { base } = await start(t);
  for (const path of ['/overlay', '/control', '/auth']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), /text\/html/, path);
  }
  const js = await fetch(base + '/display.js');
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.match(await js.text(), /SpinDisplay/);
  const ticks = await fetch(base + '/ticks.js');
  assert.match(ticks.headers.get('content-type'), /javascript/);
  assert.match(await ticks.text(), /tickTimes/);

  assert.equal((await fetch(base + '/nope')).status, 404);
  assert.equal((await fetch(base + '/../package.json')).status, 404);
  const root = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/control');
});

function soundsDir(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'sounds-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

test('custom tick and win sounds are served from the sounds folder', async (t) => {
  const { base } = await start(t, { soundsDir: soundsDir(t, { 'tick.mp3': 'fake mp3', 'win.wav': 'fake wav' }) });

  const tick = await fetch(base + '/sounds/tick');
  assert.equal(tick.status, 200);
  assert.equal(tick.headers.get('content-type'), 'audio/mpeg');
  assert.equal(await tick.text(), 'fake mp3');

  const win = await fetch(base + '/sounds/win');
  assert.equal(win.status, 200);
  assert.equal(win.headers.get('content-type'), 'audio/wav');
});

test('without custom sounds the overlay is told to use its built-in ones', async (t) => {
  const { base } = await start(t, { soundsDir: soundsDir(t, { 'notes.txt': 'hi' }) });
  assert.equal((await fetch(base + '/sounds/tick')).status, 404);
  assert.equal((await fetch(base + '/sounds/win')).status, 404);
  assert.equal((await fetch(base + '/sounds/notes')).status, 404);
  assert.equal((await fetch(base + '/sounds/../package')).status, 404);
});

test('the Twitch login link needs a client id', async (t) => {
  const { base } = await start(t);
  const res = await fetch(base + '/api/auth-url');
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /client id/i);
});

test('a Twitch login token is only accepted with the matching state', async (t) => {
  const tokens = [];
  const { base, post } = await start(t, {
    twitchClientId: 'client123',
    redirectUri: 'http://localhost:7878/auth',
    onToken: async (token) => tokens.push(token),
  });
  const { url } = await (await fetch(base + '/api/auth-url')).json();
  const state = new URL(url).searchParams.get('state');
  assert.ok(state && state.length >= 16);

  assert.equal((await post('/api/token', { token: 'tok', state: 'wrong' })).status, 403);
  assert.equal((await post('/api/token', { token: '', state })).status, 400);
  assert.deepEqual(tokens, []);

  assert.equal((await post('/api/token', { token: 'tok', state })).status, 200);
  assert.deepEqual(tokens, ['tok']);

  // A state can only be used once.
  assert.equal((await post('/api/token', { token: 'tok2', state })).status, 403);
});

test('a failing Twitch login reports the error', async (t) => {
  const { base, post } = await start(t, {
    twitchClientId: 'client123',
    redirectUri: 'http://localhost:7878/auth',
    onToken: async () => {
      throw new Error('token expired');
    },
  });
  const { url } = await (await fetch(base + '/api/auth-url')).json();
  const state = new URL(url).searchParams.get('state');
  const res = await post('/api/token', { token: 'tok', state });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /token expired/);
});
