// Ground plane (neon grid, district tints, plaza + HQ pads, zone rings), roads with lane markings and lamps,
// the map-edge boundary (fence, energy curtain, cliff, abyss) and the distant skyline.

import * as THREE from 'three';
import type { Road } from '../../../shared/map';
import { Rng } from '../../../shared/rng';
import { brandGlow, neon, patchWorld, type BuildCtx } from './kit';

const EDGE_MARGIN = 7; // ground beyond the fence before the cliff
const MAX_HQS = 12;

export function buildGround(ctx: BuildCtx): void {
  buildGroundPlane(ctx);
  buildRoads(ctx);
  buildBoundary(ctx);
  buildAbyssAndSkyline(ctx);
}

// ───────────────────────────── Ground ─────────────────────────────

function buildGroundPlane(ctx: BuildCtx): void {
  const { map, bag } = ctx;
  const size = (map.half + EDGE_MARGIN) * 2;
  const geo = bag.track(new THREE.PlaneGeometry(size, size, 1, 1));
  geo.rotateX(-Math.PI / 2);
  const hqPos = Array.from({ length: MAX_HQS }, () => new THREE.Vector4());
  const hqColor = Array.from({ length: MAX_HQS }, () => new THREE.Vector3());
  map.hqs.slice(0, MAX_HQS).forEach((hq, i) => {
    hqPos[i]!.set(hq.x, hq.z, hq.half, 1);
    const c = neon(brandGlow(hq.brand).main, 1);
    hqColor[i]!.set(c.r, c.g, c.b);
  });
  const mat = bag.track(new THREE.MeshStandardMaterial({ color: '#0c0f1f', roughness: 0.78, metalness: 0.25 }));
  patchWorld(mat, {
    key: 'ground',
    ground: true,
    uniforms: {
      uHqPos: { value: hqPos },
      uHqColor: { value: hqColor },
      uHqCount: { value: Math.min(map.hqs.length, MAX_HQS) },
      uHalf: { value: map.half },
    },
    header: /* glsl */ `
      uniform vec4 uHqPos[${MAX_HQS}];
      uniform vec3 uHqColor[${MAX_HQS}];
      uniform int uHqCount;
      uniform float uHalf;
      float gridLine(vec2 p, float period, float width) {
        vec2 g = abs(fract(p / period - 0.5) - 0.5) * period;
        vec2 aa = fwidth(p) * 1.2;
        vec2 l = 1.0 - smoothstep(vec2(width), vec2(width) + aa, g);
        return max(l.x, l.y);
      }
    `,
    color: /* glsl */ `
      {
        vec2 p = vWPos.xz;
        float n = kitNoise(p * 0.18) * 0.6 + kitNoise(p * 0.9) * 0.4;
        diffuseColor.rgb *= 0.75 + n * 0.5;
        // HQ district albedo tint
        for (int i = 0; i < ${MAX_HQS}; i++) {
          if (i >= uHqCount) break;
          float d = length(p - uHqPos[i].xy);
          diffuseColor.rgb += uHqColor[i] * exp(-d * d / 900.0) * 0.05;
        }
        // Genesis plaza paving
        float pr = length(p);
        if (pr < 15.0) {
          vec2 tile = abs(fract(p / 1.5) - 0.5);
          float grout = step(0.47, max(tile.x, tile.y));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.085, 0.12), 0.8) * (0.85 + 0.3 * grout);
        }
      }
    `,
    emissive: /* glsl */ `
      {
        vec2 p = vWPos.xz;
        vec3 em = vec3(0.0);
        float minor = gridLine(p, 4.0, 0.03);
        float major = gridLine(p, 20.0, 0.07);
        // data packets racing along the major lines
        float laneX = floor(p.y / 20.0 + 0.5);
        float laneZ = floor(p.x / 20.0 + 0.5);
        float pktX = pow(fract(p.x / 70.0 - uTime * 0.11 + kitHash(vec2(laneX, 3.0))), 18.0);
        float pktZ = pow(fract(p.y / 70.0 + uTime * 0.09 + kitHash(vec2(laneZ, 9.0))), 18.0);
        vec2 gM = abs(fract(p / 20.0 - 0.5) - 0.5) * 20.0;
        float onX = 1.0 - smoothstep(0.07, 0.2, gM.y);
        float onZ = 1.0 - smoothstep(0.07, 0.2, gM.x);
        vec3 gridCol = vec3(0.12, 0.35, 1.0);
        em += gridCol * (minor * 0.018 + major * 0.075);
        em += vec3(0.2, 0.9, 1.0) * (pktX * onX + pktZ * onZ) * 1.3;
        // brand districts: glow tint + HQ courtyard pads
        for (int i = 0; i < ${MAX_HQS}; i++) {
          if (i >= uHqCount) break;
          vec2 d = p - uHqPos[i].xy;
          float dist = length(d);
          em += uHqColor[i] * exp(-dist * dist / 700.0) * 0.07;
          vec2 q = abs(d);
          float box = max(q.x, q.y);
          float hh = uHqPos[i].z;
          if (box < hh + 1.2) {
            float border = exp(-abs(box - (hh - 0.8)) * 7.0);
            float inner = gridLine(d, 2.0, 0.02) * 0.12;
            float corner = step(hh - 3.0, min(q.x, q.y)) * exp(-abs(box - (hh - 1.6)) * 5.0);
            float chevron = step(q.x, 2.0) * step(hh - 3.0, q.y) * step(0.5, fract(q.y * 0.8 - uTime * 0.8));
            em += uHqColor[i] * (border * 0.9 + inner + corner * 1.4 + chevron * 0.35);
          }
        }
        // Genesis plaza rings + spokes
        float pr = length(p);
        if (pr < 17.0) {
          float ang = atan(p.y, p.x);
          float ring = exp(-abs(pr - 14.6) * 9.0) * 1.25
            + exp(-abs(pr - 11.2) * 12.0) * 0.45
            + exp(-abs(pr - 3.4) * 10.0) * 0.5;
          float spokeDist = abs(fract(ang / 6.2831853 * 21.0) - 0.5) / 21.0 * 6.2831853 * pr;
          float spokes = (1.0 - smoothstep(0.02, 0.05, spokeDist))
            * step(4.0, pr) * step(pr, 11.0);
          float sweep = pow(fract(ang / 6.2831853 - uTime * 0.08), 14.0)
            * smoothstep(11.2, 12.5, pr) * smoothstep(14.6, 13.3, pr);
          em += vec3(1.0, 0.72, 0.18) * (ring + spokes * 0.3) + vec3(1.0, 0.6, 0.1) * sweep * 0.3;
        }
        // hazard band between fence and cliff
        float edge = max(abs(p.x), abs(p.y)) - uHalf;
        if (edge > 0.3) {
          float stripe = step(0.5, fract((p.x + p.y) * 0.25));
          float lip = exp(-abs(edge - ${(EDGE_MARGIN - 0.2).toFixed(1)}) * 3.0);
          em += vec3(1.0, 0.15, 0.35) * stripe * 0.12 + vec3(1.0, 0.2, 0.5) * lip;
        }
        totalEmissiveRadiance += em;
      }
    `,
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  ctx.root.add(ground);
}

// ───────────────────────────── Roads ─────────────────────────────

interface RoadChain {
  points: { x: number; z: number }[];
  width: number;
  closed: boolean;
}

/** Joins road segments that share endpoints into polylines so joints get proper miters. */
function chainRoads(roads: Road[]): RoadChain[] {
  const used = new Array<boolean>(roads.length).fill(false);
  const same = (ax: number, az: number, bx: number, bz: number) => Math.abs(ax - bx) < 0.05 && Math.abs(az - bz) < 0.05;
  const chains: RoadChain[] = [];
  for (let i = 0; i < roads.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const r0 = roads[i]!;
    const pts = [
      { x: r0.x1, z: r0.z1 },
      { x: r0.x2, z: r0.z2 },
    ];
    for (let grew = true; grew;) {
      grew = false;
      for (let j = 0; j < roads.length; j++) {
        if (used[j] || roads[j]!.w !== r0.w) continue;
        const r = roads[j]!;
        const tail = pts[pts.length - 1]!;
        const head = pts[0]!;
        if (same(r.x1, r.z1, tail.x, tail.z)) pts.push({ x: r.x2, z: r.z2 });
        else if (same(r.x2, r.z2, tail.x, tail.z)) pts.push({ x: r.x1, z: r.z1 });
        else if (same(r.x2, r.z2, head.x, head.z)) pts.unshift({ x: r.x1, z: r.z1 });
        else if (same(r.x1, r.z1, head.x, head.z)) pts.unshift({ x: r.x2, z: r.z2 });
        else continue;
        used[j] = true;
        grew = true;
      }
    }
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    const closed = pts.length > 2 && same(first.x, first.z, last.x, last.z);
    if (closed) pts.pop();
    chains.push({ points: pts, width: r0.w, closed });
  }
  return chains;
}

function buildRoads(ctx: BuildCtx): void {
  const { bag } = ctx;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const lamps: { x: number; z: number; nx: number; nz: number }[] = [];
  const Y = 0.02;
  for (const chain of chainRoads(ctx.map.roads)) {
    const pts = chain.closed ? [...chain.points, chain.points[0]!] : chain.points;
    const n = pts.length;
    const half = chain.width / 2;
    let v = 0;
    const base = positions.length / 3;
    for (let i = 0; i < n; i++) {
      const p = pts[i]!;
      const prev = i > 0 ? pts[i - 1]! : chain.closed ? pts[n - 2]! : null;
      const next = i < n - 1 ? pts[i + 1]! : chain.closed ? pts[1]! : null;
      let tx = 0;
      let tz = 0;
      if (prev) {
        const l = Math.hypot(p.x - prev.x, p.z - prev.z);
        tx += (p.x - prev.x) / l;
        tz += (p.z - prev.z) / l;
      }
      if (next) {
        const l = Math.hypot(next.x - p.x, next.z - p.z);
        tx += (next.x - p.x) / l;
        tz += (next.z - p.z) / l;
      }
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      // miter: scale the offset so the strip keeps its width at joints
      let miter = 1;
      if (prev && next) {
        const sl = Math.hypot(next.x - p.x, next.z - p.z);
        const sx = (next.x - p.x) / sl;
        const sz = (next.z - p.z) / sl;
        miter = 1 / Math.max(0.5, sx * tx + sz * tz);
      }
      const nx = -tz * half * miter;
      const nz = tx * half * miter;
      if (i > 0) v += Math.hypot(p.x - pts[i - 1]!.x, p.z - pts[i - 1]!.z);
      positions.push(p.x + nx, Y, p.z + nz, p.x - nx, Y, p.z - nz);
      uvs.push(0, v, 1, v);
      if (i > 0) {
        const a = base + (i - 1) * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); // CCW seen from above
      }
    }
    // street lamps every 16 m alternating sides, placed at v = 8, 24, 40…
    let acc = 0;
    let side = 1;
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / len;
      const dz = (b.z - a.z) / len;
      for (let s = (((8 - acc) % 16) + 16) % 16; s < len; s += 16) {
        const off = half + 0.45;
        lamps.push({
          x: a.x + dx * s - dz * off * side,
          z: a.z + dz * s + dx * off * side,
          nx: dz * side,
          nz: -dx * side,
        });
        side = -side;
      }
      acc = (acc + len) % 16;
    }
  }
  const geo = bag.track(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(
      positions.map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  const mat = bag.track(
    new THREE.MeshStandardMaterial({
      color: '#161a2a',
      roughness: 0.38,
      metalness: 0.35,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  patchWorld(mat, {
    key: 'road',
    ground: true,
    color: /* glsl */ `
      diffuseColor.rgb *= 0.8 + kitNoise(vWPos.xz * 1.7) * 0.4;
    `,
    emissive: /* glsl */ `
      {
        float u = vKitUv.x;
        float v = vKitUv.y;
        float aa = fwidth(u) * 1.5;
        float edge = (1.0 - smoothstep(0.035, 0.035 + aa, u)) + smoothstep(0.965 - aa, 0.965, u);
        float lane = (1.0 - smoothstep(0.012, 0.012 + aa, abs(u - 0.5))) * step(0.45, fract(v / 3.0));
        float flow = pow(fract(v / 24.0 - uTime * 0.35), 10.0) * (edge);
        float poolD = fract(v / 16.0 - 0.5) - 0.5;
        float pool = exp(-poolD * poolD * 90.0);
        totalEmissiveRadiance += vec3(0.05, 0.85, 1.0) * edge * (0.6 + flow * 1.6)
          + vec3(1.0, 0.72, 0.15) * lane * 0.5
          + vec3(1.0, 0.62, 0.32) * pool * 0.1;
      }
    `,
  });
  const roads = new THREE.Mesh(geo, mat);
  roads.receiveShadow = true;
  roads.matrixAutoUpdate = false;
  ctx.root.add(roads);
  buildLamps(ctx, lamps);
}

function buildLamps(ctx: BuildCtx, lamps: { x: number; z: number; nx: number; nz: number }[]): void {
  const { batch } = ctx;
  for (const l of lamps) {
    const yaw = Math.atan2(l.nx, l.nz);
    const p = batch.at(l.x, l.z, yaw);
    p.cyl('metal', 0, 2.3, 0, 0.07, 4.6, '#2a2f45', undefined, 8);
    p.box('metal', 0, 4.55, 0.45, 0.1, 0.1, 1.0, '#2a2f45');
    p.box('glow', 0, 4.47, 0.85, 0.24, 0.05, 0.5, '#ffd9a0', { intensity: 3.2 });
    p.cyl('glow', 0, 0.12, 0, 0.14, 0.24, '#00e5ff', { intensity: 1.6 }, 8);
  }
}

// ───────────────────────────── Boundary ─────────────────────────────

function buildBoundary(ctx: BuildCtx): void {
  const { map, bag, batch } = ctx;
  const H = map.half;
  const OUT = H + EDGE_MARGIN;
  // fence posts + glowing rails
  for (let side = 0; side < 4; side++) {
    const yaw = (side * Math.PI) / 2;
    const p = batch.at(0, 0, yaw);
    for (let t = -H; t <= H; t += 5) p.box('metal', t, 1.6, H + 0.15, 0.22, 3.2, 0.22, '#262b40');
    p.box('glow', 0, 1.1, H + 0.15, H * 2, 0.07, 0.07, '#00f0ff', { intensity: 2.6 });
    p.box('glow', 0, 3.2, H + 0.15, H * 2, 0.09, 0.09, '#ff2bd6', { intensity: 2.8 });
    // cliff face with glowing strata
    p.box('rough', 0, -20, OUT, OUT * 2, 40, 0.5, '#0a0b16');
    for (let s = 0; s < 5; s++)
      p.box('glow', 0, -1.5 - s * 5.5, OUT + 0.3, OUT * 2, 0.12, 0.05, s % 2 ? '#7a2bff' : '#00c8ff', {
        intensity: 2.2 - s * 0.35,
      });
  }
  // shimmering energy curtain above the fence
  const curtainMat = bag.track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vW;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vW;
        void main() {
          float along = vW.x + vW.z;
          float scan = 0.5 + 0.5 * sin(along * 1.3 - uTime * 3.0);
          float bars = pow(abs(sin((vUv.y * 14.0 - uTime * 0.8) * 3.14159)), 18.0);
          float fade = pow(1.0 - vUv.y, 1.6);
          vec3 col = mix(vec3(0.0, 0.8, 1.0), vec3(1.0, 0.15, 0.8), vUv.y);
          float a = fade * (0.1 + 0.18 * scan + bars * 0.35);
          gl_FragColor = vec4(col * a * 1.6, a);
        }
      `,
    }),
  );
  ctx.animate((time) => {
    curtainMat.uniforms.uTime!.value = time;
  });
  const curtainGeo = bag.track(new THREE.PlaneGeometry(H * 2, 7));
  for (let side = 0; side < 4; side++) {
    const yaw = (side * Math.PI) / 2;
    const m = new THREE.Mesh(curtainGeo, curtainMat);
    m.position.set(Math.sin(yaw) * (H + 0.15), 3.5, Math.cos(yaw) * (H + 0.15));
    m.rotation.y = yaw;
    m.renderOrder = 2;
    ctx.root.add(m);
  }
}

// ───────────────────────────── Abyss + skyline ─────────────────────────────

function buildAbyssAndSkyline(ctx: BuildCtx): void {
  const { bag, map } = ctx;
  const ABYSS_Y = -46;
  const abyssGeo = bag.track(new THREE.PlaneGeometry(1600, 1600));
  abyssGeo.rotateX(-Math.PI / 2);
  const abyssMat = bag.track(
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vW;
        void main() {
          vec2 p = vW.xz;
          vec2 g = abs(fract(p / 12.0 - 0.5) - 0.5) * 12.0;
          vec2 aa = fwidth(p) * 1.5;
          vec2 l = 1.0 - smoothstep(vec2(0.05), vec2(0.05) + aa, g);
          float line = max(l.x, l.y);
          float d = length(p);
          float fade = exp(-d * 0.0045);
          float wave = 0.5 + 0.5 * sin(d * 0.08 - uTime * 1.2);
          vec3 col = vec3(0.012, 0.008, 0.035) + vec3(0.5, 0.1, 1.0) * line * fade * (0.25 + wave * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  ctx.animate((time) => {
    abyssMat.uniforms.uTime!.value = time;
  });
  const abyss = new THREE.Mesh(abyssGeo, abyssMat);
  abyss.position.y = ABYSS_Y;
  abyss.matrixAutoUpdate = false;
  abyss.updateMatrix();
  ctx.root.add(abyss);

  // Distant skyline: instanced towers with procedural lit windows, rising out of the abyss.
  const rng = new Rng(map.seed ^ 0x5eed);
  const COUNT = 230;
  const geo = bag.track(new THREE.BoxGeometry(1, 1, 1));
  geo.translate(0, 0.5, 0);
  const mat = bag.track(
    new THREE.ShaderMaterial({
      fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        varying vec3 vN;
        varying vec3 vLocal;
        varying float vSeed;
        varying vec3 vScale;
        void main() {
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vLocal = position * vScale;
          vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vW;
        varying vec3 vN;
        varying vec3 vLocal;
        varying float vSeed;
        varying vec3 vScale;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        void main() {
          vec3 n = normalize(vN);
          float top = step(0.9, n.y);
          vec2 wuv = abs(n.x) > 0.5 ? vLocal.zy : vLocal.xy;
          vec2 cell = floor(wuv / vec2(2.6, 3.4));
          vec2 f = fract(wuv / vec2(2.6, 3.4));
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.75);
          float r = h21(cell + vSeed * 100.0 + n.xz * 7.0);
          float lit = step(0.64, r) * win * (1.0 - top);
          float flick = step(0.985, h21(cell + floor(uTime * 0.5 + r * 10.0)));
          lit *= 1.0 - flick;
          vec3 warm = vec3(1.0, 0.72, 0.4);
          vec3 cool = vec3(0.4, 0.8, 1.0);
          vec3 neon = vSeed > 0.5 ? vec3(1.0, 0.2, 0.8) : vec3(0.1, 1.0, 0.9);
          vec3 wc = r > 0.93 ? neon : (r > 0.8 ? cool : warm);
          vec3 body = vec3(0.018, 0.02, 0.045) + vec3(0.03, 0.02, 0.08) * clamp(vW.y / 180.0, 0.0, 1.0);
          float roofEdge = step(vScale.y - 0.6, vLocal.y) * (1.0 - top);
          vec3 col = body + wc * lit * 0.75 + neon * roofEdge * 1.1;
          float beacon = top * step(0.7, vSeed) * step(0.5, fract(uTime * 0.7 + vSeed * 5.0));
          col += vec3(1.0, 0.1, 0.1) * beacon * 2.0 * smoothstep(3.0, 0.0, length(vLocal.xz));
          // atmospheric haze toward the horizon
          float haze = clamp((length(vW.xz) - 180.0) / 420.0, 0.0, 1.0) * clamp(1.0 - (vW.y + 46.0) / 260.0, 0.0, 1.0);
          col = mix(col, vec3(0.06, 0.02, 0.11), haze * 0.85);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  ctx.animate((time) => {
    mat.uniforms.uTime!.value = time;
  });
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const a = rng.range(0, Math.PI * 2);
    const band = i % 3;
    const r = band === 0 ? rng.range(200, 270) : band === 1 ? rng.range(270, 370) : rng.range(370, 520);
    const h = band === 0 ? rng.range(30, 80) : band === 1 ? rng.range(50, 130) : rng.range(80, 190);
    const w = rng.range(12, 30);
    p.set(Math.cos(a) * r, ABYSS_Y, Math.sin(a) * r);
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng.range(0, Math.PI));
    s.set(w, h, rng.range(12, 30));
    mesh.setMatrixAt(i, m.compose(p, q, s));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.frustumCulled = false;
  ctx.root.add(mesh);
  // antenna spires with red aviation lights on a few of the nearest towers
  for (let i = 0; i < COUNT; i += 7) {
    mesh.getMatrixAt(i, m);
    m.decompose(p, q, s);
    const at = ctx.batch.at(p.x, p.z, 0, p.y + s.y);
    at.cyl('metal', 0, 7, 0, 0.3, 14, '#1b1d2e', undefined, 8);
    at.sphere('blink', 0, 14.3, 0, 0.7, 0.7, 0.7, '#ff2040', { intensity: 4 });
  }
}
