// Death screen: "NGMI" glitch, killer + cause, placement, stats + PnL, Spectate / Hide.

import { CHARACTER_BY_ID, WEAPONS, type WeaponId } from '../../shared/constants';
import type { KillCause, SelfSnap } from '../../shared/protocol';
import type { HudState } from '../view';
import type { UiContext } from './context';
import { badge, formatClock, formatPnl, h, killSentenceForYou, setBadge, setText, toggle } from './dom';

const COPE = [
  'it’s just a dip. zoom out.',
  'have fun staying poor.',
  'this is fine. this is fine.',
  'down bad. still early though.',
  'unrealized losses are still losses, ser.',
  'you bought the top. again.',
  'funds are not safu.',
  'should have bought the dip. you were the dip.',
];

/** Verb-agnostic headline label above the killer's name (the server verb goes in the flavor line). */
const KILLER_LABEL: Record<KillCause, string> = {
  weapon: 'liquidated by',
  explosion: 'nuked by',
  ability: 'rekt by',
  turret: 'botted by',
  rug: 'rekt by',
  zone: 'rekt by',
};

/** Trailing flavor after the kill sentence, by cause (weapon kills quote the weapon instead). */
const CAUSE_TAIL: Record<KillCause, string> = {
  weapon: '',
  explosion: 'the explosive kind of moon',
  zone: 'should have rotated',
  ability: 'brand ability diff',
  rug: 'DYOR',
  turret: 'the AI took your job and your life',
};

export class DeathScreen {
  readonly el: HTMLElement;
  private readonly killerBadge: HTMLElement;
  private readonly killerName: HTMLElement;
  private readonly killerLine: HTMLElement;
  private readonly cause: HTMLElement;
  private readonly place: HTMLElement;
  private readonly kills: HTMLElement;
  private readonly damage: HTMLElement;
  private readonly survived: HTMLElement;
  private readonly pnl: HTMLElement;
  private readonly cope: HTMLElement;
  private readonly teamNote: HTMLElement;
  private shownFor: string | null = null; // death key so we only auto-open once per death
  private hidden = false;
  private lastKill: { killer: string | null; weapon: WeaponId | null; cause: KillCause; verb: string } | null = null;
  private diedAt = 0;

