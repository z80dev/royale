// Renderer orchestrator: owns the WebGLRenderer, scene, lights, camera rig, post chain, static world, sky and
// zone, and forwards dynamic content to Actors. The core calls frame() once per animation frame.

import * as THREE from 'three';
import type { GameMap } from '../../shared/map';
import type { GameEvent } from '../../shared/protocol';
import type { FrameView } from '../view';
import { Actors } from './actors';
import { CameraRig } from './camera';
import { PostFx, QUALITY, type QualityLevel } from './post';
import { MOON_DIR, Sky } from './sky';
import { World } from './world';
import { hdr, worldUniforms } from './world/kit';
import { pointUniforms } from './world/plume';
import { ZoneFx } from './zone';

const FOG_COLOR = '#0b0a24';
const LIGHT_DIR = new THREE.Vector3(MOON_DIR.x, 1.15, MOON_DIR.z).normalize();
const LIGHT_DISTANCE = 140;
const SHADOW_EXTENT_MIN = 40;
const SHADOW_EXTENT_MAX = 128;
const QUALITY_KEY = 'launchpad.quality';

/** Adaptive quality: drop one level when the average fps over a window stays below this. */
const MIN_FPS = 46;
const PERF_WARMUP_S = 4;
const PERF_WINDOW_S = 2.5;

export interface RenderStats {
  quality: QualityLevel; // 2 = high … 0 = low
  fps: number; // averaged over the last perf window
  calls: number; // draw calls last frame (all passes)
  triangles: number;
  geometries: number; // GPU-resident geometries
  textures: number;
}

