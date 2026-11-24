// Worker entry: a tiny HTTP API in front of one Durable Object per lobby.
// The static site in ./dist is served by the assets binding; only /api/*
// reaches this code (see "run_worker_first" in wrangler.jsonc).
//
//   POST /api/rooms            { hostId }  -> { code }   start a lobby
//   GET  /api/rooms/:code                  -> { exists } check a code
//   GET  /api/rooms/:code/ws   (WebSocket)               play

import { CODE_ALPHABET, CODE_LENGTH, isRoomCode } from '../shared/protocol';

import type { Lobby } from './lobby';
export { Lobby } from './lobby';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const lobby = (env: Env, code: string) => {
  const ns = env.LOBBY as unknown as DurableObjectNamespace<Lobby>;
  return ns.get(ns.idFromName(code));
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'rooms', code?, 'ws'?]
    if (parts[0] !== 'api' || parts[1] !== 'rooms') return json({ error: 'Not found' }, 404);

    if (parts.length === 2 && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { hostId?: unknown };
      const hostId = typeof body.hostId === 'string' ? body.hostId.slice(0, 64) : '';
      if (!hostId) return json({ error: 'Missing hostId' }, 400);
      for (let i = 0; i < 20; i++) {
        const code = randomCode();
        if (await lobby(env, code).create(code, hostId)) return json({ code });
      }
      return json({ error: 'Could not find a free room code; try again.' }, 503);
    }

    const code = (parts[2] ?? '').toUpperCase();
    if (!isRoomCode(code)) return json({ error: 'Not a room code' }, 404);

    if (parts.length === 3 && request.method === 'GET') {
      return json({ exists: await lobby(env, code).exists() });
    }

    if (parts.length === 4 && parts[3] === 'ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected WebSocket' }, 426);
      return lobby(env, code).fetch(request);
    }

    return json({ error: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
