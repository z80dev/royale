import { CHARACTER_BY_ID, type CharacterId } from '../shared/constants';
import type { ClientMsg, RoomErrorReason, ServerMsg } from '../shared/protocol';
import { socketUrl, type RoomTarget } from './config';
import { claimSessionId } from './session';

export type NetStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface NetHandlers {
  message(msg: ServerMsg): void;
  /** The server refused the room (then closes the socket). Net stops reconnecting and goes idle. */
  roomError(reason: RoomErrorReason): void;
}

/**
 * One WebSocket to one room at a time. `connect(target)` joins or creates a room; once `welcome` names the room,
 * every reconnect targets that code (never re-creates). `disconnect()` stops everything and goes idle.
 */
export class Net {
  status: NetStatus = 'idle';
  ping = 0;
  /** Room code of the current connection (from `welcome.room`), null while creating or idle. */
  room: string | null = null;

  private target: RoomTarget | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | undefined;
  private pingTimer: number | undefined;
  private attempts = 0;
  private pingStamp = 0;
  private pingSentAt = 0;
  private fallbackName = `degen-${Math.floor(1000 + Math.random() * 9000)}`;
  /** Per-tab session id (see session.ts): lets the server resume our seat/player after a dropped socket. */
  private readonly sessionId = claimSessionId();

  constructor(private readonly handlers: NetHandlers) {}

  send(msg: ClientMsg): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  /** Switch to a room (closing any current socket without `leave`; callers send it first when leaving for good). */
  connect(target: RoomTarget): void {
    this.teardown();
    this.target = target;
    this.room = 'room' in target ? target.room : null;
    this.attempts = 0;
    this.open();
  }

  /** Leave the current room for good (frees the seat now) and go idle. */
  leave(): void {
    this.send({ t: 'leave' });
    this.teardown();
    this.target = null;
    this.room = null;
  }

  private teardown(): void {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    const socket = this.socket;
    this.socket = null; // handlers of the old socket check identity and go quiet
    socket?.close();
    this.pingSentAt = 0;
    this.ping = 0;
    this.status = 'idle';
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

  private open(): void {
    const target = this.target;
    if (!target) return;
    const socket = new WebSocket(socketUrl(target));
    this.socket = socket;
    this.status = 'connecting';

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempts = 0;
      this.status = 'open';
      this.join();
      this.pingTimer = window.setInterval(() => {
        this.pingStamp = Date.now();
        this.pingSentAt = performance.now();
        this.send({ t: 'ping', c: this.pingStamp });
      }, 2000);
    };
    socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(event.data)) as ServerMsg;
      } catch {
        console.warn('Ignored invalid server message');
        return;
      }
      if (msg.t === 'welcome') {
        // Created rooms get their code here; from now on reconnects rejoin it instead of creating another.
        this.room = msg.room;
        this.target = { room: msg.room };
      } else if (msg.t === 'roomError') {
        this.teardown();
        this.target = null;
        this.room = null;
        this.handlers.roomError(msg.reason);
        return;
      } else if (msg.t === 'pong' && msg.c === this.pingStamp && this.pingSentAt) {
        const rtt = Math.max(0, performance.now() - this.pingSentAt);
        this.ping = this.ping ? this.ping * 0.75 + rtt * 0.25 : rtt;
        this.pingSentAt = 0;
      }
      this.handlers.message(msg);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
      this.pingSentAt = 0;
      this.status = 'closed';
      const delay = Math.min(10_000, 400 * 2 ** Math.min(this.attempts++, 5));
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = undefined;
        this.open();
      }, delay * (0.8 + Math.random() * 0.4));
    };
  }
}
