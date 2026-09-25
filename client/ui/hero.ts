// Shared title art: the animated LAUNCHPAD ROYALE logo and the "Connect Wallet" joke button.
// Used by the lobby browser (full hero) and the in-room lobby (compact, with the room bar as its sub-line).

import type { UiContext } from './context';
import { h } from './dom';

/** Default sub-line under the logo. */
export function heroCredit(): HTMLElement {
  return h('div.logo-sub', { text: 'an independent side project · not financial advice' });
}

/** Glitch/shine logo with a kicker line and the given sub-line. */
export function heroLogo(sub: HTMLElement): HTMLElement {
  return h(
    'div.logo',
    null,
    h('div.logo-kicker', { text: '◆ season 0 · genesis block ◆' }),
    h('h1.logo-title', { 'data-text': 'LAUNCHPAD' }, 'LAUNCHPAD'),
    h('h1.logo-title.logo-title--royale', { 'data-text': 'ROYALE' }, 'ROYALE'),
    sub,
  );
}

export function walletButton(ctx: UiContext): HTMLButtonElement {
  const button = h('button.wallet-btn', null, h('span.wallet-dot'), 'Connect Wallet');
  button.addEventListener('click', () => {
    ctx.click();
    ctx.toast('lol no. this is a game, ser', 'gold');
    button.classList.remove('nope');
    void button.offsetWidth;
    button.classList.add('nope');
  });
  return button;
}
