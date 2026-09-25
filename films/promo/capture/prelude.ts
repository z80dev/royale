// Capture prelude: runs before the game bundle (classic script). Replaces the page clock, timers,
// requestAnimationFrame and WebSocket so capture.ts advances the renderer, interpolation, particles
// and UI on a virtual clock, one exact source-frame step at a time.

type Vec = [number, number, number];
/** Camera override, evaluated in clip-local seconds (0 = first captured frame). */
export type CamSpec =
  | { mode: 'game' }
  | {
      mode: 'path';
      keys: { t: number; pos: Vec; look: Vec; fov?: number }[];
      /** Aim at a sky actor (whale / MEV drone n) — look keys become offsets from it; `ride` offsets pos too. */
      track?: 'whale' | 'drone0' | 'drone1' | 'drone2' | 'drone3' | 'drone4' | 'drone5';
      ride?: boolean;
    }
  | {
      mode: 'track';
      keys: { t: number; pos: Vec; fov?: number }[];
      lookOffset?: Vec; // offset from the focus player's interpolated position
      rate?: number; // target damping (1/s)
    }
  | {
      mode: 'orbit';
      center: Vec;
      radius: number;
      height: number;
      yaw: number; // degrees at t=0
      yawSpeed: number; // degrees/s
      radiusSpeed?: number; // m/s
      heightSpeed?: number; // m/s
      lookY?: number;
      fov?: number;
    }
  | {
      mode: 'follow';
      dist: number;
      pitch: number; // degrees above horizon
      yaw: number; // degrees
      yawSpeed?: number;
      distSpeed?: number;
      lookY?: number;
      rate?: number; // target damping (1/s)
      fov?: number;
    };

interface Timer {
  id: number;
  at: number;
  fn: TimerHandler;
  args: unknown[];
  every: number | null;
}

interface V3 {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): V3;
  copy(v: V3): V3;
  lerp(v: V3, a: number): V3;
}
interface RigLike {
  camera: { position: V3; fov: number; up: V3; lookAt(v: V3): void; updateMatrixWorld(): void; updateProjectionMatrix(): void };
  target: V3;
  groundRadius: number;
  trauma: number;
  update(view: ViewLike, dt: number, time: number): void;
  measureGroundRadius(): number;
}
interface ViewPlayerLike {
  id: string;
  x: number;
  y: number;
  z: number;
  aim: number;
  alive: boolean;
  isSelf: boolean;
}
interface ViewLike {
  focus: { x: number; y: number; z: number };
  focusId: string | null;
  players: ViewPlayerLike[];
  cameraMode: string;
}
interface BokehLike {
  uniforms: { focus: { value: number } };
}
interface LrHandles {
  state: { reconcile(self: unknown): void; prediction: unknown; pending: unknown[]; correctionX: number; correctionZ: number };
  renderer: {
    rig: RigLike;
    sky: { whale: { position: V3 }; drones: { group: { position: V3 } }[] };
    project(x: number, y: number, z: number): { x: number; y: number; visible: boolean };
  };
  input: { mouseX: number; mouseY: number };
  BokehPass: new (scene: unknown, camera: RigLike['camera'], params: { focus: number; aperture: number; maxblur?: number }) => BokehLike;
  cinema: { scene: unknown; post: { composer: { insertPass(pass: BokehLike, index: number): void } } };
  map: { obstacles: { type: string; x: number; z: number; h: number; hw?: number; hd?: number; r?: number }[] };
}

const params = new URLSearchParams(location.search);
const DATE0 = Number(params.get('date0') ?? Date.parse('2026-09-24T20:00:00Z'));
let vt = 0;

// ── clock ──
performance.now = () => vt;
const RealDate = Date;
class VirtualDate extends RealDate {
  constructor(...args: [] | [string | number | Date]) {
    if (args.length === 0) super(DATE0 + vt);
    else super(args[0]);
  }
  static override now(): number {
    return DATE0 + vt;
  }
}
globalThis.Date = VirtualDate as DateConstructor;

