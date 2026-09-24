// In-match HUD: top-left match stats + zone, bottom-center vitals / weapons / consumables / ability / dash,
// interaction prompt, channel + reload bars, damage vignettes, zone warning, spectating bar, emote hint.

import {
  AMMO_NAMES,
  CHARACTER_BY_ID,
  CONSUMABLES,
  DASH_COOLDOWN,
  MAX_ARMOR,
  MAX_HP,
  RARITY_COLORS,
  RARITY_NAMES,
  WEAPONS,
  ZONE_PHASES,
  type CharacterId,
} from '../../shared/constants';
import { EMOTES, ST, type SelfSnap, type SlotSnap } from '../../shared/protocol';
import type { FrameView, HudState, ViewPlayer } from '../view';
import type { UiContext } from './context';
import { badge, formatClock, formatPnl, h, setBadge, setStyle, setText, toggle } from './dom';

const RING_CIRCUMFERENCE = 2 * Math.PI * 17;

class SlotCard {
  readonly el: HTMLElement;
  private readonly name: HTMLElement;
  private readonly mag: HTMLElement;
  private readonly reserve: HTMLElement;
  private readonly rarity: HTMLElement;
  private readonly ring: SVGCircleElement;

  constructor(index: number) {
    this.name = h('div.slot-name');
    this.rarity = h('div.slot-rarity');
    this.mag = h('span.slot-mag');
    this.reserve = h('span.slot-res');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('class', 'slot-ring');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const c of [track, this.ring]) {
      c.setAttribute('cx', '20');
      c.setAttribute('cy', '20');
      c.setAttribute('r', '17');
    }
    track.setAttribute('class', 'ring-track');
    this.ring.setAttribute('class', 'ring-fill');
    this.ring.style.strokeDasharray = String(RING_CIRCUMFERENCE);
    svg.append(track, this.ring);
    this.el = h(
      'div.slot',
      null,
      h('kbd.slot-key', { text: String(index + 1) }),
      h(
        'div.slot-body',
        null,
        this.rarity,
        this.name,
        h('div.slot-ammo', null, this.mag, h('span.slot-sep', { text: '/' }), this.reserve),
      ),
      h('div.slot-reload', null, svg, h('span.slot-reload-text', { text: 'R' })),
    );
  }

  update(slot: SlotSnap | null, active: boolean, self: SelfSnap): void {
    toggle(this.el, 'empty', !slot);
    toggle(this.el, 'active', active && !!slot);
    if (!slot) {
      setText(this.name, 'empty slot');
      setText(this.rarity, '');
      setText(this.mag, '—');
      setText(this.reserve, '');
      setStyle(this.el, '--rar', 'rgba(255,255,255,0.15)');
      toggle(this.el, 'reloading', false);
      return;
    }
    const def = WEAPONS[slot.w];
    setStyle(this.el, '--rar', RARITY_COLORS[def.rarity]);
    setText(this.name, def.name);
    setText(this.rarity, RARITY_NAMES[def.rarity]);
    setText(this.mag, slot.mag);
    setText(this.reserve, self.ammo[def.ammo]);
    toggle(this.mag, 'low', slot.mag <= Math.max(1, Math.floor(def.mag * 0.25)));
    const reloading = active && self.reload > 0 && self.reloadTotal > 0;
    toggle(this.el, 'reloading', reloading);
    if (reloading) {
      const progress = 1 - self.reload / self.reloadTotal;
      this.ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
    }
  }
}

class ConsumableCard {
  readonly el: HTMLElement;
  private readonly count: HTMLElement;

  constructor(key: string, id: 'stable' | 'medkit', glyph: string) {
    this.count = h('span.cons-count');
    const def = CONSUMABLES[id];
    this.el = h(
      `div.cons.cons-${id}`,
      { title: `${def.name} — ${def.flavor}`, style: `--rar:${RARITY_COLORS[def.rarity]}` },
      h('kbd.slot-key', { text: key }),
      h('span.cons-glyph', { text: glyph }),
      this.count,
    );
  }

  update(count: number, channeling: boolean): void {
    setText(this.count, `×${count}`);
    toggle(this.el, 'empty', count <= 0);
    toggle(this.el, 'active', channeling);
  }
}

