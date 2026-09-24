// "Liquidation Zone": a towering animated energy wall at the zone radius, red tint + drifting embers
// outside, and the next circle as a glowing dashed ring on the ground (ground rings live in the world patch).

import * as THREE from 'three';
import type { ZoneSnap } from '../../shared/protocol';
import { pointUniforms } from './world/plume';
import { Bag, worldUniforms } from './world/kit';

const WALL_HEIGHT = 60;
const EMBERS = 900;
const EMBER_SPAN = 120;
const BAND_LENGTH = 64; // metres of wall per repeat of the text band

const WALL_VERT = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const WALL_FRAG = /* glsl */ `
  uniform vec3 uZone; // cx, cz, r
  uniform float uTime;
  uniform float uPulse;
  uniform sampler2D uBand;
  varying vec3 vW;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
  }
  void main() {
    vec2 d = vW.xz - uZone.xy;
    float arc = atan(d.y, d.x) * uZone.z;
    float y = vW.y;
    vec2 hp = vec2(arc, y - uTime * 0.6) / 1.8;
    vec2 r = vec2(1.0, 1.7320508);
    vec2 a = mod(hp, r) - r * 0.5;
    vec2 b = mod(hp - r * 0.5, r) - r * 0.5;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    vec2 id = hp - gv;
    float edge = smoothstep(0.44, 0.5, hexDist(gv));
    float flash = step(0.975, h21(id + floor(uTime * 2.5))) * (1.0 - hexDist(gv) * 1.6);
    float fade = exp(-y / 14.0);
    float bottom = exp(-y * 1.3);
    float scan = pow(fract(y / 7.0 - uTime * 0.45), 24.0);
    // text band near the ground
    float bandV = (y - 0.55) / 1.6;
    float text = 0.0;
    if (bandV > 0.0 && bandV < 1.0) {
      text = texture2D(uBand, vec2(arc / ${BAND_LENGTH.toFixed(1)} - uTime * 0.05, bandV)).a;
    }
    vec3 magenta = vec3(1.0, 0.1, 0.55);
    vec3 red = vec3(1.0, 0.12, 0.08);
    vec3 col = mix(magenta, red, 0.5 + 0.5 * sin(arc * 0.02 + uTime * 0.7));
    float boost = 1.0 + uPulse * 2.5;
    float intensity = (0.035 + edge * 0.16 + scan * 0.35 + flash * 0.6) * fade * boost
      + bottom * boost + text * 1.4;
    gl_FragColor = vec4(col * intensity * 1.6, 1.0);
  }
`;

export class ZoneFx {
  private bag = new Bag();
  private wall: THREE.Mesh;
  private wallMat: THREE.ShaderMaterial;
  private embers: THREE.Points;
  private emberMat: THREE.ShaderMaterial;
  private pulseT = 0;

