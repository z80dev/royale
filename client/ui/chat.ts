// Chat: embedded panel in the lobby; in-match it's a fading log (bottom-left) with an input opened by Enter.

import type { ChatMsg, UiContext } from './context';
import { h } from './dom';

const MAX_LINES = 60;
const SYSTEM_SENDERS = new Set(['', 'sys', 'system', 'server']);

export class Chat {
  readonly el: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private mode: 'lobby' | 'match' = 'lobby';

  constructor(private readonly ctx: UiContext) {
    this.log = h('div.chat-log');
    this.input = h('input.chat-input', {
      type: 'text',
      maxlength: 140,
      placeholder: 'say gm…  (Enter to send, Esc to close)',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    this.el = h(
      'div.chat.chat--lobby',
      null,
      this.log,
      h('div.chat-input-row', null, h('span.chat-caret', { text: '›' }), this.input),
    );
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.input.addEventListener('blur', () => {
      if (this.mode === 'match') this.el.classList.remove('open');
    });
    this.clear();
  }

  /** New room: drop the previous room's conversation. */
  clear(): void {
    this.log.replaceChildren();
    this.system('gm. welcome to Launchpad Royale — type "gm" and see who answers.');
  }

  setMode(mode: 'lobby' | 'match'): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.el.classList.toggle('chat--lobby', mode === 'lobby');
    this.el.classList.toggle('chat--match', mode === 'match');
    this.el.classList.remove('open');
    this.input.blur();
  }

  get focused(): boolean {
    return document.activeElement === this.input;
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open') || this.focused;
  }

  open(): void {
    this.el.classList.add('open');
    this.input.focus();
    this.log.scrollTop = this.log.scrollHeight;
  }

  close(): void {
    this.input.value = '';
    this.input.blur();
    this.el.classList.remove('open');
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (text) this.ctx.deps.send({ t: 'chat', text });
    this.input.value = '';
    if (this.mode === 'match') this.close();
  }

  add(msg: ChatMsg): void {
    if (SYSTEM_SENDERS.has(msg.from)) {
      this.system(msg.text, msg.color);
      return;
    }
    const mine = msg.from === this.ctx.selfId;
    const line = h(
      `div.chat-line${mine ? '.mine' : ''}`,
      null,
      h('span.chat-name', { text: msg.name, style: `color:${msg.color}` }),
      h('span.chat-text', { text: msg.text }),
    );
    this.push(line);
  }

  system(text: string, color?: string): void {
    this.push(h('div.chat-line.system', color ? { style: `--sys:${color}` } : null, h('span.chat-text', { text })));
  }

  private push(line: HTMLElement): void {
    const atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24;
    this.log.append(line);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    if (atBottom || this.mode === 'match') this.log.scrollTop = this.log.scrollHeight;
  }
}