export class Hud {
  readonly el: HTMLElement;
  readonly topLeft: HTMLElement;
  // top-left
  private readonly aliveNum: HTMLElement;
  private readonly aliveLabel: HTMLElement;
  private readonly teamsBox: HTMLElement;
  private readonly teamsNum: HTMLElement;
  private readonly killsNum: HTMLElement;
  private readonly pnl: HTMLElement;
  private readonly blockNum: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly zoneName: HTMLElement;
  private readonly zoneGas: HTMLElement;
  private readonly zoneTimer: HTMLElement;
  private readonly zoneBar: HTMLElement;
  // bottom
  private readonly bottom: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpGhost: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly armorSegs: HTMLElement[] = [];
  private readonly armorText: HTMLElement;
  private readonly slots: [SlotCard, SlotCard];
  private readonly stable: ConsumableCard;
  private readonly medkit: ConsumableCard;
  private readonly ability: HTMLElement;
  private readonly abilityBadge: HTMLElement;
  private readonly abilityName: HTMLElement;
  private readonly abilityCd: HTMLElement;
  private readonly dash: HTMLElement;
  private readonly buffChip: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly progressLabel: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly prompt: HTMLElement;
  // overlays
  private readonly vignetteLow: HTMLElement;
  private readonly vignetteZone: HTMLElement;
  private readonly hurtFlash: HTMLElement;
  private readonly zoneWarn: HTMLElement;
  private readonly spectate: HTMLElement;
  private readonly spectateBadge: HTMLElement;
  private readonly spectateName: HTMLElement;
  private readonly spectateHp: HTMLElement;
  private readonly spectateNote: HTMLElement;
  private readonly emoteHint: HTMLElement;

  private hurt = 0;
  private ghostHp = MAX_HP;
  private abilityCharacter: CharacterId | null = null;
  private lastSelf: SelfSnap | null = null;

  constructor(private readonly ctx: UiContext) {
    // ── Top-left
    this.aliveNum = h('span.stat-num');
    this.aliveLabel = h('span.stat-label', { text: 'degens left' });
    this.teamsNum = h('span.stat-num');
    this.teamsBox = h('div.stat', null, this.teamsNum, h('span.stat-label', { text: 'teams' }));
    this.killsNum = h('span.stat-num');
    this.pnl = h('div.pnl-chip');
    this.blockNum = h('span.block-num');
    this.clock = h('span.block-clock');
    this.zoneName = h('div.zone-name');
    this.zoneGas = h('span.zone-gas');
    this.zoneTimer = h('span.zone-timer');
    this.zoneBar = h('div.zone-bar-fill');
    this.topLeft = h(
      'div.hud-tl',
      null,
      h(
        'div.stat-row.glass',
        null,
        h('div.stat.stat-alive', null, this.aliveNum, this.aliveLabel),
        this.teamsBox,
        h('div.stat.stat-kills', null, this.killsNum, h('span.stat-label', { text: 'kills' })),
      ),
      h('div.block-row', null, h('span.block-dot'), this.blockNum, this.clock, this.pnl),
      h(
        'div.zone-box.glass',
        null,
        h('div.zone-top', null, h('span.zone-icon', { text: '◎' }), this.zoneName),
        h('div.zone-mid', null, this.zoneTimer, this.zoneGas),
        h('div.zone-bar', null, this.zoneBar),
      ),
    );

    // ── Bottom center
    this.hpFill = h('div.hp-fill');
    this.hpGhost = h('div.hp-ghost');
    this.hpText = h('span.hp-text');
    this.armorText = h('span.armor-text');
    const armorRow = h('div.armor-row');
    for (let i = 0; i < 4; i++) {
      const seg = h('div.armor-seg', null, h('div.armor-seg-fill'));
      this.armorSegs.push(seg);
      armorRow.append(seg);
    }
    this.slots = [new SlotCard(0), new SlotCard(1)];
    this.stable = new ConsumableCard('3', 'stable', '$');
    this.medkit = new ConsumableCard('4', 'medkit', '❄');
    this.abilityBadge = badge('doppler', 'ability-badge');
    this.abilityName = h('div.ab-name');
    this.abilityCd = h('span.ab-cd');
    this.ability = h(
      'div.ability',
      null,
      h('div.ab-icon', null, this.abilityBadge, h('div.ab-sweep'), this.abilityCd, h('div.ab-buff')),
      h('div.ab-meta', null, h('kbd.slot-key', { text: 'Q' }), this.abilityName),
    );
    this.dash = h('div.dash', { title: 'Dash (Space / Shift)' }, h('span.dash-label', { text: 'DASH' }));
    this.buffChip = h('div.buff-chip.hidden');
    this.progressLabel = h('span.progress-label');
    this.progressFill = h('div.progress-fill');
    this.progress = h(
      'div.progress.hidden',
      null,
      this.progressLabel,
      h('div.progress-track', null, this.progressFill),
    );
    this.prompt = h('div.prompt.hidden');

    this.bottom = h(
      'div.hud-bottom',
      null,
      this.prompt,
      this.progress,
      this.buffChip,
      h(
        'div.vitals',
        null,
        h('div.armor-line', null, armorRow, this.armorText),
        h('div.hp-bar', null, this.hpGhost, this.hpFill, h('div.hp-ticks'), this.hpText),
      ),
      h(
        'div.loadout',
        null,
        this.slots[0].el,
        this.slots[1].el,
        h('div.cons-stack', null, this.stable.el, this.medkit.el),
        this.ability,
        this.dash,
      ),
    );

    // ── Overlays
    this.vignetteLow = h('div.vignette.vignette-low');
    this.vignetteZone = h('div.vignette.vignette-zone');
    this.hurtFlash = h('div.vignette.vignette-hurt');
    this.zoneWarn = h('div.zone-warn.hidden');

    this.spectateBadge = badge('doppler', 'spec-badge');
    this.spectateName = h('span.spec-name');
    this.spectateHp = h('div.spec-hp', null, h('div.spec-hp-fill'));
    this.spectateNote = h('div.spec-note');
    const prev = h('button.spec-btn.interactive', { title: 'Previous (←)', text: '←' });
    const next = h('button.spec-btn.interactive', { title: 'Next (→)', text: '→' });
    prev.addEventListener('click', () => {
      ctx.click();
      ctx.deps.send({ t: 'spectate', dir: -1 });
    });
    next.addEventListener('click', () => {
      ctx.click();
      ctx.deps.send({ t: 'spectate', dir: 1 });
    });
    this.spectate = h(
      'div.spectate.glass.hidden',
      null,
      prev,
      h(
        'div.spec-mid',
        null,
        h('div.spec-top', null, h('span.spec-eye', { text: 'SPECTATING' }), this.spectateBadge, this.spectateName),
        this.spectateHp,
        this.spectateNote,
      ),
      next,
    );

    this.emoteHint = h('div.emote-hint');
    EMOTES.slice(0, 6).forEach((text, i) =>
      this.emoteHint.append(h('span.emote-item', null, h('kbd', { text: String((i + 5) % 10) }), text)),
    );

    this.el = h(
      'div.hud',
      null,
      this.vignetteLow,
      this.vignetteZone,
      this.hurtFlash,
      this.zoneWarn,
      this.topLeft,
      this.bottom,
      this.spectate,
      this.emoteHint,
    );
  }

