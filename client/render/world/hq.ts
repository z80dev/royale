// Brand HQ towers: dark reflective glass with brand-colored window strips + corner trims, the brand badge on
// all four faces, a rotating holographic logo above the roof and a sky-high light beacon visible map-wide.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHARACTER_BY_ID } from '../../../shared/constants';
import type { BoxOb } from '../../../shared/map';
import { badgeTexture } from '../assets';
import { brandGlow, FONT_DISPLAY, hdr, neon, patchWorld, signPlane, signTexture, type BuildCtx } from './kit';

const HOLO_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/** Fades additive hologram/beam geometry that gets close to the camera (it would glare over the player). */
const NEAR_FADE = /* glsl */ `
  float nearFade(vec3 w) {
    return smoothstep(9.0, 22.0, distance(cameraPosition, w));
  }
`;

const HOLO_FRAG = /* glsl */ `
  ${NEAR_FADE}
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  varying vec3 vW;
  void main() {
    float glitch = step(0.975, fract(sin(floor(uTime * 9.0 + uSeed * 13.0) * 91.7) * 43758.5));
    vec2 uv = vUv;
    uv.x += glitch * (fract(sin(floor(vUv.y * 24.0) + uTime) * 17.0) - 0.5) * 0.08;
    vec4 tex = texture2D(uMap, uv);
    float lum = max(max(tex.r, tex.g), tex.b);
    float scan = 0.65 + 0.35 * sin(vW.y * 26.0 - uTime * 7.0);
    float flicker = 0.85 + 0.15 * sin(uTime * 31.0 + uSeed * 7.0) * sin(uTime * 5.3);
    vec3 col = mix(uColor, tex.rgb, 0.25) * (0.25 + lum * 0.8) * scan * flicker * 1.1;
    vec2 inner = smoothstep(vec2(0.0), vec2(0.04), vUv) * smoothstep(vec2(1.0), vec2(0.96), vUv);
    float edge = inner.x * inner.y;
    float a = tex.a * edge * (0.7 + 0.3 * scan) * nearFade(vW);
    gl_FragColor = vec4(col * a, a);
  }
`;

