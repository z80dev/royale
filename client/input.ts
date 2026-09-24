import { EMOTES, type ClientMsg, type Phase } from '../shared/protocol';

export interface InputDeps {
  send(msg: ClientMsg): void;
  wantsKeyboard(): boolean;
  pointerOverUi(event: MouseEvent): boolean;
  setScoreboard(show: boolean): void;
  pickGround(clientX: number, clientY: number): { x: number; z: number };
  phase(): Phase;
  isDead(): boolean;
  unlockAudio(): void;
  /** The loot / chest the server is currently prompting E for (sent with the interact so a lagged E still lands). */
  interactHint(): { loot?: number; chest?: number };
}

export interface SampledInput {
  mx: number;
  mz: number;
  fire: boolean;
  dash: boolean;
}

const KONAMI = '↑↑↓↓←→←→BA';
const SYMBOL_BY_KEY: Record<string, string> = {
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', b: 'B', a: 'A',
};
// Movement uses physical key positions (event.code) so WASD works on AZERTY/Dvorak too; arrows also move.
type MoveDir = 'up' | 'down' | 'left' | 'right';
const MOVE_BY_CODE: Record<string, MoveDir> = {
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
};

export class InputController {
  private readonly held = new Set<MoveDir>();
  mouseX = innerWidth / 2;
  mouseY = innerHeight / 2;
  private fire = false;
  private pendingFire = false;
  private pendingDash = false;
  private konami = '';
  private scoreboardOpen = false;
  /** `?keys` in the URL shows a live key-event log (for "my WASD doesn't work" reports). */
  private readonly keyLog = new URLSearchParams(location.search).has('keys') ? new KeyLog() : null;

  constructor(private readonly deps: InputDeps) {
    addEventListener('keydown', this.keyDown);
    addEventListener('keyup', this.keyUp);
    addEventListener('blur', this.blur);
    addEventListener('mousemove', this.mouseMove);
    addEventListener('mousedown', this.mouseDown);
    addEventListener('mouseup', this.mouseUp);
    addEventListener('wheel', this.wheel, { passive: false });
  }

  dispose(): void {
    removeEventListener('keydown', this.keyDown);
    removeEventListener('keyup', this.keyUp);
    removeEventListener('blur', this.blur);
    removeEventListener('mousemove', this.mouseMove);
    removeEventListener('mousedown', this.mouseDown);
    removeEventListener('mouseup', this.mouseUp);
    removeEventListener('wheel', this.wheel);
    this.keyLog?.el.remove();
  }

  sample(): SampledInput {
    if (this.deps.wantsKeyboard()) {
      this.release();
      return { mx: 0, mz: 0, fire: false, dash: false };
    }
    this.keyLog?.render(this.held);
    const sample = {
      mx: Number(this.held.has('right')) - Number(this.held.has('left')),
      mz: Number(this.held.has('down')) - Number(this.held.has('up')),
      fire: (this.fire || this.pendingFire) && this.deps.phase() === 'playing',
      dash: this.pendingDash,
    };
    this.pendingDash = false;
    this.pendingFire = false;
    return sample;
  }

  private showScoreboard(show: boolean): void {
    if (this.scoreboardOpen === show) return;
    this.scoreboardOpen = show;
    this.deps.setScoreboard(show);
  }

  private release(): void {
    this.held.clear();
    this.fire = false;
    this.pendingFire = false;
    this.pendingDash = false;
    this.showScoreboard(false);
  }