  /** Red flash when the local player takes damage. */
  onHurt(dmg: number): void {
    this.hurt = Math.min(1, this.hurt + 0.25 + dmg / 60);
  }

  /** Last private snapshot seen (death screen stats while dead). */
  get lastSelfSnap(): SelfSnap | null {
    return this.lastSelf;
  }

  resetMatch(): void {
    this.lastSelf = null;
    this.ghostHp = MAX_HP;
    this.hurt = 0;
  }

  update(view: FrameView, hud: HudState, dt: number, showSpectate: boolean): void {
    const self = hud.self;
    if (self) this.lastSelf = self;
    const selfPlayer = hud.selfPlayer;
    const playing = view.phase === 'playing';

    this.updateTopLeft(view, hud);

    const showBottom = !!self && !!selfPlayer && selfPlayer.alive && playing;
    toggle(this.bottom, 'hidden', !showBottom);
    toggle(this.emoteHint, 'hidden', !showBottom);
    if (showBottom && self && selfPlayer) this.updateBottom(view, self, selfPlayer);

    // Vignettes
    const hp = selfPlayer?.alive ? selfPlayer.hp : MAX_HP;
    const low = showBottom && hp <= 35 ? 1 - hp / 35 : 0;
    setStyle(this.vignetteLow, 'opacity', (showBottom && hp <= 35 ? 0.45 + low * 0.55 : 0).toFixed(3));
    toggle(this.vignetteLow, 'pulse', showBottom && hp <= 20);
    const inZone = showBottom && !!selfPlayer && (selfPlayer.st & ST.IN_ZONE_DMG) !== 0;
    setStyle(this.vignetteZone, 'opacity', inZone ? '1' : '0');
    toggle(this.zoneWarn, 'hidden', !inZone);
    if (inZone) {
      setText(this.zoneWarn, `⚠ OUTSIDE THE ZONE · gas ${Math.round(view.zone?.dps ?? 0)} gwei/s · get in, ser`);
    }
    this.hurt = Math.max(0, this.hurt - dt * 1.8);
    setStyle(this.hurtFlash, 'opacity', this.hurt.toFixed(3));

    this.updateSpectate(view, hud, showSpectate);
  }

