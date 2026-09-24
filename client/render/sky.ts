// Night sky: gradient dome with stars + milky way, a giant ₿-coin moon, a holographic whale cruising over the
// city ("whale alert"), MEV-bot drones hauling sandwiches along the roads, and the occasional shooting star.

import * as THREE from 'three';
import type { GameMap } from '../../shared/map';
import { Rng } from '../../shared/rng';
import { textTexture } from './assets';
import { Bag, Batcher, batchMaterials, glowTexture, hdr } from './world/kit';

/** Direction toward the moon (unit). The moon light shines from here too (at a steeper angle). */
export const MOON_DIR = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
const DOME_RADIUS = 900;

const DOME_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w * 0.99999;
  }
`;

const DOME_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uMoonDir;
  varying vec3 vDir;
  float h31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float n3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
      mix(
        mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x),
        mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x),
        f.y),
      f.z);
  }
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 zenith = vec3(0.004, 0.005, 0.03);
    vec3 mid = vec3(0.02, 0.012, 0.075);
    vec3 horizon = vec3(0.22, 0.035, 0.26);
    vec3 col = mix(mid, zenith, smoothstep(0.05, 0.75, y));
    col = mix(col, horizon, exp(-abs(y - 0.02) * 9.0));
    col += vec3(0.5, 0.08, 0.35) * exp(-abs(y) * 30.0) * 0.35;
    if (y < 0.0) col = mix(col, vec3(0.012, 0.006, 0.03), smoothstep(0.0, 0.25, -y));
    // milky way band
    vec3 bandAxis = normalize(vec3(0.3, 0.5, 0.8));
    float bandD = dot(d, bandAxis);
    float band = exp(-bandD * bandD * 22.0);
    float neb = n3(d * 6.0) * 0.6 + n3(d * 15.0) * 0.4;
    col += vec3(0.12, 0.05, 0.22) * band * neb * smoothstep(-0.05, 0.2, y) * 0.8;
    // stars
    for (int layer = 0; layer < 2; layer++) {
      float scale = layer == 0 ? 90.0 : 190.0;
      vec3 p = d * scale;
      vec3 cell = floor(p);
      float h = h31(cell + float(layer) * 17.0);
      if (h > 0.9) {
        vec3 c = cell + 0.5 + (vec3(h31(cell + 1.3), h31(cell + 2.7), h31(cell + 4.1)) - 0.5) * 0.6;
        float dist = length(p - c);
        float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 4.0) + h * 60.0);
        float s = smoothstep(0.16, 0.0, dist) * tw * (layer == 0 ? 3.2 : 1.6) * (h - 0.9) * 10.0;
        vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.8, 0.6), h31(cell + 9.0));
        col += tint * s * smoothstep(-0.02, 0.15, y);
      }
    }
    // moon glow in the sky around the coin
    float md = max(dot(d, uMoonDir), 0.0);
    col += vec3(1.0, 0.72, 0.3) * pow(md, 90.0) * 0.2 + vec3(0.4, 0.25, 0.6) * pow(md, 8.0) * 0.06;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const WHALE_VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    vec3 p = position;
    float k = clamp(-p.z / 13.0, 0.0, 1.0);
    p.y += sin(uTime * 1.4 - p.z * 0.22) * k * k * 1.8;
    vLocal = p;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = -mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const WHALE_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vView)));
    float rim = pow(f, 2.2);
    float scan = 0.6 + 0.4 * sin(vLocal.z * 3.0 - uTime * 4.0);
    float grooves = step(vLocal.y, -0.6) * pow(abs(sin(vLocal.x * 7.0)), 12.0);
    float spots = step(0.82, fract(sin(dot(floor(vLocal.xz * 1.3), vec2(12.9, 78.2))) * 43758.5));
    vec3 col = vec3(0.1, 0.55, 1.0) * (rim * 2.6 + 0.08 * scan)
      + vec3(0.3, 0.9, 1.0) * grooves * 1.2
      + vec3(0.6, 0.9, 1.0) * spots * 0.25 * rim;
    float a = clamp(rim * 0.9 + 0.12, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
  }
`;

