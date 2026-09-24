// Kill feed (top-right under the minimap): killer [weapon] verb victim, brand-colored, fading.

import { WEAPONS, type WeaponId } from '../../shared/constants';
import type { KillCause } from '../../shared/protocol';
import type { UiContext } from './context';
import { badge, h, killVerbParts } from './dom';

const LIFETIME_MS = 7000;
const MAX_ENTRIES = 6;
const CAUSE_ICON: Record<KillCause, string> = {
  weapon: '',
  explosion: '💥',
  zone: '☠',
  ability: '⚡',
  rug: '🧶',
  turret: '🤖',
};

export class KillFeed {
  readonly el: HTMLElement;
  private readonly entries: { el: HTMLElement; at: number }[] = [];

  constructor(private readonly ctx: UiContext) {
    this.el = h('div.killfeed');
  }

  clear(): void {
    this.entries.length = 0;
    this.el.replaceChildren();
  }

  add(
    killer: string | null,
    victim: string,
    weapon: WeaponId | null,
    cause: KillCause,
    verb: string,
    myTeam: number,
  ): void {
    const selfId = this.ctx.selfId;
    const victimInfo = this.ctx.info(victim);
    const killerInfo = killer ? this.ctx.info(killer) : null;
    const nameEl = (id: string, info: typeof victimInfo) =>
      h(
        'span.kf-name',
        { style: `color:${info.color}` },
        badge(info.character, 'kf-badge'),
        h('span.kf-name-text', { text: id === selfId ? 'YOU' : info.name }),
      );

    const tool = weapon
      ? h('span.kf-weapon', { text: WEAPONS[weapon].name })
      : CAUSE_ICON[cause]
        ? h('span.kf-icon', { text: CAUSE_ICON[cause] })
        : null;
    let row: HTMLElement;
    if (killer && killerInfo) {
      const parts = killVerbParts(verb);
      row = h(
        'div.kf-row',
        null,
        nameEl(killer, killerInfo),
        tool,
        h('span.kf-verb', { text: parts.before }),
        nameEl(victim, victimInfo),
        parts.possessive ? h('span.kf-verb.kf-poss', { text: `'s ${parts.after}` }) : null,
        !parts.possessive && parts.after ? h('span.kf-verb', { text: parts.after }) : null,
      );
    } else {
      // Environmental deaths (zone, rug) use victim-subject verbs: "X got liquidated by the zone".
      row = h('div.kf-row', null, tool, nameEl(victim, victimInfo), h('span.kf-verb', { text: verb }));
    }
    if (killer === selfId) row.classList.add('mine');
    else if (victim === selfId) row.classList.add('me-dead');
    else if (myTeam > 0 && (victimInfo.team === myTeam || killerInfo?.team === myTeam)) row.classList.add('team');

    this.el.prepend(row);
    this.entries.unshift({ el: row, at: performance.now() });
    while (this.entries.length > MAX_ENTRIES) this.entries.pop()!.el.remove();
  }

  update(now: number): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      const age = now - entry.at;
      if (age > LIFETIME_MS) {
        entry.el.remove();
        this.entries.splice(i, 1);
      } else if (age > LIFETIME_MS - 800 && !entry.el.classList.contains('out')) {
        entry.el.classList.add('out');
      }
    }
  }
}
