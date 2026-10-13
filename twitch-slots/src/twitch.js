// Listens for channel point redemptions through Twitch EventSub over a
// WebSocket. Only redemptions of the reward named in config.json count.

export const REDEMPTION_TYPE = 'channel.channel_points_custom_reward_redemption.add';
export const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const SCOPE = 'channel:read:redemptions';

export function handleEventSubMessage(raw, { rewardTitle }) {
  let msg;
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { type: 'invalid' };
  }
  switch (msg?.metadata?.message_type) {
    case 'session_welcome':
      return {
        type: 'welcome',
        sessionId: msg.payload.session.id,
        keepaliveSeconds: msg.payload.session.keepalive_timeout_seconds,
      };
    case 'session_keepalive':
      return { type: 'keepalive' };
    case 'session_reconnect':
      return { type: 'reconnect', url: msg.payload.session.reconnect_url };
    case 'revocation':
      return { type: 'revoked', reason: msg.payload?.subscription?.status ?? 'unknown' };
    case 'notification': {
      if (msg.payload?.subscription?.type !== REDEMPTION_TYPE) return { type: 'ignored' };
      const event = msg.payload.event;
      if (!sameTitle(event?.reward?.title, rewardTitle)) return { type: 'ignored' };
      return { type: 'redeem', user: event.user_name || event.user_login, id: event.id };
    }
    default:
      return { type: 'ignored' };
  }
}

function sameTitle(a, b) {
  const norm = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
  return norm(b) !== '' && norm(a) === norm(b);
}

export function buildSubscription(sessionId, broadcasterId) {
  return {
    type: REDEMPTION_TYPE,
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
    transport: { method: 'websocket', session_id: sessionId },
  };
}

export function authUrl(clientId, redirectUri, state) {
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
  });
  return `https://id.twitch.tv/oauth2/authorize?${params}`;
}

// Checks the token, then keeps a WebSocket open and calls onRedeem(user) for
// each redemption. Reconnects on its own. Throws if the token is not usable.
export async function connectTwitch({ token, rewardTitle, onRedeem, onStatus = () => {}, log = console }) {
  const check = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!check.ok) throw new Error('The Twitch login is invalid or expired. Click "Connect Twitch" again.');
  const info = await check.json();
  if (!info.scopes?.includes(SCOPE)) throw new Error(`The Twitch login is missing the ${SCOPE} permission.`);

  const seen = new Set();
  let stopped = false;
  let current = null;
  let lastMessageAt = Date.now();
  let keepaliveMs = 10_000;

  const watchdog = setInterval(() => {
    // Twitch sends keepalives; silence means the connection died quietly.
    if (current && Date.now() - lastMessageAt > keepaliveMs + 10_000) current.close();
  }, 5_000);

  const open = (url, replacing) => {
    const sock = new WebSocket(url);
    if (!replacing) current = sock;

    sock.onmessage = async (e) => {
      lastMessageAt = Date.now();
      const msg = handleEventSubMessage(e.data, { rewardTitle });
      switch (msg.type) {
        case 'welcome':
          if (msg.keepaliveSeconds) keepaliveMs = msg.keepaliveSeconds * 1000;
          if (replacing) {
            // Subscriptions carry over to the new session after a reconnect.
            current = sock;
            replacing.close();
            onStatus('connected');
            return;
          }
          try {
            await subscribe(token, info.client_id, msg.sessionId, info.user_id);
            onStatus('connected');
            log.log(`Twitch: listening for "${rewardTitle}" redeems on ${info.login}`);
          } catch (err) {
            onStatus('error');
            log.error(`Twitch: ${err.message}`);
            stop();
          }
          return;
        case 'redeem':
          if (seen.has(msg.id)) return; // Twitch can deliver the same event twice
          seen.add(msg.id);
          if (seen.size > 1000) seen.delete(seen.values().next().value);
          onRedeem(msg.user);
          return;
        case 'reconnect':
          open(msg.url, sock);
          return;
        case 'revoked':
          onStatus('login revoked');
          log.error(`Twitch: subscription revoked (${msg.reason}). Click "Connect Twitch" again.`);
          stop();
          return;
      }
    };

    sock.onclose = () => {
      if (stopped || sock !== current) return;
      onStatus('reconnecting');
      setTimeout(() => {
        if (!stopped) open(EVENTSUB_URL, null);
      }, 5_000);
    };
  };

  function stop() {
    stopped = true;
    clearInterval(watchdog);
    current?.close();
  }

  open(EVENTSUB_URL, null);
  return { stop, login: info.login };
}

async function subscribe(token, clientId, sessionId, broadcasterId) {
  const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      'Client-Id': clientId,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildSubscription(sessionId, broadcasterId)),
  });
  if (!res.ok) throw new Error(`could not subscribe to redeems (${res.status}): ${await res.text()}`);
}
