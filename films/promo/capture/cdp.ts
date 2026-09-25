// Minimal Chrome DevTools Protocol client + Chrome launcher for the capture harness (Bun).

import { mkdirSync } from 'node:fs';
import type { Subprocess } from 'bun';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export interface ChromeOptions {
  port: number;
  width: number;
  height: number;
  headless?: boolean;
  profile?: string;
}

export interface Chrome {
  proc: Subprocess;
  wsUrl: string;
}

export async function launchChrome(opts: ChromeOptions): Promise<Chrome> {
  const profile = opts.profile ?? `/tmp/lr-capture-chrome-${opts.port}`;
  mkdirSync(profile, { recursive: true });
  const args = [
    `--remote-debugging-port=${opts.port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${opts.width},${opts.height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--enable-gpu-rasterization',
    '--ignore-gpu-blocklist',
    '--force-color-profile=srgb',
    '--hide-scrollbars',
  ];
  if (opts.headless !== false) args.push('--headless=new');
  args.push('about:blank');
  const proc = Bun.spawn([CHROME, ...args], { stdout: 'ignore', stderr: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${opts.port}/json/version`);
      if (res.ok) {
        const info = (await res.json()) as { webSocketDebuggerUrl: string };
        return { proc, wsUrl: info.webSocketDebuggerUrl };
      }
    } catch {
      // not up yet
    }
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error('Chrome did not expose the DevTools endpoint');
}

type CdpParams = Record<string, unknown>;
type Listener = (params: CdpParams, sessionId?: string) => void;
interface CdpReply {
  id?: number;
  method?: string;
  params?: CdpParams;
  sessionId?: string;
  result?: unknown;
  error?: { message: string };
}

export class Cdp {
  private id = 0;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string }>();
  private readonly listeners = new Map<string, Set<Listener>>();

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as CdpReply;
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params ?? {}, msg.sessionId);
      }
    };
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`CDP connect failed: ${url}`));
    await promise;
    return new Cdp(ws);
  }

  /** CDP results are protocol JSON; callers name the fields they read. */
  send<T>(method: string, params: CdpParams = {}, sessionId?: string): Promise<T> {
    const id = ++this.id;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    this.pending.set(id, { resolve, reject, method });
    return promise as Promise<T>;
  }

  on(method: string, fn: Listener): () => void {
    let set = this.listeners.get(method);
    if (!set) this.listeners.set(method, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  close(): void {
    this.ws.close();
  }
}

interface EvalResult {
  result: { value: unknown };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

/** A page target attached with a flat session. */
export class Page {
  constructor(
    readonly cdp: Cdp,
    readonly sessionId: string,
  ) {}

  /** deviceScaleFactor > 1 renders supersampled (the driver downsamples to the output size). */
  static async open(cdp: Cdp, width: number, height: number, deviceScaleFactor = 1): Promise<Page> {
    const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(cdp, sessionId);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
    return page;
  }

  send<T>(method: string, params: CdpParams = {}): Promise<T> {
    return this.cdp.send<T>(method, params, this.sessionId);
  }

  /** Evaluates in the page; the caller names the JSON shape it expects back. */
  async eval<T>(expression: string): Promise<T> {
    const res = await this.send<EvalResult>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error(`page eval failed: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
    }
    return res.result.value as T;
  }

  async navigate(url: string): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    const off = this.cdp.on('Page.loadEventFired', (_p, sid) => {
      if (sid !== this.sessionId) return;
      off();
      resolve();
    });
    await this.send('Page.navigate', { url });
    await promise;
  }
}
