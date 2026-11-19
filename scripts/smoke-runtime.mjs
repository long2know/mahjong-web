import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

const [phase, url, appVersion, commitSha, stateFile] = process.argv.slice(2);
assert(['seed', 'resume'].includes(phase) && url && appVersion && commitSha && stateFile,
  'Usage: node scripts/smoke-runtime.mjs {seed|resume} ORIGIN VERSION COMMIT STATE_FILE');
assert(/^(?:[0-9a-f]{40}|unknown)$/.test(commitSha), 'Expected a full Git SHA or unknown');
const origin = new URL(url).origin;
assert(url === origin && /^https?:/.test(origin), 'ORIGIN must be an HTTP(S) origin with no path');
const name = 'Infra Smoke Guest';
const defaults = { sound: true, music: false, volume: 0.7, reducedMotion: false };
const preferences = { sound: false, music: true, volume: 0.25, reducedMotion: true };

function get(path, init) {
  return fetch(new URL(path, origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    ...init,
  });
}

async function json(path, init) {
  const response = await get(path, init);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/i, path);
  if (path.startsWith('/api/')) {
    assert.match(response.headers.get('cache-control') ?? '', /\bno-store\b/i, path);
  }
  return { body: await response.json(), response };
}

async function checkApplication() {
  const start = Date.now();
  for (;;) {
    try {
      assert.deepEqual((await json('/health/ready')).body, { status: 'ready' });
      break;
    } catch (error) {
      if (Date.now() - start > 40_000) throw new Error('Readiness did not pass', { cause: error });
      await sleep(250);
    }
  }

  assert.deepEqual((await json('/health/live')).body, { status: 'live' });
  assert.deepEqual((await json('/api/version')).body, { appVersion, protocolVersion: 1, commitSha });

  const root = await get('/');
  assert.equal(root.status, 200, 'SPA root');
  assert.match(root.headers.get('content-type') ?? '', /^text\/html\b/i, 'SPA root');
  assert.match(root.headers.get('cache-control') ?? '', /\b(?:no-cache|no-store)\b/i, 'SPA root must revalidate');
  const html = await root.text();
  const assets = [...html.matchAll(/\b(?:src|href)=(["'])(\/assets\/[^"'?#]+\.(js|css))\1/g)];
  assert(assets.some(([, , , extension]) => extension === 'js'), 'SPA is missing a root-scoped JS bundle');
  assert(assets.some(([, , , extension]) => extension === 'css'), 'SPA is missing a root-scoped CSS bundle');
  for (const [, , path, extension] of assets) {
    const asset = await get(path);
    assert.equal(asset.status, 200, path);
    assert.match(asset.headers.get('content-type') ?? '',
      extension === 'js' ? /^(?:application|text)\/javascript\b/i : /^text\/css\b/i, path);
    assert.match(asset.headers.get('cache-control') ?? '', /\bimmutable\b/i, `Hashed cache policy: ${path}`);
    assert((await asset.arrayBuffer()).byteLength > 0, `${path} was empty`);
  }
  const missing = await get('/assets/infra-smoke-missing.js');
  assert.equal(missing.status, 404, 'A missing bundled asset must not return the SPA');
  await missing.body?.cancel();
}

function writeJson(path, method, body, cookie) {
  return json(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function upgradeStatus(requestOrigin, cookie) {
  return new Promise((resolve, reject) => {
    const request = origin.startsWith('https:') ? httpsRequest : httpRequest;
    const probe = request(new URL('/ws', origin), {
      signal: AbortSignal.timeout(5000),
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13',
        ...(requestOrigin ? { Origin: requestOrigin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    probe.on('upgrade', (_response, socket) => {
      socket.destroy();
      resolve(101);
    });
    probe.on('error', reject);
    probe.end();
  });
}

async function withSocket(cookie, action) {
  const target = new URL('/ws', origin);
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(target, { headers: { Origin: origin, Cookie: cookie } });
  const queue = [];
  let wake;
  const deliver = value => wake ? wake(value) : queue.push(value);
  socket.addEventListener('message', event => {
    try {
      deliver(JSON.parse(event.data));
    } catch {
      deliver(new Error('WebSocket returned invalid JSON'));
    }
  });
  socket.addEventListener('error', () => deliver(new Error(`WebSocket failed during ${phase}`)));
  socket.addEventListener('close', event => deliver(new Error(`WebSocket closed (${event.code}) during ${phase}`)));

  async function take() {
    let timer;
    const frame = queue.shift() ?? await new Promise(resolve => {
      wake = value => {
        wake = undefined;
        resolve(value);
      };
      timer = setTimeout(() => wake?.(new Error('WebSocket timed out waiting for a message')), 12_000);
    });
    clearTimeout(timer);
    if (frame instanceof Error) throw frame;
    assert.equal(frame?.v, 1, 'WebSocket message protocol');
    return frame;
  }

  async function next(type) {
    for (let skipped = 0; skipped < 30; skipped++) {
      const frame = await take();
      if (frame.type === type) return frame;
      assert.equal(frame.type, 'snapshot', `Expected WebSocket ${type}`);
    }
    throw new Error(`WebSocket did not send ${type} before the snapshot limit`);
  }

  try {
    const lease = await next('lease');
    assert(typeof lease.lease === 'string' && lease.lease.length > 0, 'WebSocket did not issue a lease');
    return await action({
      async roundTrip(payload, requestId = randomUUID()) {
        socket.send(JSON.stringify({ v: 1, requestId, ...payload }));
        const ack = await next('ack');
        assert.equal(ack.requestId, requestId, 'WebSocket ack request ID');
        assert.equal(ack.status, 'ok', `WebSocket ${payload.op ?? payload.type}: ${ack.error?.code ?? 'no error code'}`);
        const snapshot = await next('snapshot');
        assert.equal(snapshot.roomId, ack.roomId, 'WebSocket ack/snapshot room ID');
        for (const key of ['roomRevision', 'gameRevision']) {
          assert(snapshot[key] >= ack[key], `WebSocket snapshot predates ack: ${key}`);
        }
        return { ack, snapshot };
      },
      nextSnapshot: () => next('snapshot'),
      lease: lease.lease,
    });
  } finally {
    socket.close();
  }
}

function checkpoint(snapshot) {
  return {
    roomId: snapshot.roomId,
    roomRevision: snapshot.roomRevision,
    gameRevision: snapshot.gameRevision,
    autoResumeAtUtc: snapshot.room.autoResumeAtUtc,
    inviteCode: snapshot.self.inviteCode,
    game: snapshot.game,
    hand: snapshot.self.hand,
    drawnTileId: snapshot.self.drawnTileId,
  };
}

function assertPaused(snapshot) {
  assert.equal(snapshot.room.status, 'playing');
  assert.equal(snapshot.room.paused, true);
  assert.equal(snapshot.self.seat, 0);
  assert.equal(snapshot.game?.handNumber, 1);
  assert.equal(snapshot.game?.window?.deadlineUtc, null);
  assert(Date.parse(snapshot.room.autoResumeAtUtc) > Date.now(), 'Checkpoint pause expired during smoke');
}

await checkApplication();

if (phase === 'seed') {
  const { body, response } = await writeJson('/api/guest', 'POST', { displayName: name });
  assert.deepEqual(body, { displayName: name, preferences: defaults, resumeRoomId: null });
  const cookieHeader = response.headers.getSetCookie().find(value => value.startsWith('mahjong_guest='));
  assert(cookieHeader, '/api/guest did not set its cookie');
  assert(/;\s*httponly\b/i.test(cookieHeader), 'Guest cookie is not HttpOnly');
  assert(/;\s*samesite=lax\b/i.test(cookieHeader), 'Guest cookie is not SameSite=Lax');
  assert(/;\s*path=\/(?:;|$)/i.test(cookieHeader), 'Guest cookie is not scoped to the origin root');
  if (origin.startsWith('https:')) {
    assert(/;\s*secure\b/i.test(cookieHeader), 'HTTPS guest cookie is not Secure');
  }
  const cookie = cookieHeader.split(';', 1)[0];
  assert.equal(await upgradeStatus(origin), 401, 'Unauthenticated WebSocket upgrade');
  assert.equal(await upgradeStatus('https://wrong-origin.invalid', cookie), 403, 'Cross-origin WebSocket upgrade');
  assert.equal(await upgradeStatus(null, cookie), 403, 'Origin-less WebSocket upgrade');
  const profile = await writeJson('/api/profile', 'PATCH', { preferences }, cookie);
  assert.deepEqual(profile.body, { displayName: name, preferences, resumeRoomId: null });

  const { snapshot, committed } = await withSocket(cookie, async ({ lease, nextSnapshot, roundTrip }) => {
    const command = (op, payload) => roundTrip({ type: 'command', lease, op, payload });
    const created = await command('createRoom', { visibility: 'invite', matchHands: 1, fillBots: true });
    const { roomId } = created.snapshot;
    const ready = await command('setReady', { roomId, expectedRoomRevision: created.snapshot.roomRevision, ready: true });
    let { snapshot } = await command('start', { roomId, expectedRoomRevision: ready.snapshot.roomRevision });

    const legalChoice = frame => frame.self.legalOptions.find(option => ['pass', 'discard'].includes(option.kind));
    for (let attempt = 0; attempt < 8 && !legalChoice(snapshot); attempt++) {
      snapshot = await nextSnapshot();
    }
    const option = legalChoice(snapshot);
    assert(option, 'Started game did not offer a playable choice to the host');
    const choice = {
      type: 'command', lease, op: 'choose',
      payload: {
        roomId, windowId: snapshot.game.window.windowId,
        anchorGameRevision: snapshot.game.window.anchorGameRevision, optionId: option.optionId,
      },
    };
    const requestId = randomUUID();
    const played = await roundTrip(choice, requestId);
    assert(played.ack.gameRevision > snapshot.gameRevision, 'Legal choice did not commit a game revision');
    const paused = await command('setPaused', {
      roomId, expectedRoomRevision: played.snapshot.roomRevision, paused: true,
    });
    return { snapshot: paused.snapshot, committed: { choice, requestId, ack: played.ack } };
  });
  assertPaused(snapshot);
  assert(typeof snapshot.self.inviteCode === 'string' && snapshot.self.inviteCode.length > 0, 'Invite code missing');
  await writeFile(stateFile, JSON.stringify({
    cookie, checkpoint: checkpoint(snapshot), committed,
  }), { mode: 0o600, flag: 'wx' });
  console.log('Verified health, version, Vite assets, and WebSocket admission; paused a disposable game after a legal choice.');
} else {
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  const resumed = await writeJson('/api/guest', 'POST', { displayName: 'Different Smoke Name' }, state.cookie);
  assert.deepEqual(resumed.body, {
    displayName: name, preferences, resumeRoomId: state.checkpoint.roomId,
  }, 'Original guest identity, preferences, and room membership did not survive');
  await withSocket(state.cookie, async ({ roundTrip }) => {
    const { snapshot } = await roundTrip({ type: 'sync', roomId: state.checkpoint.roomId });
    assertPaused(snapshot);
    assert(isDeepStrictEqual(checkpoint(snapshot), state.checkpoint), 'Recovered game/seat checkpoint changed');
    const { choice, requestId, ack } = state.committed;
    const replay = await roundTrip(choice, requestId);
    assert.deepEqual(replay.ack, ack, 'Recovered command receipt did not replay the original ack');
    assert(isDeepStrictEqual(checkpoint(replay.snapshot), state.checkpoint), 'Command retry changed the recovered checkpoint');
  });
  console.log('Recovered the original guest, preferences, paused game, and committed action without replaying it.');
}