  constructor(scene: THREE.Scene) {
    const bag = this.bag;
    const band = bag.track(makeBandTexture());
    this.wallMat = bag.track(
      new THREE.ShaderMaterial({
        uniforms: {
          uZone: { value: new THREE.Vector3(0, 0, 100) },
          uTime: worldUniforms.uTime,
          uPulse: worldUniforms.uZonePulse,
          uBand: { value: band },
        },
        vertexShader: WALL_VERT,
        fragmentShader: WALL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    const wallGeo = bag.track(new THREE.CylinderGeometry(1, 1, 1, 192, 1, true).translate(0, 0.5, 0));
    this.wall = new THREE.Mesh(wallGeo, this.wallMat);
    this.wall.frustumCulled = false;
    this.wall.renderOrder = 8;
    this.wall.visible = false;

    const seeds = new Float32Array(EMBERS * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const eg = bag.track(new THREE.BufferGeometry());
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
    eg.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    this.emberMat = bag.track(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: worldUniforms.uTime,
          uPxScale: pointUniforms.uPxScale,
          uFocus: { value: new THREE.Vector3() },
          uZone: { value: new THREE.Vector3(0, 0, 1e5) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec4 seed;
          uniform float uTime;
          uniform float uPxScale;
          uniform vec3 uFocus;
          uniform vec3 uZone;
          varying float vA;
          void main() {
            vec2 base = seed.xy * ${EMBER_SPAN.toFixed(1)};
            float span = ${EMBER_SPAN.toFixed(1)};
            vec2 rel = mod(base - uFocus.xz + span * 0.5, span) - span * 0.5;
            float life = fract(uTime * (0.05 + seed.z * 0.08) + seed.w);
            vec3 p = vec3(uFocus.x + rel.x, life * 16.0, uFocus.z + rel.y);
            p.x += sin(uTime * 0.9 + seed.w * 40.0) * 1.5 * life;
            p.z += cos(uTime * 0.7 + seed.z * 40.0) * 1.5 * life;
            float outside = smoothstep(0.0, 3.0, length(p.xz - uZone.xy) - uZone.z);
            vA = outside * sin(life * 3.14159) * (0.5 + 0.5 * sin(uTime * 9.0 + seed.x * 50.0));
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = outside * (0.12 + seed.z * 0.2) * uPxScale / max(-mv.z, 0.1);
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            if (d > 0.5) discard;
            float a = smoothstep(0.5, 0.0, d) * vA;
            gl_FragColor = vec4(vec3(1.0, 0.35, 0.12) * a * 3.0, a);
          }
        `,
      }),
    );
    this.embers = new THREE.Points(eg, this.emberMat);
    this.embers.frustumCulled = false;
    this.embers.renderOrder = 7;
    this.embers.visible = false;
    scene.add(this.wall, this.embers);
  }

  /** Flash the wall + ground ring (zone phase change, shrink start). */
  pulse(): void {
    this.pulseT = 1;
  }

  update(zone: ZoneSnap | null, focus: THREE.Vector3, dt: number): void {
    this.pulseT = Math.max(0, this.pulseT - dt * 0.7);
    worldUniforms.uZonePulse.value = this.pulseT * this.pulseT;
    const zu = worldUniforms.uZone.value;
    const nu = worldUniforms.uZoneNext.value;
    if (!zone) {
      this.wall.visible = false;
      this.embers.visible = false;
      zu.w = 0;
      nu.w = 0;
      return;
    }
    this.wall.visible = true;
    this.embers.visible = true;
    this.wall.position.set(zone.cx, 0, zone.cz);
    this.wall.scale.set(zone.r, WALL_HEIGHT, zone.r);
    (this.wallMat.uniforms.uZone!.value as THREE.Vector3).set(zone.cx, zone.cz, zone.r);
    (this.emberMat.uniforms.uZone!.value as THREE.Vector3).set(zone.cx, zone.cz, zone.r);
    (this.emberMat.uniforms.uFocus!.value as THREE.Vector3).copy(focus);
    zu.set(zone.cx, zone.cz, zone.r, 1);
    const showNext = zone.phase >= 0 && zone.nr < zone.r - 0.5;
    const target = showNext ? 1 : 0;
    nu.w += (target - nu.w) * Math.min(1, dt * 3);
    if (showNext) nu.set(zone.ncx, zone.ncz, zone.nr, nu.w);
  }

  dispose(): void {
    this.wall.removeFromParent();
    this.embers.removeFromParent();
    this.bag.dispose();
  }
}

function makeBandTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = '900 64px "Orbitron", "Space Grotesk", system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  const text = '▲ LIQUIDATION ZONE ▲ POSITIONS CLOSED BEYOND THIS LINE ▲ NO MARGIN CALLS ▲ ';
  const w = g.measureText(text).width;
  g.save();
  g.scale(2048 / w, 1); // exactly one repeat per texture width → seamless wrap
  g.fillText(text, 0, 66);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
