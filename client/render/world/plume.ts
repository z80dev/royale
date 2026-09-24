// GPU-animated particle plumes (rocket steam, Luna smoke, hashrate heat). Positions are a pure function of
// time + per-particle seeds evaluated in the vertex shader, so plumes cost zero CPU per frame.

import * as THREE from 'three';
import { Rng } from '../../../shared/rng';
import { worldUniforms, type BuildCtx } from './kit';

/** Pixel scale for size-attenuated points: drawingBufferHeight / (2·tan(fov/2)). Renderer keeps it current. */
export const pointUniforms = { uPxScale: { value: 800 } };

export interface PlumeOpts {
  x: number;
  y: number;
  z: number;
  count: number;
  color: THREE.ColorRepresentation;
  colorEnd?: THREE.ColorRepresentation;
  radius: number; // spawn disc radius
  spread: number; // outward drift over life (m)
  rise: number; // vertical travel over life (m)
  life: number; // seconds
  size: number; // start size (m)
  grow: number; // end size multiplier
  opacity: number;
  additive?: boolean;
}

export function buildPlume(ctx: BuildCtx, opts: PlumeOpts): void {
  const rng = new Rng(Math.round(opts.x * 131 + opts.z * 71) ^ ctx.map.seed);
  const seeds = new Float32Array(opts.count * 4);
  for (let i = 0; i < opts.count; i++) {
    seeds[i * 4] = rng.next(); // phase
    seeds[i * 4 + 1] = rng.range(0, Math.PI * 2); // angle
    seeds[i * 4 + 2] = Math.sqrt(rng.next()); // radial
    seeds[i * 4 + 3] = rng.range(0.7, 1.3); // speed/size jitter
  }
  const geo = ctx.bag.track(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(opts.count * 3), 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, opts.rise / 2, 0), opts.rise + opts.spread + opts.radius);
  const mat = ctx.bag.track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTime: worldUniforms.uTime,
        uPxScale: pointUniforms.uPxScale,
        uColor: { value: new THREE.Color(opts.color) },
        uColorEnd: { value: new THREE.Color(opts.colorEnd ?? opts.color) },
        uParams: { value: new THREE.Vector4(opts.radius, opts.spread, opts.rise, opts.life) },
        uSize: { value: new THREE.Vector3(opts.size, opts.grow, opts.opacity) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uTime;
        uniform float uPxScale;
        uniform vec4 uParams;
        uniform vec3 uSize;
        varying float vT;
        void main() {
          float t = fract(uTime / (uParams.w * seed.w) + seed.x);
          vT = t;
          float ease = 1.0 - (1.0 - t) * (1.0 - t);
          float r = seed.z * uParams.x + ease * uParams.y;
          vec3 p = vec3(cos(seed.y) * r, t * uParams.z * seed.w, sin(seed.y) * r);
          p.x += sin(uTime * 0.7 + seed.x * 20.0) * t * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize.x * mix(1.0, uSize.y, t) * seed.w * uPxScale / max(-mv.z, 0.1);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uColorEnd;
        uniform vec3 uSize;
        varying float vT;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float soft = smoothstep(0.5, 0.1, r);
          float a = soft * uSize.z * smoothstep(0.0, 0.12, vT) * (1.0 - vT);
          gl_FragColor = vec4(mix(uColor, uColorEnd, vT), a);
        }
      `,
    }),
  );
  const points = new THREE.Points(geo, mat);
  points.position.set(opts.x, opts.y, opts.z);
  points.renderOrder = 4;
  ctx.root.add(points);
}