// ── timers ──
let timerSeq = 1;
const timers = new Map<number, Timer>();
const addTimer = (fn: TimerHandler, ms: number | undefined, args: unknown[], every: boolean): number => {
  const id = timerSeq++;
  const delay = Math.max(0, Number(ms) || 0);
  timers.set(id, { id, at: vt + delay, fn, args, every: every ? Math.max(1, delay) : null });
  return id;
};
const setTimeoutV = (fn: TimerHandler, ms?: number, ...args: unknown[]): number => addTimer(fn, ms, args, false);
const setIntervalV = (fn: TimerHandler, ms?: number, ...args: unknown[]): number => addTimer(fn, ms, args, true);
const clearTimerV = (id?: number): void => {
  if (id !== undefined) timers.delete(id);
};
globalThis.setTimeout = setTimeoutV as typeof setTimeout;
globalThis.setInterval = setIntervalV as typeof setInterval;
globalThis.clearTimeout = clearTimerV as typeof clearTimeout;
globalThis.clearInterval = clearTimerV as typeof clearInterval;

function runTimers(): void {
  for (let guard = 0; guard < 10_000; guard++) {
    let next: Timer | null = null;
    for (const t of timers.values()) if (t.at <= vt && (!next || t.at < next.at)) next = t;
    if (!next) return;
    if (next.every === null) timers.delete(next.id);
    else next.at += next.every;
    try {
      if (typeof next.fn === 'function') next.fn(...next.args);
    } catch (err) {
      console.error('[capture] timer error', err);
    }
  }
}

// ── animation frames ──
let rafSeq = 1;
let rafQueue = new Map<number, FrameRequestCallback>();
window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  const id = rafSeq++;
  rafQueue.set(id, cb);
  return id;
};
window.cancelAnimationFrame = (id: number): void => {
  rafQueue.delete(id);
};

// ── socket: stays CONNECTING-free; the driver pushes recorded server messages ──
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(readonly url: string) {
    sockets.push(this);
    setTimeoutV(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    }, 0);
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}
const sockets: FakeSocket[] = [];
globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;

// Keep the WebGL frame in the canvas until the next draw so a CDP screenshot always composites the frame of the
// step it follows (UI clips), never a discarded / half-finished buffer.
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, options?: object) {
  const opts = kind === 'webgl2' || kind === 'webgl' ? { ...options, preserveDrawingBuffer: true } : options;
  return getContext.call(this, kind as '2d', opts as CanvasRenderingContext2DSettings);
} as typeof getContext;

// Several game shaders call pow() on a base that can dip a hair below 0 at grazing angles — `1.0 - vUv.y` on the
// map-edge railing (ground.ts) and HQ beacons (hq.ts), `1.0 - abs(dot(n, v))` rims on the sky whale (sky.ts) …
// pow(negative) = NaN, and UnrealBloom's mip chain smears one NaN pixel into a black block or a whole black frame.
// Capture-only fix at compile time (the game source is untouched): clamp every pow() base at 0 (a negative base is
// undefined in GLSL anyway), and drop any NaN/Inf that still reaches the bloom high-pass.
function clampPowBases(source: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const at = source.indexOf('pow(', i);
    if (at < 0) return out + source.slice(i);
    const prev = source[at - 1] ?? ' ';
    out += source.slice(i, at + 4);
    i = at + 4;
    if (/[\w.]/.test(prev)) continue; // e.g. "mypow(" — not the builtin
    let depth = 0;
    let j = i;
    for (; j < source.length; j++) {
      const ch = source[j];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) break;
      if (depth < 0) break;
    }
    if (source[j] !== ',') continue;
    out += `max(${source.slice(i, j)}, 0.0)`;
    i = j;
  }
}
const BLOOM_TEXEL = 'vec4 texel = texture2D( tDiffuse, vUv );';
const shaderSource = WebGL2RenderingContext.prototype.shaderSource;
WebGL2RenderingContext.prototype.shaderSource = function (this: WebGL2RenderingContext, shader: WebGLShader, source: string) {
  let patched = clampPowBases(source);
  if (patched.includes('luminosityThreshold') && patched.includes(BLOOM_TEXEL)) {
    patched = patched.replace(
      BLOOM_TEXEL,
      `${BLOOM_TEXEL}\n\tif (any(isnan(texel)) || any(isinf(texel))) texel = vec4(0.0);`,
    );
  }
  shaderSource.call(this, shader, patched);
};