  constructor(private readonly ctx: UiContext) {
    this.killerBadge = badge('doppler', 'death-badge');
    this.killerName = h('span.death-killer-name');
    this.killerLine = h(
      'div.death-killer',
      null,
      h('span.death-by', { text: 'liquidated by' }),
      this.killerBadge,
      this.killerName,
    );
    this.cause = h('div.death-cause');
    this.place = h('div.death-place');
    this.kills = h('span.ds-val');
    this.damage = h('span.ds-val');
    this.survived = h('span.ds-val');
    this.pnl = h('span.ds-val');
    this.cope = h('div.death-cope');
    this.teamNote = h('div.death-team');
    const spectateBtn = h('button.btn.btn-primary', { text: 'SPECTATE ▸' });
    spectateBtn.addEventListener('click', () => {
      ctx.click();
      this.dismiss();
    });
    const hideBtn = h('button.btn.btn-ghost', { text: 'hide' });
    hideBtn.addEventListener('click', () => {
      ctx.click();
      this.dismiss();
    });
    this.el = h(
      'div.screen.death.hidden.interactive',
      null,
      h('div.death-scan'),
      h(
        'div.death-card',
        null,
        h('div.death-title', { 'data-text': 'NGMI' }, 'NGMI'),
        this.cope,
        this.killerLine,
        this.cause,
        this.place,
        h(
          'div.death-stats',
          null,
          h('div.ds', null, this.kills, h('span.ds-label', { text: 'kills' })),
          h('div.ds', null, this.damage, h('span.ds-label', { text: 'damage' })),
          h('div.ds', null, this.survived, h('span.ds-label', { text: 'survived' })),
          h('div.ds.ds-pnl', null, this.pnl, h('span.ds-label', { text: 'PnL' })),
        ),
        this.teamNote,
        h('div.death-actions', null, spectateBtn, hideBtn),
      ),
    );
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  reset(): void {
    this.shownFor = null;
    this.hidden = false;
    this.lastKill = null;
    toggle(this.el, 'hidden', true);
  }

  /** Remember how the local player died (the kill event carries the weapon + verb). */
  noteKill(killer: string | null, weapon: WeaponId | null, cause: KillCause, verb: string): void {
    this.lastKill = { killer, weapon, cause, verb };
  }

  dismiss(): void {
    this.hidden = true;
    toggle(this.el, 'hidden', true);
  }

  update(hud: HudState, lastSelf: SelfSnap | null, teammatesAlive: number, totalTeams: number, active: boolean): void {
    const death = hud.death;
    if (!death || !active) {
      if (!death) this.shownFor = null;
      toggle(this.el, 'hidden', true);
      return;
    }
    const key = `${death.killer ?? 'env'}:${death.cause}`;
    if (this.shownFor !== key) {
      this.shownFor = key;
      this.hidden = false;
      this.diedAt = hud.matchTime;
      this.cope.textContent = COPE[Math.floor(Math.random() * COPE.length)];
      this.ctx.deps.audio.play('defeat', { vol: 0.6 });
      this.el.classList.remove('play');
      void this.el.offsetWidth;
      this.el.classList.add('play');
    }
    toggle(this.el, 'hidden', this.hidden);
    if (this.hidden) return;

    const killerId = death.killer ?? this.lastKill?.killer ?? null;
    const selfId = this.ctx.selfId;
    const cause = (this.lastKill?.cause ?? death.cause) as KillCause;
    const weapon = this.lastKill?.weapon ?? null;
    const verb = this.lastKill?.verb ?? '';
    const weaponText = weapon ? `with the ${WEAPONS[weapon].name} · “${WEAPONS[weapon].flavor}”` : CAUSE_TAIL[cause];
    let flavor: string;
    if (killerId && killerId !== selfId) {
      const info = this.ctx.info(killerId);
      toggle(this.killerLine, 'hidden', false);
      setBadge(this.killerBadge, info.character);
      setText(this.killerName, info.name);
      this.killerName.style.color = CHARACTER_BY_ID[info.character]?.primary ?? '#fff';
      setText(this.killerLine.firstElementChild as HTMLElement, KILLER_LABEL[cause] ?? 'rekt by');
      const sentence = killSentenceForYou(info.name, verb || 'liquidated');
      flavor = weapon ? `${sentence} ${weaponText}` : `${sentence}${weaponText ? ` · ${weaponText}` : ''}`;
    } else {
      toggle(this.killerLine, 'hidden', true);
      // No killer: zone / rug verbs are victim-subject ("got liquidated by the zone"); own explosives = self-rekt.
      const sentence = killerId === selfId ? 'self-rekt' : verb ? `you ${verb}` : 'you got liquidated';
      flavor = weaponText ? `${sentence} · ${weaponText}` : sentence;
    }
    setText(this.cause, flavor);

    const unit = hud.teamSize > 1 ? 'teams' : 'degens';
    setText(
      this.place,
      death.place ? `#${death.place} of ${totalTeams} ${unit}` : `placing… ${totalTeams} ${unit} dropped`,
    );
    setText(this.kills, lastSelf?.kills ?? 0);
    setText(this.damage, Math.round(lastSelf?.damage ?? 0));
    setText(this.survived, formatClock(this.diedAt));
    const score = lastSelf?.score ?? 0;
    setText(this.pnl, formatPnl(score));
    toggle(this.pnl, 'neg', score < 0);
    toggle(this.teamNote, 'hidden', teammatesAlive <= 0);
    setText(this.teamNote, `${teammatesAlive} teammate${teammatesAlive === 1 ? '' : 's'} still alive — WAGMI?`);
  }
}