  private readonly keyDown = (event: KeyboardEvent): void => {
    this.keyLog?.push(event);
    this.deps.unlockAudio();
    if (event.metaKey || event.ctrlKey || event.altKey || this.deps.wantsKeyboard()) return;
    const key = event.key.toLowerCase();
    if (key === 'tab' || key === ' ' || key.startsWith('arrow')) event.preventDefault();
    if (!event.repeat) {
      const symbol = SYMBOL_BY_KEY[key];
      if (symbol) {
        this.konami = (this.konami + symbol).slice(-KONAMI.length);
        if (this.konami === KONAMI) {
          this.deps.send({ t: 'chat', text: '/lasereyes' });
          this.konami = '';
        }
      } else if (key !== 'shift') {
        this.konami = '';
      }
    }
    if (key === 'tab') {
      this.showScoreboard(true);
      return;
    }
    const move = MOVE_BY_CODE[event.code];
    if (this.deps.isDead() && (move === 'left' || move === 'right')) {
      if (!event.repeat) this.deps.send({ t: 'spectate', dir: move === 'left' ? -1 : 1 });
      return;
    }
    if (move) {
      this.held.add(move);
      return;
    }
    if (key === 'shift' || key === ' ') {
      if (!event.repeat && this.deps.phase() === 'playing') this.pendingDash = true;
      return;
    }
    if (event.repeat || this.deps.phase() !== 'playing' || this.deps.isDead()) return;
    // Action keys by physical position too (matches WASD on non-QWERTY layouts).
    switch (event.code) {
      case 'KeyR': this.deps.send({ t: 'act', a: 'reload' }); break;
      case 'KeyE': this.deps.send({ t: 'act', a: 'interact', ...this.deps.interactHint() }); break;
      case 'KeyX': this.deps.send({ t: 'act', a: 'drop' }); break;
      case 'Digit1':
      case 'Digit2': this.deps.send({ t: 'act', a: 'slot', v: event.code === 'Digit1' ? 0 : 1 }); break;
      case 'Digit3': this.deps.send({ t: 'act', a: 'stable' }); break;
      case 'Digit4': this.deps.send({ t: 'act', a: 'medkit' }); break;
      case 'KeyQ': {
        const ground = this.deps.pickGround(this.mouseX, this.mouseY);
        this.deps.send({ t: 'act', a: 'ability', x: ground.x, z: ground.z });
        break;
      }
      case 'Digit5':
      case 'Digit6':
      case 'Digit7':
      case 'Digit8':
      case 'Digit9':
      case 'Digit0': {
        const digit = Number(event.code.slice(5));
        const i = digit === 0 ? 5 : digit - 5;
        if (i < EMOTES.length) this.deps.send({ t: 'emote', i });
        break;
      }
    }
  };

  private readonly keyUp = (event: KeyboardEvent): void => {
    this.keyLog?.push(event);
    const move = MOVE_BY_CODE[event.code];
    if (move) this.held.delete(move);
    if (event.key === 'Tab') this.showScoreboard(false);
  };

  private readonly blur = (): void => this.release();

  private readonly mouseMove = (event: MouseEvent): void => {
    this.mouseX = event.clientX;
    this.mouseY = event.clientY;
  };

  private readonly mouseDown = (event: MouseEvent): void => {
    this.deps.unlockAudio();
    if (event.button !== 0 || this.deps.pointerOverUi(event)) return;
    // Clicking the game world hands the keyboard back to the game (e.g. after typing a name or chatting).
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    if (this.deps.phase() === 'deploy') {
      const point = this.deps.pickGround(event.clientX, event.clientY);
      this.deps.send({ t: 'deploy', x: point.x, z: point.z });
    } else if (this.deps.phase() === 'playing' && !this.deps.isDead()) {
      this.fire = true;
      this.pendingFire = true;
    }
  };

  private readonly mouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.fire = false;
  };

  private readonly wheel = (event: WheelEvent): void => {
    if (this.deps.phase() !== 'playing' || this.deps.isDead() || this.deps.wantsKeyboard()
      || this.deps.pointerOverUi(event)) return;
    event.preventDefault();
    this.deps.send({ t: 'act', a: 'swap' });
  };
}

/** Debug overlay (`?keys`): the last key events as the game sees them, plus the currently held directions. */
class KeyLog {
  readonly el = document.createElement('pre');
  private readonly lines: string[] = [];
  private heldText = '';

  constructor() {
    this.el.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:99999;margin:0;padding:8px 10px;max-width:520px;'
      + 'background:rgba(0,0,0,.8);color:#7CFF4F;font:11px/1.4 ui-monospace,monospace;pointer-events:none;';
    document.body.append(this.el);
  }

  push(event: KeyboardEvent): void {
    const active = document.activeElement;
    const focus = active ? `${active.tagName.toLowerCase()}${active.className ? `.${active.className}` : ''}` : '-';
    const mods = `${event.metaKey ? '⌘' : ''}${event.ctrlKey ? '⌃' : ''}${event.altKey ? '⌥' : ''}`;
    this.lines.push(
      `${event.type.padEnd(7)} key=${JSON.stringify(event.key)} code=${event.code} ${mods}`
        + `${event.repeat ? ' repeat' : ''}${event.isComposing ? ' composing' : ''} focus=${focus}`,
    );
    if (this.lines.length > 12) this.lines.shift();
    this.flush();
  }

  render(held: ReadonlySet<string>): void {
    const text = [...held].join(',') || 'none';
    if (text === this.heldText) return;
    this.heldText = text;
    this.flush();
  }

  private flush(): void {
    this.el.textContent = `held: ${this.heldText || 'none'}\n${this.lines.join('\n')}`;
  }
}
