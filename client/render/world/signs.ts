// Holographic billboards (map.billboards) and glow halos for map.lights.

import * as THREE from 'three';
import { FONT_DISPLAY, glowFor, neon, signTexture, type BuildCtx } from './kit';

const PANEL_W = 8;
const PANEL_H = 3.2;

const BILLBOARD_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const BILLBOARD_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  varying vec3 vW;
  float h11(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    float tick = floor(uTime * 12.0 + uSeed * 31.0);
    float glitch = step(0.96, h11(tick));
    float band = step(0.8, h11(floor(vUv.y * 18.0) + tick));
    vec2 uv = vUv;
    uv.x += glitch * band * (h11(tick + vUv.y) - 0.5) * 0.12;
    float r = texture2D(uMap, uv + vec2(0.004, 0.0)).a;
    vec4 tex = texture2D(uMap, uv);
    float b = texture2D(uMap, uv - vec2(0.004, 0.0)).a;
    float scan = 0.72 + 0.28 * sin(vUv.y * 180.0 - uTime * 9.0);
    float sweep = pow(fract(vUv.y * 0.5 - uTime * 0.25 + uSeed), 16.0) * 0.6;
    float flicker = 0.88 + 0.12 * sin(uTime * 43.0 + uSeed * 9.0) * sin(uTime * 3.7 + uSeed);
    float off = step(0.992, h11(floor(uTime * 4.0) + uSeed * 7.0));
    vec3 textCol = mix(uColor, vec3(1.0), 0.35) * tex.a * 1.9;
    textCol.r += (r - tex.a) * 0.8;
    textCol.b += (b - tex.a) * 0.8;
    // panel: faint tinted glass + grid + bright frame
    vec2 e = min(vUv, 1.0 - vUv);
    float frame = 1.0 - smoothstep(0.0, 0.02, min(e.x * 0.4, e.y));
    vec2 grid = abs(fract(vUv * vec2(40.0, 16.0)) - 0.5);
    float gridLine = step(0.46, max(grid.x, grid.y));
    vec3 col = textCol * scan * flicker + uColor * (0.06 + gridLine * 0.05 + sweep * 0.5) + uColor * frame * 1.0;
    col *= 1.0 - off * 0.85;
    float a = clamp(0.25 + tex.a * 0.75 + frame, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
  }
`;

export function buildBillboards(ctx: BuildCtx): void {
  const { bag, batch, map } = ctx;
  if (!map.billboards.length) return;
  const panelGeo = bag.track(new THREE.PlaneGeometry(PANEL_W, PANEL_H));
  const mats: THREE.ShaderMaterial[] = [];
  map.billboards.forEach((b, i) => {
    const bottom = b.h - PANEL_H / 2;
    const p = batch.at(b.x, b.z, b.rot);
    // twin legs, crossbar, emitter rail
    for (const sx of [-1, 1]) {
      // legs stop inside the crossbar so their tops are never coplanar with its top
      p.box('metal', sx * 2.4, (bottom - 0.1) / 2, 0, 0.26, bottom - 0.1, 0.26, '#252838');
      p.box('glow', sx * 2.4, (bottom - 0.1) / 2, 0.14, 0.04, bottom - 0.1, 0.02, b.color, { intensity: 1.6 });
      p.box('rough', sx * 2.4, 0.15, 0, 0.7, 0.3, 0.7, '#1c1e2a');
    }
    p.box('metal', 0, bottom - 0.15, 0, PANEL_W + 0.4, 0.3, 0.4, '#252838');
    p.box('glow', 0, bottom - 0.02, 0, PANEL_W + 0.2, 0.05, 0.3, b.color, { intensity: 3 });
    const tex = signTexture(bag, b.text, {
      width: 1024,
      height: 410,
      font: FONT_DISPLAY,
      color: '#ffffff',
      glow: b.color,
    });
    const mat = bag.track(
      new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: tex },
          uColor: { value: neon(b.color, 1.4) },
          uTime: { value: 0 },
          uSeed: { value: i * 0.618 },
        },
        vertexShader: BILLBOARD_VERT,
        fragmentShader: BILLBOARD_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    mats.push(mat);
    const panel = new THREE.Mesh(panelGeo, mat);
    panel.position.set(b.x, b.h, b.z);
    panel.rotation.y = b.rot;
    panel.renderOrder = 3;
    ctx.root.add(panel);
    ctx.light(b.x, b.h - 1, b.z, b.color, 1.2, 9);
  });
  ctx.animate((time) => {
    for (const m of mats) m.uniforms.uTime!.value = time;
  });
}

/** Glow halos for map.lights; they fade out when the camera gets close so they never glare over the player. */
export function buildLightHalos(ctx: BuildCtx): void {
  const halos: THREE.Sprite[] = [];
  for (const l of ctx.map.lights) {
    const color = glowFor(l.color);
    ctx.light(l.x, l.y, l.z, color, l.intensity * 0.55, 10 + l.intensity * 5);
    const mat = ctx.bag.track(
      new THREE.SpriteMaterial({
        map: ctx.glowTex,
        color: neon(color, 1.1),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(l.x, l.y, l.z);
    const s = 2.2 + l.intensity * 0.9;
    sprite.scale.set(s, s, 1);
    sprite.renderOrder = 5;
    ctx.root.add(sprite);
    halos.push(sprite);
  }
  ctx.animate((_time, _dt, camera) => {
    for (const s of halos) {
      const d = s.position.distanceTo(camera);
      const k = Math.min(1, Math.max(0, (d - 10) / 14));
      s.material.opacity = k * k * (3 - 2 * k);
    }
  });
}
