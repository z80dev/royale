// Stable public front door for the game server: https://royale.z80.workers.dev
// The backend (ophy) sits behind a cloudflared quick tunnel whose random *.trycloudflare.com origin changes on
// every restart. The backend registers its current origin here (POST /register, bearer secret); clients always
// connect to wss://royale.z80.workers.dev/ws and this Worker passes the WebSocket through to the live origin.

// Minimal slice of the Workers KV binding we use (keeps this file dependency-free).
interface KVNamespace {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

interface Env {
  ROYALE: KVNamespace;
  REGISTER_SECRET: string;
}

const ORIGIN_KEY = 'origin';
const ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function register(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  if (!env.REGISTER_SECRET || !timingSafeEqual(auth, `Bearer ${env.REGISTER_SECRET}`)) {
    return new Response('unauthorized', { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { origin?: unknown } | null;
  const origin = typeof body?.origin === 'string' ? body.origin.replace(/\/+$/, '') : '';
  if (!ORIGIN_PATTERN.test(origin)) return new Response('bad origin', { status: 400 });
  await env.ROYALE.put(ORIGIN_KEY, origin);
  return Response.json({ ok: true });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/register' && req.method === 'POST') return register(req, env);

    if (url.pathname !== '/ws' && url.pathname !== '/health') {
      return new Response('launchpad royale backend · play at https://z80.wtf/royale', { status: 404 });
    }
    const origin = await env.ROYALE.get(ORIGIN_KEY, { cacheTtl: 30 });
    if (!origin) return new Response('backend offline', { status: 503 });
    // Pass the request (including the WebSocket upgrade) straight through to the tunnel origin.
    const upstream = await fetch(new Request(`${origin}${url.pathname}${url.search}`, req)).catch(() => null);
    return upstream ?? new Response('backend unreachable', { status: 502 });
  },
};