export class Renderer {
  private readonly container: HTMLElement;
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig = new CameraRig();
  private readonly post: PostFx;
  private readonly world: World;
  private readonly sky: Sky;
  private readonly zone: ZoneFx;
  private readonly actors: Actors;
  private readonly moon: THREE.DirectionalLight;
  private readonly envTarget: THREE.WebGLRenderTarget;
  private qualityLevel: QualityLevel;
  private readonly qualityLocked: boolean;
  private time = 0;
  private occlusion = 0;
  private seenWindow = { w: 0, h: 0, dpr: 0 };
  private shadowExtent = 0;
  private perf = { elapsed: 0, windowTime: 0, windowFrames: 0, fps: 60 };
  private cssWidth = 1;
  private cssHeight = 1;
  private rect: DOMRect | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1);
  private readonly ndc = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private readonly lightBasis = {
    right: new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), LIGHT_DIR).normalize(),
    up: new THREE.Vector3(),
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.lightBasis.up.crossVectors(LIGHT_DIR, this.lightBasis.right).normalize();
    const { level, locked } = initialQuality();
    this.qualityLevel = level;
    this.qualityLocked = locked;
    const spec = QUALITY[level];

    this.gl = new THREE.WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.info.autoReset = false;
    this.gl.setClearColor(FOG_COLOR, 1);
    const canvas = this.gl.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);

    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0042);
    this.envTarget = buildNeonEnvironment(this.gl);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.55;

    this.moon = new THREE.DirectionalLight('#a9b8ff', 1.5);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(spec.shadowMap, spec.shadowMap);
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.05;
    this.moon.shadow.radius = 2.5;
    this.moon.shadow.camera.near = 10;
    this.moon.shadow.camera.far = LIGHT_DISTANCE + 80;
    this.scene.add(this.moon, this.moon.target);
    this.scene.add(new THREE.HemisphereLight('#5b4dff', '#1c0a2a', 0.55));

    this.world = new World(this.scene);
    this.sky = new Sky(this.scene);
    this.zone = new ZoneFx(this.scene);
    this.post = new PostFx(this.gl, this.scene, this.rig.camera, spec);
    this.actors = new Actors({
      scene: this.scene,
      camera: this.rig.camera,
      renderer: this.gl,
      shake: (amount, x, z) => {
        if (x === undefined || z === undefined) return this.rig.addShake(amount);
        const d = Math.hypot(x - this.rig.target.x, z - this.rig.target.z);
        this.rig.addShake(amount * Math.max(0, 1 - d / 45));
      },
    });

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('scroll', () => (this.rect = null), true);
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  }

  /** Current adaptive quality level, measured fps and GPU counters — for debug overlays. */
  get stats(): RenderStats {
    const info = this.gl.info;
    return {
      quality: this.qualityLevel,
      fps: this.perf.fps,
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }

  setMap(map: GameMap): void {
    this.world.setMap(map);
    this.sky.setMap(map);
    this.actors.setMap(map);
  }

  frame(view: FrameView, dt: number): void {
    // Safety net: moving the window to a display with another DPR fires no resize event, and resize/observer
    // callbacks can lag a frame behind. These reads don't force layout.
    const ratio = window.devicePixelRatio || 1;
    if (
      window.innerWidth !== this.seenWindow.w ||
      window.innerHeight !== this.seenWindow.h ||
      ratio !== this.seenWindow.dpr
    ) {
      this.resize();
    }
    const step = Math.min(Math.max(dt, 0), 0.1);
    this.time += step;
    const time = this.time;
    worldUniforms.uTime.value = time;

    this.rig.update(view, step, time);
    const focus = this.rig.target;
    this.updateMoon(focus);
    this.updateOcclusion(view, step);

    this.world.update(time, step, focus, this.rig.camera.position);
    this.sky.update(time, step, this.rig.camera);
    this.zone.update(view.zone, focus, step);
    this.actors.update(view, step);

    this.gl.info.reset();
    this.rig.applyShake(time);
    this.post.render(time, step);
    this.rig.removeShake();
    this.trackPerformance(dt);
  }

  onEvent(ev: GameEvent, view: FrameView): void {
    if (ev.e === 'zone') this.zone.pulse();
    this.actors.onEvent(ev, view);
  }

  muzzleFlash(playerId: string): void {
    this.actors.muzzleFlash(playerId);
  }

  shake(amount: number): void {
    this.rig.addShake(amount);
  }

  pickGround(clientX: number, clientY: number): { x: number; z: number } {
    const rect = (this.rect ??= this.gl.domElement.getBoundingClientRect());
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    const hit = this.raycaster.ray.intersectPlane(this.pickPlane, this.tmp);
    if (hit) return { x: hit.x, z: hit.z };
    // ray points at the sky: take the point 80 m out along the ray, projected to the ground
    this.raycaster.ray.at(80, this.tmp);
    return { x: this.tmp.x, z: this.tmp.z };
  }

  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = this.tmp.set(x, y, z).project(this.rig.camera);
    return {
      x: ((v.x + 1) / 2) * this.cssWidth,
      y: ((1 - v.y) / 2) * this.cssHeight,
      visible: v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1.15 && Math.abs(v.y) <= 1.15,
    };
  }

  // ───────────────────────────── internals ─────────────────────────────

  /** Opens the see-through cut only while tall geometry actually blocks the line of sight to the focus. */
  private updateOcclusion(view: FrameView, dt: number): void {
    const eye = this.rig.camera.position;
    const occFocus = worldUniforms.uOccFocus.value.set(view.focus.x, view.focus.y + 1.1, view.focus.z);
    const follow = view.cameraMode === 'play' || view.cameraMode === 'spectate';
    const blocked = follow && view.focusId !== null && this.world.occludes(eye, occFocus);
    const target = blocked ? 1 : 0;
    this.occlusion += (target - this.occlusion) * (1 - Math.exp(-dt * (blocked ? 7 : 4)));
    if (this.occlusion < 0.002) this.occlusion = 0;
    worldUniforms.uOccCam.value.copy(eye);
    worldUniforms.uOccStrength.value = this.occlusion;
  }

  private updateMoon(focus: THREE.Vector3): void {
    // Shadow frustum covers everything on screen (+ margin), in 8 m steps with hysteresis to avoid thrashing.
    const wanted = Math.min(SHADOW_EXTENT_MAX, Math.max(SHADOW_EXTENT_MIN, this.rig.groundRadius * 1.08));
    const extent =
      this.shadowExtent === 0 || wanted > this.shadowExtent || wanted < this.shadowExtent - 12
        ? Math.ceil(wanted / 8) * 8
        : this.shadowExtent;
    const cam = this.moon.shadow.camera;
    if (extent !== this.shadowExtent) {
      this.shadowExtent = extent;
      cam.left = cam.bottom = -extent;
      cam.right = cam.top = extent;
      cam.updateProjectionMatrix();
    }
    // Snap the shadow frustum to whole shadow-map texels so shadows don't shimmer while the camera moves.
    const texel = (extent * 2) / this.moon.shadow.mapSize.x;
    const { right, up } = this.lightBasis;
    const s = Math.round(focus.dot(right) / texel) * texel;
    const t = Math.round(focus.dot(up) / texel) * texel;
    const u = focus.dot(LIGHT_DIR);
    const target = this.moon.target.position;
    target.copy(right).multiplyScalar(s).addScaledVector(up, t).addScaledVector(LIGHT_DIR, u);
    this.moon.position.copy(target).addScaledVector(LIGHT_DIR, LIGHT_DISTANCE);
    this.moon.target.updateMatrixWorld();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.qualityLevel].dpr);
    this.cssWidth = w;
    this.cssHeight = h;
    this.seenWindow = { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 };
    this.rect = null;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(w, h, false);
    this.rig.setAspect(w / h);
    this.post.setSize(w, h, dpr);
    pointUniforms.uPxScale.value = (h * dpr) / (2 * Math.tan((this.rig.camera.fov * Math.PI) / 360));
  }

  private trackPerformance(dt: number): void {
    const p = this.perf;
    if (dt <= 0 || dt > 0.25 || document.hidden) return;
    p.elapsed += dt;
    p.windowTime += dt;
    p.windowFrames++;
    if (p.windowTime < PERF_WINDOW_S) return;
    p.fps = p.windowFrames / p.windowTime;
    p.windowTime = 0;
    p.windowFrames = 0;
    if (this.qualityLocked || p.elapsed < PERF_WARMUP_S || p.fps >= MIN_FPS || this.qualityLevel === 0) return;
    this.setQuality((this.qualityLevel - 1) as QualityLevel);
    p.elapsed = 0; // give the new level a fresh warm-up before judging again
  }

  private setQuality(level: QualityLevel): void {
    this.qualityLevel = level;
    const spec = QUALITY[level];
    if (this.moon.shadow.mapSize.x !== spec.shadowMap) {
      this.moon.shadow.mapSize.set(spec.shadowMap, spec.shadowMap);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
      this.shadowExtent = 0;
    }
    this.post.setQuality(spec);
    this.resize();
    console.info(`[render] adaptive quality → ${level} (${this.perf.fps.toFixed(0)} fps)`);
  }
}