const BEAM_FRAG = /* glsl */ `
  ${NEAR_FADE}
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  varying vec3 vW;
  void main() {
    float fade = pow(1.0 - vUv.y, 1.8);
    float pulse = 0.75 + 0.25 * sin(vUv.y * 60.0 - uTime * 4.0 + uSeed);
    float core = pow(abs(sin(vUv.x * 3.14159265)), 2.0);
    float a = fade * pulse * core * nearFade(vW);
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export function buildHqs(ctx: BuildCtx, towers: BoxOb[]): void {
  const { bag } = ctx;
  const beamGeo = bag.track(new THREE.CylinderGeometry(0.55, 0.9, 1, 16, 1, true).translate(0, 0.5, 0));
  const haloGeo = bag.track(new THREE.CylinderGeometry(2.2, 3.4, 1, 24, 1, true).translate(0, 0.5, 0));
  const holoGeo = bag.track(new THREE.PlaneGeometry(1, 1));
  const coneGeo = bag.track(new THREE.CylinderGeometry(3.2, 0.9, 1, 24, 1, true).translate(0, 0.5, 0));
  towers.forEach((t, i) => buildTower(ctx, t, i, { beamGeo, haloGeo, holoGeo, coneGeo }));
}

function logoSizeFor(w: number, d: number): number {
  return Math.min(w, d) * 0.8;
}

interface HqGeos {
  beamGeo: THREE.BufferGeometry;
  haloGeo: THREE.BufferGeometry;
  holoGeo: THREE.BufferGeometry;
  coneGeo: THREE.BufferGeometry;
}

function buildTower(ctx: BuildCtx, t: BoxOb, index: number, geos: HqGeos): void {
  const { bag, batch } = ctx;
  const brand = t.brand ? CHARACTER_BY_ID[t.brand] : null;
  // Saturated glow colors: pale brand primaries would bloom into a white haze (see brandGlow).
  const glow = brand ? brandGlow(brand.id) : { main: t.color ?? '#00f0ff', alt: '#ffffff' };
  const primary = glow.main;
  const secondary = glow.alt;
  const w = t.hw * 2;
  const d = t.hd * 2;
  const h = t.h;
  // Face the plaza: the side whose normal points toward the map center carries the door + name sign.
  const toCenter = Math.atan2(-t.x, -t.z);
  const facing = Math.round(toCenter / (Math.PI / 2)) * (Math.PI / 2);
  const p = batch.at(t.x, t.z, facing);

  // plinth + glass body + roof
  p.box('lit', 0, 0.3, 0, w + 0.8, 0.6, d + 0.8, '#181a2a');
  p.frame('glow', 0.62, w + 0.84, d + 0.84, 0.1, 0.05, primary, { intensity: 2.2 });
  p.box('glass', 0, h / 2, 0, w, h, d, '#0b1020');
  p.box('lit', 0, h + 0.25, 0, w + 0.3, 0.5, d + 0.3, '#151827');
  p.box('lit', 0, h + 0.9, 0, w * 0.55, 0.8, d * 0.55, '#1c2033');
  // window strips (horizontal bands) + corner trims
  for (let y = 1.8; y < h - logoSizeFor(w, d) - 1.2; y += 1.8) {
    const band = Math.round(y / 1.8) % 4 === 0 ? secondary : primary;
    const lvl = 0.9 + ((index * 7 + Math.round(y * 3)) % 5) * 0.18;
    p.box('glow', 0, y, d / 2 + 0.02, w * 0.92, 0.07, 0.02, band, { intensity: lvl });
    p.box('glow', 0, y, -d / 2 - 0.02, w * 0.92, 0.07, 0.02, band, { intensity: lvl });
    p.box('glow', w / 2 + 0.02, y, 0, 0.02, 0.07, d * 0.92, band, { intensity: lvl });
    p.box('glow', -w / 2 - 0.02, y, 0, 0.02, 0.07, d * 0.92, band, { intensity: lvl });
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1])
      p.box('glow', sx * (w / 2 + 0.04), h / 2 - 0.01, sz * (d / 2 + 0.04), 0.12, h - 0.02, 0.12, primary, {
        intensity: 1.7,
      });
  }
  p.frame('glow', h + 0.52, w + 0.34, d + 0.34, 0.1, 0.06, primary, { intensity: 2.2 });
  // entrance
  p.box('glow', 0, 1.3, d / 2 + 0.03, 1.8, 2.4, 0.03, '#dff8ff', { intensity: 1.4 });
  p.box('lit', 0, 2.75, d / 2 + 0.6, 3.2, 0.14, 1.2, '#1a1d2e');
  p.box('glow', 0, 2.665, d / 2 + 1.215, 3.24, 0.04, 0.04, primary, { intensity: 3 }); // proud of the canopy edges

  // badge on all four faces near the top (one merged mesh per tower)
  const logoSize = logoSizeFor(w, d);
  const planes: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const g = new THREE.PlaneGeometry(logoSize, logoSize);
    g.translate(0, 0, d / 2 + 0.06);
    g.rotateY(a);
    g.translate(0, h - logoSize / 2 - 0.9, 0);
    planes.push(g);
  }
  const logoGeo = bag.track(mergeGeometries(planes)!);
  for (const g of planes) g.dispose();
  const badge = brand ? badgeTexture(brand.id) : null;
  const logoMat = bag.track(
    // 0.85 keeps the (often white) badge art below the bloom threshold so it stays crisp instead of glaring
    new THREE.MeshBasicMaterial({ map: badge, color: hdr('#ffffff', 0.85), transparent: true }),
  );
  patchWorld(logoMat, { key: 'hq-logo' });
  const logos = new THREE.Mesh(logoGeo, logoMat);
  logos.position.set(t.x, 0, t.z);
  logos.rotation.y = facing;
  ctx.root.add(logos);

  // brand name sign over the entrance
  if (brand) {
    const nameTex = signTexture(bag, brand.name.toUpperCase(), {
      width: 1024,
      height: 192,
      font: FONT_DISPLAY,
      color: '#ffffff',
      glow: primary,
    });
    const sign = signPlane(bag, nameTex, w * 0.95, w * 0.95 * (192 / 1024), primary, 2.2);
    sign.position.set(0, 3.35, d / 2 + 0.07);
    const siteTex = signTexture(bag, brand.site, {
      width: 1024,
      height: 128,
      font: '600 {px}px "Space Grotesk", system-ui, sans-serif',
      color: '#e8fbff',
      glow: primary,
    });
    const site = signPlane(bag, siteTex, w * 0.7, w * 0.7 * (128 / 1024), '#ffffff', 1.3);
    site.position.set(0, 2.95, d / 2 + 1.25); // in front of the canopy trim (z d/2+1.22)
    const holder = new THREE.Group();
    holder.position.set(t.x, 0, t.z);
    holder.rotation.y = facing;
    holder.add(sign, site);
    ctx.root.add(holder);
  }

  // holographic rotating logo + projector cone + beacon
  const color = neon(primary, 1);
  const holoMat = bag.track(
    new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: badge },
        uColor: { value: color },
        uTime: { value: 0 },
        uSeed: { value: index * 1.37 },
      },
      vertexShader: HOLO_VERT,
      fragmentShader: HOLO_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  const holoSize = 6.5;
  const holo = new THREE.Mesh(geos.holoGeo, holoMat);
  holo.scale.set(holoSize, holoSize, 1);
  const holoY = h + 1.3 + holoSize / 2 + 1.4;
  holo.position.set(t.x, holoY, t.z);
  const beamMat = bag.track(
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: neon(primary, 1.4) }, uTime: { value: 0 }, uSeed: { value: index * 2.1 } },
      vertexShader: HOLO_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  const beam = new THREE.Mesh(geos.beamGeo, beamMat);
  beam.position.set(t.x, h + 1.3, t.z);
  beam.scale.y = 160;
  const halo = new THREE.Mesh(geos.haloGeo, beamMat);
  halo.position.set(t.x, h + 1.3, t.z);
  halo.scale.set(0.6, 60, 0.6);
  const coneMat = bag.track(
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: neon(primary, 0.6) }, uTime: { value: 0 }, uSeed: { value: index } },
      vertexShader: HOLO_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  const cone = new THREE.Mesh(geos.coneGeo, coneMat);
  cone.position.set(t.x, h + 1.3, t.z);
  cone.scale.y = holoY - h - 1.3 + holoSize * 0.3;
  for (const m of [holo, beam, halo, cone]) m.renderOrder = 3;
  ctx.root.add(holo, beam, halo, cone);
  // projector ring on the roof
  p.add('glow', new THREE.TorusGeometry(1, 0.06, 6, 32), 0, h + 1.32, 0, 1.2, 1.2, 1.2, primary, {
    rx: Math.PI / 2,
    intensity: 4,
  });
  ctx.light(t.x, 1.5, t.z + 0.001, primary, 2.2, 13);

  const phase = index * 0.7;
  ctx.animate((time) => {
    holo.rotation.y = time * 0.6 + phase;
    holo.position.y = holoY + Math.sin(time * 1.1 + phase) * 0.35;
    holoMat.uniforms.uTime!.value = time;
    beamMat.uniforms.uTime!.value = time;
    coneMat.uniforms.uTime!.value = time;
  });
}
