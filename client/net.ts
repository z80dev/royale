import { CHARACTER_BY_ID, type CharacterId } from '../shared/constants';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { serverUrl } from './config';
import { claimSessionId } from './session';

export type NetStatus = 'connecting' | 'open' | 'closed';

export class Net {
  status: NetStatus = 'connecting';
  ping = 0;

  private socket: WebSocket | null = null;
  private reconnectTimer: number | undefined;
  private pingTimer: number | undefined;
  private attempts = 0;
  private stopped = false;
  private pingStamp = 0;
  private pingSentAt = 0;
  private fallbackName = `degen-${Math.floor(1000 + Math.random() * 9000)}`;
  /** Per-tab session id (see session.ts): lets the server resume our seat/player after a dropped socket. */
  private readonly sessionId = claimSessionId();

  constructor(
    private readonly onMessage: (msg: ServerMsg) => void,
    private readonly onStatus?: (status: NetStatus) => void,
  ) {
    this.connect();
  }

  send(msg: ClientMsg): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    this.socket?.close();
    this.socket = null;
    this.status = 'closed';
  }

  private join(): void {
    let name = this.fallbackName;
    let character: CharacterId | undefined;
    try {
      const savedName = localStorage.getItem('lr.name');
      if (savedName?.trim()) name = savedName;
      else localStorage.setItem('lr.name', name);
      const savedCharacter = localStorage.getItem('lr.char');
      if (savedCharacter && Object.hasOwn(CHARACTER_BY_ID, savedCharacter)) character = savedCharacter as CharacterId;
    } catch {
      // Storage can be disabled in a private browser session; the generated name still works.
    }
    this.fallbackName = name;
    this.send({ t: 'join', name, sid: this.sessionId, ...(character ? { character } : {}) });
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = new WebSocket(serverUrl());
    this.socket = socket;
    this.status = 'connecting';
    this.onStatus?.('connecting');

    socket.onopen = () => {
      if (this.socket !== socket || this.stopped) return;
      this.attempts = 0;
      this.status = 'open';
      this.onStatus?.('open');
      this.join();
      this.pingTimer = window.setInterval(() => {
        this.pingStamp = Date.now();
        this.pingSentAt = performance.now();
        this.send({ t: 'ping', c: this.pingStamp });
      }, 2000);
    };
    socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket || this.stopped) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(event.data)) as ServerMsg;
      } catch {
        console.warn('Ignored invalid server message');
        return;
      }
      if (msg.t === 'pong' && msg.c === this.pingStamp && this.pingSentAt) {
        const rtt = Math.max(0, performance.now() - this.pingSentAt);
        this.ping = this.ping ? this.ping * 0.75 + rtt * 0.25 : rtt;
        this.pingSentAt = 0;
      }
      this.onMessage(msg);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket || this.stopped) return;
      this.socket = null;
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
      this.pingSentAt = 0;
      this.status = 'closed';
      this.onStatus?.('closed');
      const delay = Math.min(10_000, 400 * 2 ** Math.min(this.attempts++, 5));
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = undefined;
        this.connect();
      }, delay * (0.8 + Math.random() * 0.4));
    };
  }
}