  private updateTopLeft(view: FrameView, hud: HudState): void {
    setText(this.aliveNum, hud.aliveCount);
    setText(this.aliveLabel, hud.aliveCount === 1 ? 'degen left' : 'degens left');
    toggle(this.teamsBox, 'hidden', hud.teamSize <= 1);
    setText(this.teamsNum, hud.teamsAlive);
    const stats = hud.self ?? this.lastSelf;
    setText(this.killsNum, stats?.kills ?? 0);
    const score = stats?.score ?? 0;
    setText(this.pnl, `PnL ${formatPnl(score)}`);
    toggle(this.pnl, 'neg', score < 0);
    toggle(this.pnl, 'blaze', Math.round(score) === 420);
    const block = 840_000 + Math.floor(hud.matchTime);
    setText(this.blockNum, `Block #${block.toLocaleString('en-US')}`);
    setText(this.clock, formatClock(hud.matchTime));

    const zone = view.zone;
    if (!zone || view.phase === 'deploy' || zone.phase < 0) {
      setText(this.zoneName, view.phase === 'deploy' ? 'Dropping in…' : 'Zone forming');
      setText(this.zoneTimer, zone && zone.phase < 0 && zone.t > 0 ? `forms in ${formatClock(zone.t)}` : 'market open');
      setText(this.zoneGas, 'gas: 0 gwei');
      setStyle(this.zoneBar, 'transform', 'scaleX(0)');
      return;
    }
    const index = Math.min(zone.phase, ZONE_PHASES.length - 1);
    const def = ZONE_PHASES[index];
    setText(this.zoneName, `${def.name}`);
    setText(this.zoneTimer, `${zone.shrinking ? 'closing' : 'shrinks in'} ${formatClock(zone.t)}`);
    setText(this.zoneGas, `gas: ${Math.round(zone.dps)} gwei`);
    const total = zone.shrinking ? def.shrink : def.wait;
    const frac = total > 0 ? 1 - Math.max(0, Math.min(1, zone.t / total)) : 1;
    setStyle(this.zoneBar, 'transform', `scaleX(${frac.toFixed(3)})`);
    toggle(this.topLeft, 'zone-shrinking', zone.shrinking);
  }

