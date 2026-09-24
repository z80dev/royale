// Runs a cloudflared quick tunnel to the local game server and registers its public origin with the
// Cloudflare Worker front door (royale.z80.workers.dev). Exits non-zero whenever the tunnel dies or stops
// answering, so systemd restarts it and a fresh origin gets registered.
//
// Env: ROYALE_REGISTER_SECRET (required), ROYALE_PORT (default 18800),
//      ROYALE_WORKER (default https://royale.z80.workers.dev), CLOUDFLARED (default: cloudflared on PATH)

export {};

const PORT = Number(process.env.ROYALE_PORT ?? 18800);
const WORKER = process.env.ROYALE_WORKER ?? 'https://royale.z80.workers.dev';
const SECRET = process.env.ROYALE_REGISTER_SECRET ?? '';
const CLOUDFLARED = process.env.CLOUDFLARED ?? 'cloudflared';
const HEALTH_EVERY_MS = 30_000;
const REREGISTER_EVERY_MS = 10 * 60_000;
const MAX_HEALTH_FAILURES = 4;

if (!SECRET) {
  console.error('[tunnel] ROYALE_REGISTER_SECRET is not set');
  process.exit(2);
}

const log = (msg: string) => console.log(`[tunnel] ${msg}`);

const proc = Bun.spawn([CLOUDFLARED, 'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], {
  stdout: 'inherit',
  stderr: 'pipe',
});
const die = (why: string): never => {
  log(`${why} — exiting for restart`);
  proc.kill();
  process.exit(1);
};
proc.exited.then((code) => die(`cloudflared exited with ${code}`));
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    proc.kill();
    process.exit(0);
  });
}

/** Drain cloudflared's log forever (never cancel the pipe); resolve with the quick-tunnel origin once printed. */
function findOrigin(): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  const decoder = new TextDecoder();
  let buffered = '';
  let found = false;
  (async () => {
    for await (const chunk of proc.stderr) {
      const text = decoder.decode(chunk);
      process.stderr.write(text);
      if (found) continue;
      buffered = (buffered + text).slice(-4096);
      const match = buffered.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        found = true;
        resolve(match[0]);
      }
    }
    if (!found) die('cloudflared closed its log before printing a URL');
  })();
  return promise;
}

async function healthy(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function register(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${WORKER}/register`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ origin }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log(`register failed: ${res.status} ${await res.text()}`);
    return res.ok;
  } catch (err) {
    log(`register error: ${err}`);
    return false;
  }
}

const origin = await findOrigin();
log(`quick tunnel: ${origin}`);

// New quick-tunnel hostnames take a few seconds to resolve.
const readyBy = Date.now() + 90_000;
while (!(await healthy(origin))) {
  if (Date.now() > readyBy) die('tunnel never became reachable');
  await Bun.sleep(2000);
}
for (let attempt = 1; !(await register(origin)); attempt++) {
  if (attempt >= 10) die('could not register with the worker');
  await Bun.sleep(3000 * attempt);
}
log(`registered with ${WORKER}`);

let failures = 0;
let lastRegister = Date.now();
setInterval(async () => {
  if (await healthy(origin)) {
    failures = 0;
  } else if (++failures >= MAX_HEALTH_FAILURES) {
    die(`health check failed ${failures}× in a row`);
  } else {
    log(`health check failed (${failures}/${MAX_HEALTH_FAILURES})`);
  }
  if (Date.now() - lastRegister > REREGISTER_EVERY_MS && (await register(origin))) lastRegister = Date.now();
}, HEALTH_EVERY_MS);
