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
  }

  sample(): SampledInput {
    if (this.deps.wantsKeyboard()) {
      this.release();
      return { mx: 0, mz: 0, fire: false, dash: false };
    }
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
    switch (key) {
      case 'r': this.deps.send({ t: 'act', a: 'reload' }); break;
      case 'e': this.deps.send({ t: 'act', a: 'interact' }); break;
      case 'x': this.deps.send({ t: 'act', a: 'drop' }); break;
      case '1':
      case '2': this.deps.send({ t: 'act', a: 'slot', v: Number(key) - 1 }); break;
      case '3': this.deps.send({ t: 'act', a: 'stable' }); break;
      case '4': this.deps.send({ t: 'act', a: 'medkit' }); break;
      case 'q': {
        const ground = this.deps.pickGround(this.mouseX, this.mouseY);
        this.deps.send({ t: 'act', a: 'ability', x: ground.x, z: ground.z });
        break;
      }
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
      case '0': {
        const i = key === '0' ? 5 : Number(key) - 5;
        if (i < EMOTES.length) this.deps.send({ t: 'emote', i });
        break;
      }
    }
  };

  private readonly keyUp = (event: KeyboardEvent): void => {
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
    // Clicking the game world must hand the keyboard back to the game (e.g. after typing a name or chatting).
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
