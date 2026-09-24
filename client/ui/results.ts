// End-of-match results: victory / GG title, podium, full results table, session leaderboard, lobby countdown.

import { CHARACTER_BY_ID, PHASE_TIMES } from '../../shared/constants';
import type { ResultEntry } from '../../shared/protocol';
import type { EndMsg, UiContext } from './context';
import { badge, formatPnl, h, ordinal, setText, toggle } from './dom';
import { renderBoardRows } from './lobby';

const CONFETTI_COLORS = ['#7CFFD4', '#0FAE85', '#FFB627', '#FF007A', '#8A63D2', '#3FA9FF', '#FFFFFF'];

export class ResultsScreen {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly podium: HTMLElement;
  private readonly table: HTMLElement;
  private readonly board: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly readyHint: HTMLElement;
  private readonly confetti: HTMLElement;
  private deadline = 0;

  constructor(private readonly ctx: UiContext) {
    this.title = h('h1.res-title');
    this.sub = h('div.res-sub');
    this.podium = h('div.podium');
    this.table = h('div.res-table');
    this.board = h('div.board-list');
    this.timer = h('span.res-timer');
    this.readyHint = h('span.res-ready-hint', null, ' · ready up for the next round — press ', h('kbd', { text: 'F' }));
    this.confetti = h('div.confetti');
    this.el = h(
      'div.screen.results.hidden.interactive',
      null,
      this.confetti,
      h('div.res-head', null, this.title, this.sub),
      this.podium,
      h(
        'div.res-body',
        null,
        h(
          'div.panel.glass.res-table-panel',
          null,
          h('div.panel-head', null, h('h3', { text: 'Final PnL' })),
          this.table,
        ),
        h(
          'div.panel.glass.res-board-panel',
          null,
          h(
            'div.panel-head',
            null,
            h('h3', { text: "This lobby's degens" }),
            h('span.panel-note', { text: 'session PnL' }),
          ),
          this.board,
        ),
      ),
      h('div.res-foot', null, 'back to the lobby in ', this.timer, this.readyHint),
    );
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  hide(): void {
    toggle(this.el, 'hidden', true);
    this.confetti.replaceChildren();
  }

  show(msg: EndMsg, teamSize: number): boolean {
    this.deadline = performance.now() + PHASE_TIMES.ended * 1000;
    const selfId = this.ctx.selfId;
    const sorted = [...msg.results].sort((a, b) => a.place - b.place || b.score - a.score || b.kills - a.kills);
    const mine = sorted.find((r) => r.id === selfId);
    const myTeam = mine?.team ?? this.ctx.myTeam;
    const won = msg.winnerTeam !== 0 && myTeam === msg.winnerTeam;
    const winners = sorted.filter((r) => r.team === msg.winnerTeam);

    toggle(this.el, 'won', won);
    this.title.replaceChildren();
    if (won) {
      this.title.append(
        h('span.res-line', { text: 'WINNER WINNER' }),
        h('span.res-line.res-gold', { text: 'LAMBO DINNER' }),
      );
      setText(
        this.sub,
        teamSize > 1 ? `WAGMI — Team ${msg.winnerTeam} took the whole bag` : 'you are the market now. screenshot this.',
      );
    } else {
      const winnerLabel =
        msg.winnerTeam === 0
          ? 'nobody'
          : teamSize > 1
            ? `Team ${msg.winnerTeam}`
            : (winners[0]?.name ?? `Team ${msg.winnerTeam}`);
      this.title.append(
        h('span.res-line', { text: 'GG' }),
        h('span.res-line.res-dim', { text: `${winnerLabel} took the bags` }),
      );
      setText(
        this.sub,
        mine
          ? `you placed ${ordinal(mine.place)} · ${formatPnl(mine.score)} PnL`
          : 'spectator mode: zero risk, zero reward',
      );
    }

    // Podium: 2nd · 1st · 3rd
    const top = sorted.slice(0, 3);
    const order = [top[1], top[0], top[2]];
    this.podium.replaceChildren(
      ...order.map((entry, i) => {
        if (!entry) return h('div.pod.pod-empty');
        const rank = i === 1 ? 1 : i === 0 ? 2 : 3;
        const def = CHARACTER_BY_ID[entry.character];
        return h(
          `div.pod.pod-${rank}${entry.id === selfId ? '.me' : ''}`,
          { style: `--brand:${def.primary};--brand2:${def.secondary}` },
          h('div.pod-crown', { text: rank === 1 ? '♛' : '' }),
          badge(entry.character, 'pod-badge'),
          h('div.pod-name', { text: entry.name }),
          h('div.pod-stats', { text: `${entry.kills} kills · ${formatPnl(entry.score)}` }),
          h('div.pod-block', null, h('span', { text: String(rank) })),
        );
      }),
    );

    this.renderTable(sorted, teamSize, selfId);
    this.board.replaceChildren(...renderBoardRows(msg.board, 10));
    toggle(this.el, 'hidden', false);
    this.el.classList.remove('play');
    void this.el.offsetWidth;
    this.el.classList.add('play');
    this.confetti.replaceChildren();
    if (won) this.spawnConfetti();
    return won;
  }

  private renderTable(sorted: ResultEntry[], teamSize: number, selfId: string | null): void {
    const head = h(
      'div.res-row.res-headrow',
      null,
      h('span', { text: '#' }),
      h('span', { text: 'Degen' }),
      h('span', { text: 'Brand' }),
      teamSize > 1 ? h('span', { text: 'Team' }) : null,
      h('span.num', { text: 'Kills' }),
      h('span.num', { text: 'Dmg' }),
      h('span.num', { text: 'PnL' }),
    );
    const rows = sorted.map((r) => {
      const def = CHARACTER_BY_ID[r.character];
      const score = Math.round(r.score);
      const blaze = score === 420;
      return h(
        `div.res-row${r.id === selfId ? '.me' : ''}${r.place === 1 ? '.first' : ''}`,
        { style: `--brand:${def.primary}` },
        h('span.res-place', { text: String(r.place) }),
        h(
          'span.res-name',
          null,
          badge(r.character, 'row-badge'),
          r.name,
          r.bot ? h('span.bot-tag', { text: 'BOT' }) : null,
        ),
        h('span.res-brand', { text: def.name }),
        teamSize > 1 ? h('span.res-team', { text: `T${r.team}` }) : null,
        h('span.num', { text: String(r.kills) }),
        h('span.num', { text: String(Math.round(r.damage)) }),
        h(`span.num.res-pnl${score < 0 ? '.neg' : ''}${blaze ? '.blaze' : ''}`, {
          text: blaze ? `${formatPnl(score)} 🌿 blaze it` : formatPnl(score),
        }),
      );
    });
    this.table.classList.toggle('teams', teamSize > 1);
    this.table.replaceChildren(head, ...rows);
  }

  private spawnConfetti(): void {
    const pieces: HTMLElement[] = [];
    for (let i = 0; i < 90; i++) {
      const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      const coin = i % 7 === 0;
      pieces.push(
        h(`i${coin ? '.coin' : ''}`, {
          text: coin ? '₿' : '',
          style:
            `left:${Math.random() * 100}%;--c:${color};--d:${(2.8 + Math.random() * 3).toFixed(2)}s;` +
            `--delay:${(Math.random() * 2.5).toFixed(2)}s;--x:${((Math.random() - 0.5) * 240).toFixed(0)}px;` +
            `--r:${Math.round(Math.random() * 720)}deg`,
        }),
      );
    }
    this.confetti.replaceChildren(...pieces);
  }

  update(now: number): void {
    if (!this.visible) return;
    const left = Math.max(0, Math.ceil((this.deadline - now) / 1000));
    setText(this.timer, `${left}s`);
    // Near the end, point at the next ready check (F works here; ready flags carry into the lobby).
    toggle(this.readyHint, 'show', left <= 8);
  }
}
