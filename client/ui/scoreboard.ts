// Tab scoreboard: teams, alive/dead, kills, ping. Re-checked at ~4 Hz while held; rebuilt only when rows change.

import { CHARACTER_BY_ID } from '../../shared/constants';
import type { RosterEntry } from '../../shared/protocol';
import type { FrameView, HudState } from '../view';
import type { UiContext } from './context';
import { badge, h, setText, toggle } from './dom';

export class Scoreboard {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly summary: HTMLElement;
  private shown = false;
  private nextBuild = 0;
  private builtKey = '';

  constructor(private readonly ctx: UiContext) {
    this.body = h('div.sb-body');
    this.summary = h('span.sb-summary');
    this.el = h(
      'div.scoreboard.glass.hidden',
      null,
      h('div.sb-head', null, h('span.sb-title', { text: 'ORDER BOOK' }), this.summary),
      this.body,
      h('div.sb-foot', { text: 'hold Tab · not financial advice' }),
    );
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  setShown(show: boolean): void {
    this.shown = show;
    this.nextBuild = 0;
    this.builtKey = '';
    toggle(this.el, 'hidden', !show);
  }

  update(view: FrameView, hud: HudState, now: number): void {
    const active = this.shown && this.ctx.roster.size > 0;
    toggle(this.el, 'hidden', !active);
    if (!active || now < this.nextBuild) return;
    this.nextBuild = now + 250;

    const aliveById = new Map<string, boolean>();
    for (const p of view.players) aliveById.set(p.id, p.alive);
    const teams = new Map<number, RosterEntry[]>();
    for (const entry of this.ctx.roster.values()) {
      const list = teams.get(entry.team) ?? [];
      list.push(entry);
      teams.set(entry.team, list);
    }
    const kills = (id: string) => this.ctx.kills.get(id) ?? 0;
    const alive = (id: string) => aliveById.get(id) ?? false;
    const teamList = [...teams.entries()].map(([team, members]) => ({
      team,
      members: members.sort((a, b) => Number(alive(b.id)) - Number(alive(a.id)) || kills(b.id) - kills(a.id)),
      alive: members.filter((m) => alive(m.id)).length,
      kills: members.reduce((sum, m) => sum + kills(m.id), 0),
    }));
    teamList.sort((a, b) => Number(b.alive > 0) - Number(a.alive > 0) || b.kills - a.kills || a.team - b.team);
    // Rebuilding re-creates badge images (visible flicker), so skip when nothing shown has changed.
    const pingOf = (entry: RosterEntry) => (entry.bot ? -1 : Math.round((this.ctx.ping(entry.id) ?? -10) / 10));
    const key = JSON.stringify([
      hud.aliveCount,
      hud.teamsAlive,
      this.ctx.roster.size,
      teamList.map((t) => t.members.map((m) => [m.id, alive(m.id), kills(m.id), pingOf(m)])),
    ]);
    if (key === this.builtKey) return;
    this.builtKey = key;

    setText(
      this.summary,
      `${hud.aliveCount} alive${hud.teamSize > 1 ? ` · ${hud.teamsAlive} teams` : ''}` +
        ` · ${this.ctx.roster.size} dropped`,
    );
    const selfId = this.ctx.selfId;
    const row = (entry: RosterEntry) => {
      const isAlive = alive(entry.id);
      const ping = this.ctx.ping(entry.id);
      const def = CHARACTER_BY_ID[entry.character];
      return h(
        `div.sb-row${isAlive ? '' : '.dead'}${entry.id === selfId ? '.me' : ''}`,
        { style: `--brand:${def.primary}` },
        h('span.sb-status', { text: isAlive ? '●' : '✕', title: isAlive ? 'alive' : 'liquidated' }),
        badge(entry.character, 'row-badge'),
        h('span.sb-name', null, entry.name, entry.bot ? h('span.bot-tag', { text: 'BOT' }) : null),
        h('span.sb-brand', { text: def.name }),
        h('span.sb-kills', { text: String(kills(entry.id)) }),
        h('span.sb-ping', { text: entry.bot ? 'bot' : ping !== null ? `${Math.round(ping)}ms` : '—' }),
      );
    };
    // Each column carries its own header row so the labels line up with the rows under them.
    const header = () =>
      h(
        'div.sb-row.sb-colhead',
        null,
        h('span'),
        h('span'),
        h('span', { text: 'Degen' }),
        h('span', { text: 'Brand' }),
        h('span.sb-kills', { text: 'K' }),
        h('span.sb-ping', { text: 'Ping' }),
      );
    if (hud.teamSize <= 1) {
      const everyone = teamList.flatMap((t) => t.members);
      everyone.sort((a, b) => Number(alive(b.id)) - Number(alive(a.id)) || kills(b.id) - kills(a.id));
      const half = Math.ceil(everyone.length / 2);
      const columns = [everyone.slice(0, half), everyone.slice(half)].filter((list) => list.length > 0);
      this.body.replaceChildren(
        h('div.sb-grid', null, ...columns.map((list) => h('div.sb-team.sb-col', null, header(), ...list.map(row)))),
      );
      return;
    }
    this.body.replaceChildren(
      h(
        'div.sb-grid',
        null,
        ...teamList.map((t) =>
          h(
            `div.sb-team${t.alive === 0 ? '.wiped' : ''}${t.team === this.ctx.myTeam ? '.mine' : ''}`,
            null,
            h(
              'div.sb-team-head',
              null,
              h('span', { text: `TEAM ${t.team}` }),
              h('span.sb-team-meta', { text: t.alive === 0 ? 'wiped' : `${t.alive} alive · ${t.kills} kills` }),
            ),
            ...t.members.map(row),
          ),
        ),
      ),
    );
  }
}