interface Drone {
  group: THREE.Group;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  speed: number;
  phase: number;
  yaw: number;
}

export class Sky {
  readonly root = new THREE.Group(); // world-space sky actors (whale, drones)
  private dome: THREE.Group = new THREE.Group(); // follows the camera
  private bag = new Bag();
  private domeMat: THREE.ShaderMaterial;
  private moon: THREE.Mesh;
  private whale = new THREE.Group();
  private whaleMat: THREE.ShaderMaterial;
  private droneTemplate = new THREE.Group();
  private drones: Drone[] = [];
  private star: THREE.Points;
  private starPos: Float32Array;
  private starState = { t: -1, next: 4, from: new THREE.Vector3(), vel: new THREE.Vector3() };
  private rng = new Rng(0x5ca1ab1e);

  constructor(scene: THREE.Scene) {
    const bag = this.bag;
    // dome
    this.domeMat = bag.track(
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uMoonDir: { value: MOON_DIR.clone() } },
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    const dome = new THREE.Mesh(bag.track(new THREE.SphereGeometry(DOME_RADIUS, 48, 24)), this.domeMat);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.dome.add(dome);

    // ₿ coin moon + halo
    const coinTex = bag.track(makeCoinTexture());
    const moonMat = bag.track(
      new THREE.MeshBasicMaterial({
        map: coinTex,
        color: hdr('#ffffff', 0.95),
        transparent: true,
        fog: false,
        depthWrite: false,
      }),
    );
    this.moon = new THREE.Mesh(bag.track(new THREE.CircleGeometry(1, 64)), moonMat);
    this.moon.scale.setScalar(62);
    this.moon.position.copy(MOON_DIR).multiplyScalar(DOME_RADIUS * 0.8);
    this.moon.lookAt(0, 0, 0);
    this.moon.renderOrder = -9;
    const glow = glowTexture(bag);
    const halo = new THREE.Sprite(
      bag.track(
        new THREE.SpriteMaterial({
          map: glow,
          color: hdr('#ffb040', 0.28),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      ),
    );
    halo.scale.setScalar(420);
    halo.position.copy(this.moon.position).multiplyScalar(1.01);
    halo.renderOrder = -9;
    this.dome.add(this.moon, halo);

    // shooting star (point trail, repositioned when active)
    const TRAIL = 28;
    this.starPos = new Float32Array(TRAIL * 3);
    const starGeo = bag.track(new THREE.BufferGeometry());
    starGeo.setAttribute('position', new THREE.BufferAttribute(this.starPos, 3));
    const fade = new Float32Array(TRAIL);
    for (let i = 0; i < TRAIL; i++) fade[i] = 1 - i / TRAIL;
    starGeo.setAttribute('fade', new THREE.BufferAttribute(fade, 1));
    const starMat = bag.track(
      new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute float fade;
          varying float vFade;
          void main() {
            vFade = fade;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position.z = gl_Position.w * 0.99998;
            gl_PointSize = 1.5 + fade * 5.0;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uAlpha;
          varying float vFade;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d) * vFade * uAlpha;
            gl_FragColor = vec4(vec3(0.8, 0.9, 1.0) * a * 3.0, a);
          }
        `,
      }),
    );
    this.star = new THREE.Points(starGeo, starMat);
    this.star.frustumCulled = false;
    this.star.visible = false;
    this.dome.add(this.star);

    this.whaleMat = bag.track(
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: WHALE_VERT,
        fragmentShader: WHALE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.buildWhale();
    this.buildDroneTemplate();
    this.root.add(this.whale);
    scene.add(this.dome, this.root);
  }

  private buildWhale(): void {
    const parts: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry) => parts.push(g);
    // body: long ellipsoid, head blunt at +z, tapering tail stock toward −z
    add(new THREE.SphereGeometry(1, 32, 20).scale(3.4, 3.0, 10.5).translate(0, 0, 2));
    add(new THREE.SphereGeometry(1, 24, 16).scale(3.1, 2.8, 3.6).translate(0, 0.2, 9.5));
    add(new THREE.CylinderGeometry(0.6, 2.4, 9, 20, 4).rotateX(-Math.PI / 2).translate(0, 0.1, -10));
    // flukes
    add(new THREE.SphereGeometry(1, 16, 8).scale(3.8, 0.28, 1.4).rotateY(0.35).translate(-2.8, 0.1, -15.3));
    add(new THREE.SphereGeometry(1, 16, 8).scale(3.8, 0.28, 1.4).rotateY(-0.35).translate(2.8, 0.1, -15.3));
    // pectoral fins + dorsal
    add(
      new THREE.SphereGeometry(1, 16, 8).scale(3.2, 0.25, 1.1).rotateY(-0.5).rotateZ(-0.35).translate(-4.2, -1.6, 4.5),
    );
    add(new THREE.SphereGeometry(1, 16, 8).scale(3.2, 0.25, 1.1).rotateY(0.5).rotateZ(0.35).translate(4.2, -1.6, 4.5));
    add(new THREE.ConeGeometry(0.8, 1.6, 8).scale(0.4, 1, 1.4).translate(0, 3.0, -4));
    const merged = this.bag.track(mergeParts(parts));
    const body = new THREE.Mesh(merged, this.whaleMat);
    body.frustumCulled = false;
    body.renderOrder = 6;
    // solid silhouette for the shadow pass: whale shadows glide across the city
    body.castShadow = true;
    body.customDepthMaterial = this.bag.track(new THREE.MeshDepthMaterial());
    this.whale.add(body);
    const label = textTexture('WHALE ALERT', {
      width: 1024,
      height: 192,
      color: '#bff4ff',
      glow: '#1aa8ff',
      font: '900 {px}px "Orbitron", system-ui, sans-serif',
    });
    this.bag.track(label);
    const tag = new THREE.Sprite(
      this.bag.track(
        new THREE.SpriteMaterial({
          map: label,
          color: hdr('#ffffff', 1.4),
          transparent: true,
          depthWrite: false,
          fog: false,
        }),
      ),
    );
    tag.scale.set(14, 14 * (192 / 1024), 1);
    tag.position.set(0, 6.5, 2);
    this.whale.add(tag);
    this.whale.scale.setScalar(1.25);
  }

  private buildDroneTemplate(): void {
    const batch = new Batcher();
    const p = batch.at(0, 0);
    p.box('metal', 0, 0, 0, 0.9, 0.22, 0.9, '#20242f');
    p.sphere('glass', 0, 0.12, 0.05, 0.32, 0.18, 0.32, '#0a0c14');
    p.box('glow', 0, 0.02, 0.46, 0.5, 0.06, 0.02, '#ff2040', { intensity: 3.5 });
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      p.box('metal', Math.cos(a) * 0.6, 0.02, Math.sin(a) * 0.6, 0.85, 0.07, 0.1, '#2a2f3e', { ry: -a });
      p.cyl('metal', Math.cos(a) * 0.95, 0.1, Math.sin(a) * 0.95, 0.07, 0.16, '#3a3f50', undefined, 8);
      p.sphere(
        'blink',
        Math.cos(a) * 0.95,
        -0.06,
        Math.sin(a) * 0.95,
        0.05,
        0.05,
        0.05,
        i < 2 ? '#39ff88' : '#ff3050',
        { intensity: 5 },
      );
    }
    // cables + the sandwich (bread, lettuce, tomato, cheese, ham, bread)
    p.box('metal', -0.25, -0.55, 0, 0.02, 0.9, 0.02, '#555');
    p.box('metal', 0.25, -0.55, 0, 0.02, 0.9, 0.02, '#555');
    const sy = -1.1;
    p.box('lit', 0, sy, 0, 0.9, 0.12, 0.66, '#d7a45a');
    p.box('lit', 0, sy + 0.08, 0, 0.98, 0.04, 0.74, '#4fd64a');
    p.cyl('lit', -0.2, sy + 0.12, 0.05, 0.2, 0.05, '#e8322a', undefined, 16);
    p.cyl('lit', 0.22, sy + 0.12, -0.08, 0.2, 0.05, '#e8322a', undefined, 16);
    p.box('lit', 0, sy + 0.16, 0, 0.8, 0.04, 0.8, '#ffd23f', { ry: Math.PI / 4 });
    p.box('lit', 0, sy + 0.2, 0, 0.86, 0.05, 0.62, '#e98a8a');
    p.sphere('lit', 0, sy + 0.27, 0, 0.46, 0.13, 0.34, '#e0ae62');
    const mats = batchMaterials(this.bag);
    batch.flush(this.droneTemplate, mats, this.bag);
    // rotor blur discs + mempool scanner cone
    const rotorMat = this.bag.track(
      new THREE.MeshBasicMaterial({
        color: hdr('#9fd8ff', 0.5),
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const rotorGeo = this.bag.track(new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2));
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const r = new THREE.Mesh(rotorGeo, rotorMat);
      r.position.set(Math.cos(a) * 0.95, 0.2, Math.sin(a) * 0.95);
      this.droneTemplate.add(r);
    }
    const scanMat = this.bag.track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: hdr('#ff2040', 0.9) } },
        vertexShader: /* glsl */ `
          varying float vH;
          void main() {
            vH = uv.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          varying float vH;
          void main() {
            float a = vH * vH * 0.22;
            gl_FragColor = vec4(uColor * a, a);
          }
        `,
      }),
    );
    const scan = new THREE.Mesh(
      this.bag.track(new THREE.ConeGeometry(1.6, 5, 20, 1, true).translate(0, -2.5, 0)),
      scanMat,
    );
    scan.position.set(0, -1.3, 0);
    scan.renderOrder = 4;
    this.droneTemplate.add(scan);
    this.droneTemplate.scale.setScalar(1.5);
  }

  /** New match world: re-route the MEV drones along the new map's spoke roads. */
  setMap(map: GameMap): void {
    for (const d of this.drones) this.root.remove(d.group);
    this.drones.length = 0;
    const rng = new Rng(map.seed ^ 0xd00d);
    const spokes = map.roads.filter((r) => r.w >= 5);
    const routes = spokes.length ? spokes : map.roads;
    const count = Math.min(6, routes.length);
    for (let i = 0; i < count; i++) {
      const r = routes[Math.floor((i * routes.length) / count)]!;
      const group = this.droneTemplate.clone();
      this.root.add(group);
      this.drones.push({
        group,
        ax: r.x1,
        az: r.z1,
        bx: r.x2,
        bz: r.z2,
        speed: rng.range(0.12, 0.2),
        phase: rng.range(0, Math.PI * 2),
        yaw: 0,
      });
    }
  }

  update(time: number, dt: number, camera: THREE.Camera): void {
    this.dome.position.copy(camera.position);
    this.domeMat.uniforms.uTime!.value = time;
    this.whaleMat.uniforms.uTime!.value = time;
    this.moon.rotation.z = Math.sin(time * 0.05) * 0.15;

    // whale: slow lazy loop over the city
    const wa = time * 0.018 + 1.2;
    const WR = 92;
    this.whale.position.set(Math.cos(wa) * WR, 58 + Math.sin(time * 0.21) * 4, Math.sin(wa) * WR);
    this.whale.rotation.set(Math.sin(time * 0.3) * 0.05, -wa, Math.sin(time * 0.25) * 0.08, 'YXZ');

    // drones
    for (const d of this.drones) {
      const ph = time * d.speed + d.phase;
      const s = 0.5 - 0.5 * Math.cos(ph);
      const dir = Math.sin(ph) >= 0 ? 1 : -1;
      const x = d.ax + (d.bx - d.ax) * s;
      const z = d.az + (d.bz - d.az) * s;
      const targetYaw = Math.atan2((d.bx - d.ax) * dir, (d.bz - d.az) * dir);
      let diff = targetYaw - d.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      d.yaw += diff * Math.min(1, dt * 2.5);
      d.group.position.set(x, 11 + Math.sin(time * 1.7 + d.phase) * 0.6, z);
      d.group.rotation.set(0.12 * Math.abs(Math.sin(ph)), d.yaw, 0, 'YXZ');
    }
    this.updateShootingStar(dt);
  }

  private updateShootingStar(dt: number): void {
    const st = this.starState;
    const mat = this.star.material as THREE.ShaderMaterial;
    if (st.t < 0) {
      st.next -= dt;
      if (st.next > 0) return;
      const az = this.rng.range(0, Math.PI * 2);
      const el = this.rng.range(0.25, 0.7);
      st.from
        .set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el))
        .multiplyScalar(DOME_RADIUS * 0.7);
      const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az)).multiplyScalar(this.rng.chance(0.5) ? 1 : -1);
      st.vel
        .copy(side)
        .multiplyScalar(420)
        .add(new THREE.Vector3(0, -160, 0));
      st.t = 0;
      this.star.visible = true;
    }
    st.t += dt;
    const DUR = 1.1;
    const n = this.starPos.length / 3;
    for (let i = 0; i < n; i++) {
      const tt = Math.max(0, st.t - i * 0.012);
      this.starPos[i * 3] = st.from.x + st.vel.x * tt;
      this.starPos[i * 3 + 1] = st.from.y + st.vel.y * tt;
      this.starPos[i * 3 + 2] = st.from.z + st.vel.z * tt;
    }
    this.star.geometry.getAttribute('position').needsUpdate = true;
    mat.uniforms.uAlpha!.value = Math.sin(Math.min(1, st.t / DUR) * Math.PI);
    if (st.t > DUR) {
      st.t = -1;
      st.next = this.rng.range(5, 13);
      this.star.visible = false;
    }
  }
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    return n;
  });
  const total = nonIndexed.reduce((s, g) => s + g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of nonIndexed) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

function makeCoinTexture(): THREE.CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const m = S / 2;
  const body = g.createRadialGradient(m * 0.8, m * 0.7, S * 0.05, m, m, m);
  body.addColorStop(0, '#fff3c4');
  body.addColorStop(0.45, '#ffc94a');
  body.addColorStop(0.85, '#e0901a');
  body.addColorStop(1, '#a8600c');
  g.fillStyle = body;
  g.beginPath();
  g.arc(m, m, m - 2, 0, Math.PI * 2);
  g.fill();
  // milled rim
  g.strokeStyle = 'rgba(120,64,8,0.6)';
  g.lineWidth = 4;
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    g.beginPath();
    g.moveTo(m + Math.cos(a) * (m - 6), m + Math.sin(a) * (m - 6));
    g.lineTo(m + Math.cos(a) * (m - 40), m + Math.sin(a) * (m - 40));
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,240,190,0.8)';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(m, m, m - 60, 0, Math.PI * 2);
  g.stroke();
  // lunar "maria" (subtle craters)
  const rng = new Rng(21000000);
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0, m - 120);
    g.fillStyle = `rgba(160,90,10,${rng.range(0.08, 0.2)})`;
    g.beginPath();
    g.arc(m + Math.cos(a) * r, m + Math.sin(a) * r, rng.range(14, 70), 0, Math.PI * 2);
    g.fill();
  }
  // embossed ₿
  g.font = `900 ${Math.round(S * 0.62)}px system-ui, -apple-system, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(110,55,0,0.55)';
  g.fillText('₿', m + 10, m + 36);
  g.fillStyle = '#fff6d8';
  g.fillText('₿', m, m + 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
