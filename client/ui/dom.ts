// Small DOM + formatting helpers shared by every UI module. No framework: elements are built once and
// mutated in place every frame (text/style only when a value actually changed).

import { CHARACTER_BY_ID, type CharacterId } from '../../shared/constants';

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

/** Create an element: `h('div.card.glass', { title: 'x' }, child…)`. Class names follow the tag after dots. */
export function h<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag as K);
  if (classes.length) el.className = classes.join(' ');
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === false) continue;
      if (key === 'text') el.textContent = String(value);
      else if (key === 'html') el.innerHTML = String(value);
      else if (key === 'style') el.setAttribute('style', String(value));
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

const textCache = new WeakMap<Node, string>();
/** Set textContent only when it changed (avoids layout churn in the per-frame HUD). */
export function setText(el: HTMLElement, text: string | number): void {
  const value = String(text);
  if (textCache.get(el) === value) return;
  textCache.set(el, value);
  el.textContent = value;
}

const styleCache = new WeakMap<HTMLElement, Map<string, string>>();
/** Set a style property / CSS custom property only when it changed. */
export function setStyle(el: HTMLElement, prop: string, value: string): void {
  let cache = styleCache.get(el);
  if (!cache) {
    cache = new Map();
    styleCache.set(el, cache);
  }
  if (cache.get(prop) === value) return;
  cache.set(prop, value);
  el.style.setProperty(prop, value);
}

export function toggle(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

/** "+$1,234" / "−$56" */
export function formatPnl(n: number): string {
  const rounded = Math.round(n);
  return `${rounded < 0 ? '−' : '+'}$${Math.abs(rounded).toLocaleString('en-US')}`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

export const TEAM_SIZE_LABELS = ['Solo', 'Duos', 'Trios', 'Squads', 'Fives', 'Sixes'] as const;
export const BOT_SKILL_LABELS = ['Paper Hands', 'Degen', 'Whale'] as const;

/** Brand badge element: brand-colored rounded square with the initial, real logo image layered on top. */
export function badge(id: CharacterId, extraClass = ''): HTMLElement {
  const def = CHARACTER_BY_ID[id] ?? CHARACTER_BY_ID.doppler;
  const el = h(`div.badge${extraClass ? `.${extraClass}` : ''}`, {
    style: `--brand:${def.primary};--brand2:${def.secondary}`,
  });
  el.append(h('span.badge-initial', { text: def.name.slice(0, 1) }));
  const img = h('img', { src: def.logo, alt: def.name, draggable: 'false' });
  img.addEventListener('error', () => img.remove(), { once: true });
  el.append(img);
  return el;
}

/** Swap an existing badge element to another brand (reuses the node). */
export function setBadge(el: HTMLElement, id: CharacterId): void {
  if (el.dataset.brand === id) return;
  el.dataset.brand = id;
  const def = CHARACTER_BY_ID[id] ?? CHARACTER_BY_ID.doppler;
  el.style.setProperty('--brand', def.primary);
  el.style.setProperty('--brand2', def.secondary);
  el.replaceChildren(h('span.badge-initial', { text: def.name.slice(0, 1) }));
  const img = h('img', { src: def.logo, alt: def.name, draggable: 'false' });
  img.addEventListener('error', () => img.remove(), { once: true });
  el.append(img);
}

// ── Badge images for <canvas> drawing (minimap, deploy map, name tags) ──
const badgeImages = new Map<CharacterId, HTMLImageElement>();
function badgeImage(id: CharacterId): HTMLImageElement {
  let img = badgeImages.get(id);
  if (!img) {
    img = new Image();
    img.src = CHARACTER_BY_ID[id].logo;
    badgeImages.set(id, img);
  }
  return img;
}

/** Draw a brand badge into a 2D canvas; falls back to the colored initial until/unless the PNG loads. */
export function drawBadge(ctx: CanvasRenderingContext2D, id: CharacterId, x: number, y: number, size: number): void {
  const def = CHARACTER_BY_ID[id] ?? CHARACTER_BY_ID.doppler;
  const img = badgeImage(def.id);
  if (img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, x, y, size, size);
    return;
  }
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, size * 0.22);
  ctx.fillStyle = def.primary;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${Math.round(size * 0.55)}px "Space Grotesk", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(def.name.slice(0, 1), x + size / 2, y + size / 2 + size * 0.04);
}

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode / quota: settings just won't persist
  }
}

/**
 * Global UI scale (CSS zoom of the .ui-scaled layer), set by Ui on resize. Canvases inside that layer are
 * measured in local (unzoomed) CSS px, so their backing store must include the zoom to stay crisp.
 */
export const uiScale = { value: 1 };

/** Canvas sized for DPR × UI scale; returns that factor so callers can draw in local CSS px. */
export function fitCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): number {
  const dpr = Math.min(3, Math.min(2, window.devicePixelRatio || 1) * uiScale.value);
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const hgt = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== w || canvas.height !== hgt) {
    canvas.width = w;
    canvas.height = hgt;
  }
  return dpr;
}

/** Hex "#RRGGBB" → "rgba(r,g,b,a)". */
export function hexAlpha(hex: string, alpha: number): string {
  const v = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
}

export interface KillVerbParts {
  before: string; // text between killer and victim
  after: string; // text after the victim
  possessive: boolean; // victim is possessive: "blew up X's bags"
}

/**
 * Split a server kill verb (shared/constants KILL_VERBS + server extras) around its object:
 * "sent to the moon" → sent ▢ to the moon; "blew up the bags of" → blew up ▢'s bags; "rugged" → rugged ▢.
 */
export function killVerbParts(verb: string): KillVerbParts {
  const toThe = /^(.+?) (to the .+)$/.exec(verb);
  if (toThe) return { before: toThe[1], after: toThe[2], possessive: false };
  const theOf = /^(.+?) the (\w+) of$/.exec(verb);
  if (theOf) return { before: theOf[1], after: theOf[2], possessive: true };
  return { before: verb, after: '', possessive: false };
}

/** "SandwichSam blew up your bags" style sentence with the reader as the victim. */
export function killSentenceForYou(killerName: string, verb: string): string {
  const parts = killVerbParts(verb);
  const object = parts.possessive ? `your ${parts.after}` : parts.after ? `you ${parts.after}` : 'you';
  return `${killerName} ${parts.before} ${object}`;
}