// ── CSS / Web Animations: paused and advanced by hand ──
const seenAnimations = new WeakSet<Animation>();
function stepAnimations(dt: number): void {
  for (const a of document.getAnimations()) {
    if (!seenAnimations.has(a)) {
      seenAnimations.add(a);
      a.pause();
      a.currentTime = 0;
    } else if (a.playState === 'paused') {
      a.currentTime = Number(a.currentTime ?? 0) + dt;
    }
  }
}

// ── camera director ──
let cam: CamSpec = { mode: 'game' };
let clipStart = 0;
let baseFov = 0;
let noShake = false;
let smoothFocus: Vec | null = null;
let smoothAim: Vec | null = null;
let lastView: ViewLike | null = null;
let installed = false;
let dof: { focus?: 'subject' | number; subjectPoint?: [number, number] } | null = null;
let bokeh: BokehLike | null = null;

function catmull(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}
const easeInOut = (u: number): number => u * u * (3 - 2 * u);

function samplePath(keys: { t: number; pos: Vec; look?: Vec; fov?: number }[], t: number): { pos: Vec; look?: Vec; fov?: number } {
  if (t <= keys[0]!.t) return keys[0]!;
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]!.t <= t) i++;
  const k1 = keys[i]!;
  const k2 = keys[i + 1]!;
  const k0 = keys[i - 1] ?? k1;
  const k3 = keys[i + 2] ?? k2;
  // Ease only the first and last segments so the move starts/lands softly and flows through the middle.
  let u = (t - k1.t) / (k2.t - k1.t);
  if (keys.length === 2) u = easeInOut(u);
  const pos: Vec = [0, 0, 0];
  const look: Vec | undefined = k1.look && k2.look && k0.look && k3.look ? [0, 0, 0] : undefined;
  for (let c = 0; c < 3; c++) {
    pos[c] = catmull(k0.pos[c]!, k1.pos[c]!, k2.pos[c]!, k3.pos[c]!, u);
    if (look) look[c] = catmull(k0.look![c]!, k1.look![c]!, k2.look![c]!, k3.look![c]!, u);
  }
  const fov = k1.fov !== undefined && k2.fov !== undefined ? k1.fov + (k2.fov - k1.fov) * u : k1.fov;
  return { pos, look, fov };
}

function smoothedFocus(view: ViewLike, x: number, y: number, z: number, rate: number, dt: number): Vec {
  const f = view.focus;
  if (!smoothFocus) smoothFocus = [f.x + x, f.y + y, f.z + z];
  else {
    const k = 1 - Math.exp(-dt * rate);
    smoothFocus[0] += (f.x + x - smoothFocus[0]) * k;
    smoothFocus[1] += (f.y + y - smoothFocus[1]) * k;
    smoothFocus[2] += (f.z + z - smoothFocus[2]) * k;
  }
  return smoothFocus;
}

/** Keep short chase cameras above the ground and between the subject and the nearest solid wall. */
function clearChasePosition(pos: Vec, look: Vec): void {
  pos[1] = Math.max(1.6, pos[1]);
  const dx = pos[0] - look[0], dy = pos[1] - look[1], dz = pos[2] - look[2];
  let clear = 1;
  for (const o of lr().map.obstacles) {
    if (o.h < 2.2) continue;
    const hx = o.type === 'box' ? o.hw! : o.r!;
    const hz = o.type === 'box' ? o.hd! : o.r!;
    const minX = o.x - hx - 0.35, maxX = o.x + hx + 0.35;
    const minZ = o.z - hz - 0.35, maxZ = o.z + hz + 0.35;
    // The subject can stand inside a decorative prop; don't collapse the camera onto it in that case.
    if (look[0] > minX && look[0] < maxX && look[2] > minZ && look[2] < maxZ && look[1] < o.h) continue;
    let near = 0, far = clear;
    if (Math.abs(dx) < 1e-9) {
      if (look[0] < minX || look[0] > maxX) continue;
    } else {
      const a = (minX - look[0]) / dx, b = (maxX - look[0]) / dx;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
    }
    if (near > far) continue;
    if (Math.abs(dz) < 1e-9) {
      if (look[2] < minZ || look[2] > maxZ) continue;
    } else {
      const a = (minZ - look[2]) / dz, b = (maxZ - look[2]) / dz;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
    }
    if (near > far) continue;
    if (Math.abs(dy) < 1e-9) {
      if (look[1] < 0 || look[1] > o.h + 0.35) continue;
    } else {
      const a = -look[1] / dy, b = (o.h + 0.35 - look[1]) / dy;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
    }
    if (near <= far) clear = Math.max(0.15, Math.min(clear, near - 0.08));
  }
  if (clear < 1) {
    pos[0] = look[0] + dx * clear;
    pos[1] = Math.max(1.6, look[1] + dy * clear);
    pos[2] = look[2] + dz * clear;
  }
}