  private updateBottom(view: FrameView, self: SelfSnap, player: ViewPlayer): void {
    // HP + armor
    const hp = Math.max(0, Math.min(MAX_HP, player.hp));
    const hpFrac = hp / MAX_HP;
    this.ghostHp = hp > this.ghostHp ? hp : this.ghostHp + (hp - this.ghostHp) * 0.06;
    setStyle(this.hpFill, 'transform', `scaleX(${hpFrac.toFixed(4)})`);
    setStyle(this.hpGhost, 'transform', `scaleX(${(this.ghostHp / MAX_HP).toFixed(4)})`);
    setStyle(this.hpFill, '--hp-hue', `${Math.round(hpFrac * 130)}`);
    setText(this.hpText, `${Math.ceil(hp)}`);
    const armor = Math.max(0, Math.min(MAX_ARMOR, player.ar));
    const segSize = MAX_ARMOR / this.armorSegs.length;
    this.armorSegs.forEach((seg, i) => {
      const fill = Math.max(0, Math.min(1, (armor - i * segSize) / segSize));
      setStyle(seg.firstElementChild as HTMLElement, 'transform', `scaleX(${fill.toFixed(3)})`);
    });
    setText(this.armorText, armor > 0 ? `${Math.ceil(armor)}` : '');

    // Weapons
    this.slots[0].update(self.slots[0], self.active === 0, self);
    this.slots[1].update(self.slots[1], self.active === 1, self);

    // Consumables
    this.stable.update(self.cons.stable, self.channel?.c === 'stable');
    this.medkit.update(self.cons.medkit, self.channel?.c === 'medkit');

    // Ability
    const character = player.character;
    const def = CHARACTER_BY_ID[character];
    if (this.abilityCharacter !== character) {
      this.abilityCharacter = character;
      setBadge(this.abilityBadge, character);
      setText(this.abilityName, def.ability.name);
      this.ability.setAttribute('title', `${def.ability.name} — ${def.ability.desc}`);
      setStyle(this.ability, '--brand', def.primary);
    }
    const cdFrac = def.ability.cooldown > 0 ? Math.max(0, Math.min(1, self.abilityCd / def.ability.cooldown)) : 0;
    setStyle(this.ability, '--cd', cdFrac.toFixed(3));
    setText(this.abilityCd, self.abilityCd > 0 ? Math.ceil(self.abilityCd) : '');
    toggle(this.ability, 'ready', self.abilityCd <= 0);
    const buffDur = def.ability.duration ?? 0;
    const buffFrac = self.buffT > 0 && buffDur > 0 ? Math.min(1, self.buffT / buffDur) : 0;
    setStyle(this.ability, '--buff', buffFrac.toFixed(3));
    toggle(this.buffChip, 'hidden', self.buffT <= 0);
    if (self.buffT > 0) {
      setText(this.buffChip, `${def.ability.name.toUpperCase()} · ${self.buffT.toFixed(1)}s`);
      setStyle(this.buffChip, '--brand', def.secondary);
    }

    // Dash
    const dashFrac = 1 - Math.max(0, Math.min(1, self.dashCd / DASH_COOLDOWN));
    setStyle(this.dash, '--dash', dashFrac.toFixed(3));
    toggle(this.dash, 'ready', self.dashCd <= 0);

    // Channel / reload progress
    if (self.channel) {
      const frac = 1 - self.channel.t / Math.max(0.01, self.channel.total);
      toggle(this.progress, 'hidden', false);
      toggle(this.progress, 'heal', true);
      setText(this.progressLabel, `using ${CONSUMABLES[self.channel.c].name} · ${self.channel.t.toFixed(1)}s`);
      setStyle(this.progressFill, 'transform', `scaleX(${frac.toFixed(3)})`);
    } else if (self.reload > 0 && self.reloadTotal > 0) {
      const frac = 1 - self.reload / self.reloadTotal;
      toggle(this.progress, 'hidden', false);
      toggle(this.progress, 'heal', false);
      setText(this.progressLabel, `reloading · ${self.reload.toFixed(1)}s`);
      setStyle(this.progressFill, 'transform', `scaleX(${frac.toFixed(3)})`);
    } else {
      toggle(this.progress, 'hidden', true);
    }

    // Interaction prompt
    let promptHtml = '';
    if (self.nearLoot !== null) {
      const item = view.loot.find((l) => l.id === self.nearLoot);
      if (item) {
        if (item.k === 'weapon') {
          const w = WEAPONS[item.w];
          const color = RARITY_COLORS[w.rarity];
          const full = self.slots[0] && self.slots[1];
          promptHtml =
            `<kbd>E</kbd><span class="pr-name" style="color:${color}">${w.name}</span>` +
            `<span class="pr-rar" style="color:${color}">${RARITY_NAMES[w.rarity]}</span>` +
            (full ? '<span class="pr-note">swap</span>' : '');
        } else if (item.k === 'ammo') {
          promptHtml = `<kbd>E</kbd><span class="pr-name">${item.n} ${AMMO_NAMES[item.a]}</span>`;
        } else {
          const c = CONSUMABLES[item.c];
          promptHtml =
            `<kbd>E</kbd><span class="pr-name" style="color:${RARITY_COLORS[c.rarity]}">` +
            `${item.n > 1 ? `${item.n}× ` : ''}${c.name}</span>`;
        }
      }
    } else if (self.nearChest !== null) {
      const chest = view.chests.find((c) => c.id === self.nearChest);
      if (chest && !chest.open) {
        promptHtml = chest.airdrop
          ? '<kbd>E</kbd><span class="pr-name" style="color:#FFB627">open Airdrop</span>' +
            '<span class="pr-rar">legendary</span>'
          : '<kbd>E</kbd><span class="pr-name">open Treasury</span><span class="pr-note">probably not a rug</span>';
      }
    }
    toggle(this.prompt, 'hidden', !promptHtml);
    if (promptHtml && this.prompt.dataset.html !== promptHtml) {
      this.prompt.dataset.html = promptHtml;
      this.prompt.innerHTML = promptHtml;
    }
  }

  private updateSpectate(view: FrameView, hud: HudState, show: boolean): void {
    const targetId = hud.spectating ?? (hud.self ? null : view.focusId);
    const target = targetId ? view.players.find((p) => p.id === targetId) : undefined;
    const visible = show && !!target && view.phase === 'playing';
    toggle(this.spectate, 'hidden', !visible);
    if (!visible || !target) return;
    setBadge(this.spectateBadge, target.character);
    setText(this.spectateName, target.name);
    setStyle(this.spectateName, 'color', CHARACTER_BY_ID[target.character]?.primary ?? '#fff');
    const fill = this.spectateHp.firstElementChild as HTMLElement;
    setStyle(fill, 'transform', `scaleX(${Math.max(0, target.hp / MAX_HP).toFixed(3)})`);
    setText(this.spectateNote, `${this.ctx.kills.get(target.id) ?? 0} kills · ←/→ to switch`);
  }
}
