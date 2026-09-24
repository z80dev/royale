// Shared state + services every UI module can read. Owned and mutated by Ui (index.ts); modules read it.

import { CHARACTER_BY_ID, CHARACTERS, type CharacterId } from '../../shared/constants';
import type { GameMap } from '../../shared/map';
import type { RosterEntry, ServerMsg } from '../../shared/protocol';
import type { UiDeps } from '../view';

export type LobbyMsg = Extract<ServerMsg, { t: 'lobby' }>;
export type MatchMsg = Extract<ServerMsg, { t: 'match' }>;
export type EndMsg = Extract<ServerMsg, { t: 'end' }>;
export type ChatMsg = Extract<ServerMsg, { t: 'chat' }>;

export interface PlayerInfo {
  name: string;
  character: CharacterId;
  team: number;
  bot: boolean;
  color: string;
}

export class UiContext {
  welcomeId: string | null = null;
  lobby: LobbyMsg | null = null;
  match: MatchMsg | null = null;
  map: GameMap | null = null;
  roster = new Map<string, RosterEntry>();
  /** Installed by Ui: small transient notification (bottom-center). */
  toast: (text: string, tone?: 'info' | 'good' | 'bad' | 'gold') => void = () => {};
  /** Kills per player id this match, counted from kill events (roster has no live stats). */
  kills = new Map<string, number>();
  myTeam = 0;
  private lastHover = 0;

  constructor(readonly deps: UiDeps) {}

  /** Local player id in the current match (falls back to the lobby/welcome id). */
  get selfId(): string | null {
    return this.match ? this.match.you : this.welcomeId;
  }

  info(id: string | null | undefined): PlayerInfo {
    if (id) {
      const entry = this.roster.get(id);
      if (entry) {
        return { ...entry, color: CHARACTER_BY_ID[entry.character]?.primary ?? '#ffffff' };
      }
      const lobbyPlayer = this.lobby?.players.find((p) => p.id === id);
      if (lobbyPlayer) {
        return {
          name: lobbyPlayer.name,
          character: lobbyPlayer.character,
          team: lobbyPlayer.team,
          bot: false,
          color: CHARACTER_BY_ID[lobbyPlayer.character]?.primary ?? '#ffffff',
        };
      }
    }
    return { name: id ?? '???', character: CHARACTERS[0].id, team: 0, bot: false, color: '#ffffff' };
  }

  ping(id: string): number | null {
    const player = this.lobby?.players.find((p) => p.id === id);
    return player ? player.ping : null;
  }

  click(): void {
    this.deps.audio.unlock();
    this.deps.audio.play('click', { vol: 0.7 });
  }

  hover(): void {
    const now = performance.now();
    if (now - this.lastHover < 60) return;
    this.lastHover = now;
    this.deps.audio.play('hover', { vol: 0.35 });
  }
}