function updateDof(camera: RigLike['camera'], view: ViewLike): void {
  if (!bokeh || !dof) return;
  if (typeof dof.focus === 'number') { bokeh.uniforms.focus.value = dof.focus; return; }
  const focus = view.focus;
  const x = dof.subjectPoint && cam.mode === 'orbit' ? dof.subjectPoint[0] : focus.x;
  const y = dof.subjectPoint && cam.mode === 'orbit' ? cam.center[1] + (cam.lookY ?? 1) : focus.y + 1;
  const z = dof.subjectPoint && cam.mode === 'orbit' ? dof.subjectPoint[1] : focus.z;
  bokeh.uniforms.focus.value = Math.hypot(camera.position.x - x, camera.position.y - y, camera.position.z - z);
}

function applyCamera(rig: RigLike, view: ViewLike, dt: number): void {
  if (cam.mode === 'game') {
    if (baseFov && rig.camera.fov !== baseFov) {
      rig.camera.fov = baseFov;
      rig.camera.updateProjectionMatrix();
    }
    updateDof(rig.camera, view);
    return;
  }
  const t = (vt - clipStart) / 1000;
  let pos: Vec;
  let look: Vec;
  let fov: number | undefined;
  if (cam.mode === 'path') {
    const sampled = samplePath(cam.keys, t);
    ({ pos, fov } = sampled);
    look = sampled.look!;
    if (cam.track) {
      const sky = lr().renderer.sky;
      const at = cam.track === 'whale' ? sky.whale.position : sky.drones[Number(cam.track.slice(5))]?.group.position;
      if (at) {
        look = [at.x + look[0], at.y + look[1], at.z + look[2]];
        if (cam.ride) pos = [at.x + pos[0], at.y + pos[1], at.z + pos[2]];
      }
    }
  } else if (cam.mode === 'track') {
    ({ pos, fov } = samplePath(cam.keys, t));
    look = smoothedFocus(view, cam.lookOffset?.[0] ?? 0, cam.lookOffset?.[1] ?? 1, cam.lookOffset?.[2] ?? 0, cam.rate ?? 5, dt);
  } else if (cam.mode === 'orbit') {
    const yaw = ((cam.yaw + cam.yawSpeed * t) * Math.PI) / 180;
    const r = cam.radius + (cam.radiusSpeed ?? 0) * t;
    const hgt = cam.height + (cam.heightSpeed ?? 0) * t;
    const [cx, cy, cz] = cam.center;
    pos = [cx + Math.cos(yaw) * r, cy + hgt, cz + Math.sin(yaw) * r];
    look = [cx, cy + (cam.lookY ?? 0), cz];
    fov = cam.fov;
  } else {
    look = smoothedFocus(view, 0, cam.lookY ?? 1, 0, cam.rate ?? 5, dt);
    const yaw = ((cam.yaw + (cam.yawSpeed ?? 0) * t) * Math.PI) / 180;
    const pitch = (cam.pitch * Math.PI) / 180;
    const d = cam.dist + (cam.distSpeed ?? 0) * t;
    pos = [
      look[0] + Math.cos(pitch) * Math.cos(yaw) * d,
      look[1] + Math.sin(pitch) * d,
      look[2] + Math.cos(pitch) * Math.sin(yaw) * d,
    ];
    if (cam.pitch <= 15 && d <= 10) clearChasePosition(pos, look);
    else if (pos[1] < 1.6) pos[1] = 1.6;
    fov = cam.fov;
  }
  const camera = rig.camera;
  if (!baseFov) baseFov = camera.fov;
  const wantFov = fov ?? baseFov;
  if (camera.fov !== wantFov) {
    camera.fov = wantFov;
    camera.updateProjectionMatrix();
  }
  rig.target.set(look[0], look[1], look[2]);
  camera.position.set(pos[0], pos[1], pos[2]);
  camera.up.set(0, 1, 0);
  camera.lookAt(rig.target);
  camera.updateMatrixWorld();
  updateDof(camera, view);
  rig.groundRadius = rig.measureGroundRadius();
  if (noShake) rig.trauma = 0;
}

