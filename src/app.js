import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spin, symbolPool } from './slots.js';
import { authUrl } from './twitch.js';

const PROJECT_DIR = fileURLToPath(new URL('..', import.meta.url));
const MAX_BODY = 16 * 1024;

// Only these files are served, so no path in a URL can reach anything else.
const PAGES = {
  '/overlay': ['public/overlay.html', 'text/html; charset=utf-8'],
  '/control': ['public/control.html', 'text/html; charset=utf-8'],
  '/auth': ['public/auth.html', 'text/html; charset=utf-8'],
  '/display.js': ['src/display.js', 'text/javascript; charset=utf-8'],
  '/ticks.js': ['src/ticks.js', 'text/javascript; charset=utf-8'],
};

// Optional sound files the streamer can drop into the sounds folder.
const SOUND_NAMES = ['tick', 'win'];
const SOUND_TYPES = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav' };

export function createApp({
  queue,
  rewards,
  spinDurationMs = 5000,
  historySize = 50,
  now = Date.now,
  rng = Math.random,
  twitchClientId = '',
  redirectUri = '',
  onToken = async () => {},
  soundsDir = join(PROJECT_DIR, 'sounds'),
}) {
  const history = [];
  const clients = new Set();
  const authStates = new Set();
  let spinningUntil = 0;
  let twitch = 'not connected';
  let idleTimer = null;

  const state = () => ({
    count: queue.count,
    pending: queue.list(),
    spinning: now() < spinningUntil,
    spinDurationMs,
    history: history.map((h) => ({ ...h })),
    twitch,
  });

  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (event, data) => {
    for (const res of clients) send(res, event, data);
  };
  const changed = () => broadcast('state', state());

  function addRedeem(user) {
    const entry = queue.add(user, now());
    changed();
    return entry;
  }

  function spinNext() {
    if (now() < spinningUntil) return [409, { error: 'A spin is still running' }];
    const entry = queue.next();
    if (!entry) return [409, { error: 'No spins saved yet' }];
    const result = { id: entry.id, user: entry.user, ...spin(rewards, rng), durationMs: spinDurationMs, at: now() };
    spinningUntil = now() + spinDurationMs;
    history.unshift(result);
    history.length = Math.min(history.length, historySize);
    broadcast('spin', { ...result, symbols: symbolPool(rewards) });
    changed();
    // Tell the pages when the spin lock ends.
    clearTimeout(idleTimer);
    idleTimer = setTimeout(changed, spinDurationMs);
    idleTimer.unref?.();
    return [200, result];
  }

  const routes = {
    'GET /api/state': () => [200, state()],
    'GET /api/auth-url': () => {
      if (!twitchClientId) {
        return [400, { error: 'The Twitch client ID is missing. Set twitch.clientId in config.json (see README).' }];
      }
      const s = randomBytes(16).toString('hex');
      authStates.add(s);
      return [200, { url: authUrl(twitchClientId, redirectUri, s) }];
    },
    'POST /api/redeem': (body) => {
      if (typeof body.user !== 'string' || !body.user.trim()) return [400, { error: 'A username is required' }];
      return [201, addRedeem(body.user)];
    },
    'POST /api/remove': (body) => {
      if (!queue.remove(body.id)) return [404, { error: 'That spin is not in the queue' }];
      changed();
      return [200, { ok: true }];
    },
    'POST /api/spin': () => spinNext(),
    'POST /api/token': async (body) => {
      if (typeof body.token !== 'string' || !body.token) return [400, { error: 'No token received' }];
      if (typeof body.state !== 'string' || !authStates.delete(body.state)) {
        return [403, { error: 'This login link is stale. Start again from the control panel.' }];
      }
      try {
        await onToken(body.token);
      } catch (err) {
        return [502, { error: err.message }];
      }
      return [200, { ok: true }];
    },
  };

  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://x').pathname;

      if (req.method === 'GET' && path === '/') {
        res.writeHead(302, { Location: '/control' }).end();
        return;
      }
      if (req.method === 'GET' && path === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        clients.add(res);
        req.on('close', () => clients.delete(res));
        send(res, 'state', state());
        return;
      }
      if (req.method === 'GET' && PAGES[path]) {
        const [file, type] = PAGES[path];
        const content = await readFile(join(PROJECT_DIR, file));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }).end(content);
        return;
      }
      if (req.method === 'GET' && path.startsWith('/sounds/')) {
        const sound = await findSound(soundsDir, path.slice('/sounds/'.length));
        if (!sound) return json(res, 404, { error: 'No custom sound' });
        res.writeHead(200, { 'Content-Type': sound.type, 'Cache-Control': 'no-cache' }).end(sound.content);
        return;
      }

      const route = routes[`${req.method} ${path}`];
      if (!route) return json(res, 404, { error: 'Not found' });

      let body = {};
      if (req.method === 'POST') {
        // Requiring JSON forces a CORS preflight, which this server never
        // approves, so other websites cannot send spins or redeems.
        if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
          return json(res, 415, { error: 'Send JSON' });
        }
        try {
          body = JSON.parse((await readBody(req)) || '{}') ?? {};
        } catch {
          return json(res, 400, { error: 'Invalid JSON' });
        }
      }
      const [status, data] = await route(body);
      json(res, status, data);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: 'Server error' });
      else res.end();
    }
  });

  function close() {
    clearTimeout(idleTimer);
    for (const res of clients) res.end();
    clients.clear();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return {
    server,
    close,
    addRedeem,
    setTwitchStatus(status) {
      twitch = status;
      changed();
    },
  };
}

async function findSound(dir, name) {
  if (!SOUND_NAMES.includes(name)) return null;
  for (const [ext, type] of Object.entries(SOUND_TYPES)) {
    try {
      return { type, content: await readFile(join(dir, `${name}.${ext}`)) };
    } catch {
      // try the next format
    }
  }
  return null;
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
