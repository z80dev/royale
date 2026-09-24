// Many rooms per server: invite codes, routing of new sockets, the shared tick, idle cleanup and the public list.

import { MAX_PLAYERS } from '../shared/constants';
import type { RoomErrorReason, RoomList, RoomVisibility } from '../shared/protocol';
import { MAX_ROOMS, ROOM_IDLE_TTL, ROOM_MAX_CONSECUTIVE_ERRORS } from './config';
import { Room } from './room';

/** Code alphabet: A–Z and 2–9 without look-alikes (O/0, I/1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_PATTERN = /^[A-Z2-9]{6}$/;

export type RoomRoute = { room: Room } | { error: RoomErrorReason };

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let code = '';
  // 256 % 32 === 0, so the modulo is unbiased.
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly errorStreak = new Map<string, number>();

  constructor(private readonly timeScale: number) {}

  get size(): number {
    return this.rooms.size;
  }

  /**
   * Resolve a new socket's query: `create=public|private` makes a room, `room=CODE` (case-insensitive) joins one.
   * Anything else (e.g. a bare `/ws`) is `not_found`.
   */
  route(params: URLSearchParams): RoomRoute {
    const create = params.get('create');
    if (create === 'public' || create === 'private') return this.create(create);
    const code = (params.get('room') ?? '').trim().toUpperCase();
    const room = CODE_PATTERN.test(code) ? this.rooms.get(code) : undefined;
    if (!room) return { error: 'not_found' };
    if (room.socketCount() >= MAX_PLAYERS) return { error: 'full' };
    return { room };
  }

  create(visibility: RoomVisibility): RoomRoute {
    if (this.rooms.size >= MAX_ROOMS) return { error: 'limit' };
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const room = new Room(code, visibility, this.timeScale);
    this.rooms.set(code, room);
    console.log(`[rooms] created ${code} (${visibility}) · ${this.rooms.size} room(s)`);
    return { room };
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Public rooms: waiting lobbies with the most humans first, then running matches. */
  publicList(): RoomList {
    const waiting = (phase: string) => (phase === 'lobby' || phase === 'countdown' ? 0 : 1);
    const rooms = [...this.rooms.values()]
      .filter((room) => room.visibility === 'public')
      .map((room) => room.summary())
      .sort((a, b) => waiting(a.phase) - waiting(b.phase) || b.humans - a.humans || a.code.localeCompare(b.code));
    return { rooms };
  }

  /** One 30 Hz step for every room. A room that throws repeatedly is torn down; the others keep running. */
  tick(): void {
    const now = Date.now();
    const idleMs = ROOM_IDLE_TTL * this.timeScale * 1000;
    for (const [code, room] of this.rooms) {
      try {
        room.tick();
        this.errorStreak.delete(code);
      } catch (err) {
        const streak = (this.errorStreak.get(code) ?? 0) + 1;
        this.errorStreak.set(code, streak);
        console.error(`[room ${code}] tick error ${streak}/${ROOM_MAX_CONSECUTIVE_ERRORS}`, err);
        if (streak >= ROOM_MAX_CONSECUTIVE_ERRORS) {
          this.close(code, 'crashed', 'this room crashed (server error) — sorry ser, create or join another one');
        }
        continue;
      }
      if (room.idleFor(now, idleMs)) this.close(code, 'idle');
    }
  }

  private close(code: string, why: string, text = 'room closed'): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const summary = room.summary();
    try {
      room.shutdown(text);
    } catch (err) {
      console.error(`[room ${code}] shutdown error`, err);
    }
    this.rooms.delete(code);
    this.errorStreak.delete(code);
    console.log(
      `[rooms] closed ${code} (${room.visibility}, ${why}) · ${summary.humans} human(s) · ${this.rooms.size} room(s)`,
    );
  }
}