function lr(): LrHandles {
  return (globalThis as unknown as { __LR: LrHandles }).__LR;
}

function install(): void {
  if (installed) return;
  installed = true;
  const { state, renderer } = lr();
  // Replay: no local input, so render our own player interpolated like everyone else (no prediction).
  state.reconcile = () => {
    state.prediction = null;
    state.pending.length = 0;
    state.correctionX = state.correctionZ = 0;
  };
  const rig = renderer.rig;
  const update = rig.update.bind(rig);
  rig.update = (view, dt, time) => {
    lastView = view;
    update(view, dt, time);
    applyCamera(rig, view, dt);
  };
}

/** Park the mouse where "our" player aims (smoothed), so the play camera leads naturally and the crosshair sits on target. */
function aimMouse(dt: number): void {
  const view = lastView;
  const { input, renderer } = lr();
  const me = view?.players.find((p) => p.isSelf && p.alive);
  if (!me) return;
  const want: Vec = [me.x + Math.cos(me.aim) * 9, 0.5, me.z + Math.sin(me.aim) * 9];
  if (!smoothAim) smoothAim = want;
  else {
    const k = 1 - Math.exp(-dt * 6);
    for (let c = 0; c < 3; c++) smoothAim[c]! += (want[c]! - smoothAim[c]!) * k;
  }
  const p = renderer.project(smoothAim[0], smoothAim[1], smoothAim[2]);
  input.mouseX = p.x;
  input.mouseY = p.y;
}

let pixels: Uint8Array<ArrayBuffer> | null = null;

/** Reads the just-rendered WebGL frame (same task as the render, so the drawing buffer is still valid) and POSTs
 * the raw bottom-up RGBA to the driver's HTTP server. */
function grabFrame(): Promise<number> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game canvas')!;
  const gl = canvas.getContext('webgl2')!;
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  if (!pixels || pixels.length !== w * h * 4) pixels = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return fetch(`/frame?w=${w}&h=${h}`, { method: 'POST', body: pixels }).then((r) => r.status);
}

const capture = {
  /**
   * Advance the virtual clock by dtMs: timers, then recorded messages, then one animation frame.
   * grab = also ship the rendered WebGL frame to the driver (resolves once it is written).
   */
  step(dtMs: number, msgs: string[], render = true, grab = false): number | Promise<number> {
    vt += dtMs;
    runTimers();
    const socket = sockets[sockets.length - 1];
    for (const data of msgs) socket?.onmessage?.(new MessageEvent('message', { data }));
    if (installed) aimMouse(dtMs / 1000);
    if (render) {
      const queue = rafQueue;
      rafQueue = new Map();
      for (const cb of queue.values()) {
        try {
          cb(vt);
        } catch (err) {
          console.error('[capture] frame error', err);
        }
      }
    }
    const grabbed = render && grab ? grabFrame() : null;
    if (render && !grab) document.querySelector<HTMLCanvasElement>('#game canvas')?.getContext('webgl2')?.finish();
    stepAnimations(dtMs);
    return grabbed ?? vt;
  },
  install,
  setCamera(spec: CamSpec, startMs: number, opts: {
    noShake?: boolean;
    dof?: { aperture: number; maxblur?: number; focus?: 'subject' | number };
    subjectPoint?: [number, number];
  } = {}): void {
    cam = spec;
    clipStart = startMs;
    noShake = !!opts.noShake;
    smoothFocus = null;
    if (opts.dof) {
      const { cinema, BokehPass, renderer } = lr();
      // HDR half-float scene → DOF → bloom → OutputPass tone map → lens/AA.
      // Blur before bloom lets defocused neon bleed naturally without blurring the final film grain.
      bokeh = new BokehPass(cinema.scene, renderer.rig.camera, {
        focus: 1, aperture: opts.dof.aperture, maxblur: opts.dof.maxblur ?? 0.012,
      });
      cinema.post.composer.insertPass(bokeh, 1);
      dof = { focus: opts.dof.focus, subjectPoint: opts.subjectPoint };
    }
  },
  now: (): number => vt,
  socketCount: (): number => sockets.length,
};
(globalThis as unknown as { __cap: typeof capture }).__cap = capture;
