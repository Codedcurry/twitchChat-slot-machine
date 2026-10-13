import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createApp } from './src/app.js';
import { SpinQueue } from './src/queue.js';
import { validateRewards } from './src/slots.js';
import { connectTwitch } from './src/twitch.js';

const dir = fileURLToPath(new URL('.', import.meta.url));
const dataDir = join(dir, 'data');
const tokenFile = join(dataDir, 'twitch-token.json');

let config;
try {
  config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  validateRewards(config.rewards);
} catch (err) {
  console.error(`config.json problem: ${err.message}`);
  process.exit(1);
}

const port = config.port ?? 7878;
const twitchConfig = config.twitch ?? {};
let twitch = null;

const app = createApp({
  queue: new SpinQueue({ file: join(dataDir, 'queue.json') }),
  rewards: config.rewards,
  spinDurationMs: config.spinDurationMs ?? 5000,
  twitchClientId: twitchConfig.clientId ?? '',
  redirectUri: `http://localhost:${port}/auth`,
  onToken: async (token) => {
    await startTwitch(token);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(tokenFile, JSON.stringify({ token }));
  },
});

async function startTwitch(token) {
  if (!twitchConfig.rewardTitle) throw new Error('Set twitch.rewardTitle in config.json first.');
  twitch?.stop();
  twitch = null;
  app.setTwitchStatus('connecting');
  try {
    twitch = await connectTwitch({
      token,
      rewardTitle: twitchConfig.rewardTitle,
      onRedeem: (user) => {
        app.addRedeem(user);
        console.log(`Saved a spin for ${user}`);
      },
      onStatus: (status) => app.setTwitchStatus(status),
    });
  } catch (err) {
    app.setTwitchStatus('not connected');
    throw err;
  }
}

app.server.listen(port, '127.0.0.1', async () => {
  console.log(`Control panel:      http://localhost:${port}/control`);
  console.log(`OBS browser source: http://localhost:${port}/overlay`);

  if (!existsSync(tokenFile)) {
    console.log('Twitch is not connected yet. Open the control panel and click "Connect Twitch".');
    return;
  }
  try {
    await startTwitch(JSON.parse(readFileSync(tokenFile, 'utf8')).token);
  } catch (err) {
    console.error(`Twitch: ${err.message}`);
    if (/invalid or expired/.test(err.message)) rmSync(tokenFile, { force: true });
  }
});

app.server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${port} is in use. Is the slots server already running?`);
  else console.error(err);
  process.exit(1);
});
