/**
 * Verifies PartyServer conversation WebSocket + REST broadcast.
 * Usage: node scripts/verify-party-ws.mjs [apiBase]
 */
const API_BASE =
  process.argv[2]?.replace(/\/$/, '') ??
  'https://digital-kingsmen-portal-api.auto-cca.workers.dev';

const WS_BASE = API_BASE.replace(/^http/, 'ws');

async function login() {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@digitalkingsmen.com',
      password: 'Demo123!',
    }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(`Login failed: ${JSON.stringify(json)}`);
  return json.data.accessToken;
}

async function listConversations(token) {
  const res = await fetch(`${API_BASE}/api/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!json.success || !json.data?.length) throw new Error('No conversations');
  return json.data[0].id;
}

function waitForWsMessage(ws, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS message timeout')), timeoutMs);
    ws.addEventListener('message', function onMsg(ev) {
      clearTimeout(t);
      ws.removeEventListener('message', onMsg);
      resolve(ev.data);
    });
  });
}

async function main() {
  const token = await login();
  console.log('login: ok');

  const convId = await listConversations(token);
  console.log('conversation:', convId);

  const wsUrl = `${WS_BASE}/parties/conversation-server/${convId}?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', (e) => reject(e), { once: true });
    ws.addEventListener('close', (e) => {
      if (e.code !== 1000) reject(new Error(`WS closed: ${e.code} ${e.reason}`));
    }, { once: true });
    setTimeout(() => reject(new Error('WS open timeout')), 5000);
  });
  console.log('websocket: connected (101)');

  const msgPromise = waitForWsMessage(ws);
  const text = `realtime-verify-${Date.now()}`;
  const postRes = await fetch(`${API_BASE}/api/conversations/${convId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: text }),
  });
  const postJson = await postRes.json();
  if (!postJson.success) throw new Error(`POST failed: ${JSON.stringify(postJson)}`);
  console.log('post message: ok', postJson.data.id);

  const frame = await msgPromise;
  const event = JSON.parse(String(frame));
  if (event.type !== 'message.created') {
    throw new Error(`Unexpected event type: ${event.type}`);
  }
  if (event.payload?.message !== text) {
    throw new Error(`Payload mismatch: ${event.payload?.message} !== ${text}`);
  }
  console.log('broadcast: message.created received');

  // Auth negative: wrong conversation
  const badWs = new WebSocket(
    `${WS_BASE}/parties/conversation-server/00000000-0000-0000-0000-000000000099?token=${encodeURIComponent(token)}`,
  );
  const badResult = await new Promise((resolve) => {
    badWs.addEventListener('close', (e) => resolve({ code: e.code }), { once: true });
    badWs.addEventListener('open', () => resolve({ code: 0 }), { once: true });
    setTimeout(() => resolve({ code: -1 }), 3000);
  });
  if (badResult.code === 0) throw new Error('Expected forbidden WS to fail');
  console.log('auth negative (bad conversation): rejected');

  // User party room
  const userId = postJson.data?.senderId ?? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
  const userWsUrl = `${WS_BASE}/parties/user-server/${userId}?token=${encodeURIComponent(token)}`;
  const userWs = new WebSocket(userWsUrl);
  await new Promise((resolve, reject) => {
    userWs.addEventListener('open', () => resolve(), { once: true });
    userWs.addEventListener('error', reject, { once: true });
    setTimeout(() => reject(new Error('user WS open timeout')), 5000);
  });
  console.log('user websocket: connected');

  const otherUserId = '00000000-0000-0000-0000-000000000099';
  const badUserWs = new WebSocket(
    `${WS_BASE}/parties/user-server/${otherUserId}?token=${encodeURIComponent(token)}`,
  );
  await new Promise((resolve) => {
    badUserWs.addEventListener('close', () => resolve(), { once: true });
    badUserWs.addEventListener('open', () => resolve('unexpected-open'), { once: true });
    setTimeout(() => resolve('timeout'), 3000);
  });
  console.log('auth negative (other user room): rejected');

  userWs.close();
  ws.close();
  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err.message || err);
  process.exit(1);
});