/** Quality from ?quality=0|1|2 or localStorage (locks adaptation), else start high and adapt. */
function initialQuality(): { level: QualityLevel; locked: boolean } {
  const parse = (v: string | null): QualityLevel | null =>
    v === '0' || v === '1' || v === '2' ? (Number(v) as QualityLevel) : null;
  const fromUrl = parse(new URLSearchParams(location.search).get('quality'));
  let fromStorage: QualityLevel | null = null;
  try {
    fromStorage = parse(localStorage.getItem(QUALITY_KEY));
  } catch {
    fromStorage = null;
  }
  const forced = fromUrl ?? fromStorage;
  return forced === null ? { level: 2, locked: false } : { level: forced, locked: true };
}

/** Prefiltered environment: a dark room lit by magenta/cyan/amber neon panels, for glossy glass + metal. */
function buildNeonEnvironment(gl: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const env = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  disposables.push(box);
  const add = (
    color: THREE.Color,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    side: THREE.Side = THREE.FrontSide,
  ) => {
    const mat = new THREE.MeshBasicMaterial({ color, side });
    disposables.push(mat);
    const m = new THREE.Mesh(box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    env.add(m);
  };
  add(hdr('#0c0820', 1), 0, 0, 0, 60, 30, 60, THREE.BackSide);
  add(hdr('#ff2bd6', 5), -18, 4, -10, 1, 6, 30);
  add(hdr('#00e5ff', 5), 18, 3, 8, 1, 5, 30);
  add(hdr('#ffb040', 3), 0, 14, 0, 24, 1, 8);
  add(hdr('#6a5bff', 2.5), 0, 6, -28, 40, 3, 1);
  add(hdr('#1a1033', 1), 0, -14, 0, 60, 1, 60);
  const pmrem = new THREE.PMREMGenerator(gl);
  const target = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  for (const d of disposables) d.dispose();
  return target;
}
