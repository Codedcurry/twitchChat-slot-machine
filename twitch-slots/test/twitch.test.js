import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleEventSubMessage, buildSubscription, authUrl, REDEMPTION_TYPE } from '../src/twitch.js';

const opts = { rewardTitle: 'Spin the Slots' };

function redemption({ title = 'Spin the Slots', type = REDEMPTION_TYPE, user = 'Alice' } = {}) {
  return JSON.stringify({
    metadata: { message_id: 'm1', message_type: 'notification', subscription_type: type },
    payload: {
      subscription: { type },
      event: { id: 'r1', user_login: user.toLowerCase(), user_name: user, reward: { id: 'x', title } },
    },
  });
}

test('the welcome message gives the session id', () => {
  const msg = JSON.stringify({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'abc', keepalive_timeout_seconds: 10 } },
  });
  assert.deepEqual(handleEventSubMessage(msg, opts), { type: 'welcome', sessionId: 'abc', keepaliveSeconds: 10 });
});

test('redeeming the slot reward becomes a saved spin for that chatter', () => {
  assert.deepEqual(handleEventSubMessage(redemption(), opts), { type: 'redeem', user: 'Alice', id: 'r1' });
});

test('the reward title match ignores case and extra spaces', () => {
  const r = handleEventSubMessage(redemption({ title: '  spin THE slots ' }), opts);
  assert.equal(r.type, 'redeem');
});

test('other channel point rewards are ignored', () => {
  assert.equal(handleEventSubMessage(redemption({ title: 'Hydrate' }), opts).type, 'ignored');
});

test('nothing is counted when no reward title is set', () => {
  assert.equal(handleEventSubMessage(redemption(), { rewardTitle: '' }).type, 'ignored');
});

test('other event types are ignored', () => {
  assert.equal(handleEventSubMessage(redemption({ type: 'channel.follow' }), opts).type, 'ignored');
});

test('falls back to the login name when the display name is missing', () => {
  const msg = JSON.parse(redemption());
  msg.payload.event.user_name = '';
  assert.equal(handleEventSubMessage(JSON.stringify(msg), opts).user, 'alice');
});

test('keepalive, reconnect and revocation messages are recognized', () => {
  assert.deepEqual(
    handleEventSubMessage(JSON.stringify({ metadata: { message_type: 'session_keepalive' }, payload: {} }), opts),
    { type: 'keepalive' },
  );
  assert.deepEqual(
    handleEventSubMessage(
      JSON.stringify({
        metadata: { message_type: 'session_reconnect' },
        payload: { session: { reconnect_url: 'wss://example/ws' } },
      }),
      opts,
    ),
    { type: 'reconnect', url: 'wss://example/ws' },
  );
  assert.deepEqual(
    handleEventSubMessage(
      JSON.stringify({
        metadata: { message_type: 'revocation' },
        payload: { subscription: { status: 'authorization_revoked' } },
      }),
      opts,
    ),
    { type: 'revoked', reason: 'authorization_revoked' },
  );
});

test('garbage input does not crash', () => {
  assert.equal(handleEventSubMessage('not json', opts).type, 'invalid');
  assert.equal(handleEventSubMessage('null', opts).type, 'ignored');
  assert.equal(handleEventSubMessage('{}', opts).type, 'ignored');
});

test('the subscription request targets channel point redemptions over the websocket', () => {
  assert.deepEqual(buildSubscription('sess1', '1234'), {
    type: REDEMPTION_TYPE,
    version: '1',
    condition: { broadcaster_user_id: '1234' },
    transport: { method: 'websocket', session_id: 'sess1' },
  });
});

test('the login link asks only for permission to read redemptions', () => {
  const url = new URL(authUrl('client123', 'http://localhost:7878/auth', 'state42'));
  assert.equal(url.origin + url.pathname, 'https://id.twitch.tv/oauth2/authorize');
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.equal(url.searchParams.get('client_id'), 'client123');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:7878/auth');
  assert.equal(url.searchParams.get('scope'), 'channel:read:redemptions');
  assert.equal(url.searchParams.get('state'), 'state42');
});
