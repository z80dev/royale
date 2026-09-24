// Post-processing chain: RenderPass → UnrealBloom → OutputPass (ACES + sRGB) → "lens" pass (vignette,
// chromatic aberration, film grain) → SMAA (high) / FXAA (medium, low).
// Note: no MSAA render targets — UnrealBloomPass blending into a multisampled half-float target yields black
// frames on ANGLE/Metal, so anti-aliasing is done as a post pass on the final LDR image.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export type QualityLevel = 0 | 1 | 2;

export interface QualitySpec {
  dpr: number; // max device pixel ratio
  aa: 'smaa' | 'fxaa';
  shadowMap: number;
  bloomScale: number; // bloom resolution relative to canvas
}

export const QUALITY: Record<QualityLevel, QualitySpec> = {
  2: { dpr: 1.75, aa: 'smaa', shadowMap: 2048, bloomScale: 0.5 },
  1: { dpr: 1.25, aa: 'fxaa', shadowMap: 2048, bloomScale: 0.5 },
  0: { dpr: 1.0, aa: 'fxaa', shadowMap: 1024, bloomScale: 0.35 },
};

const LensShader = {
  name: 'LaunchpadLens',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAberration: { value: 0.0022 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.42 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 shift = c * r2 * uAberration * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + shift).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - shift).b;
      float vig = smoothstep(0.85, 0.15, r2 * (1.0 + uResolution.x / uResolution.y * 0.25));
      col *= mix(1.0 - uVignette, 1.0, vig);
      col += (vec3(0.02, 0.0, 0.05)) * (1.0 - vig);
      float g = hash(vUv * uResolution + fract(uTime * 13.7) * 100.0) - 0.5;
      col += g * uGrain * (1.0 - col * 0.6);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFx {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private readonly lens: ShaderPass;
  private readonly fxaa: FXAAPass;
  private readonly smaa: SMAAPass;
  private width = 1;
  private height = 1;
  private dpr = 1;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private quality: QualitySpec,
  ) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.4, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.lens = new ShaderPass(LensShader);
    this.composer.addPass(this.lens);
    this.fxaa = new FXAAPass();
    this.smaa = new SMAAPass();
    this.composer.addPass(this.fxaa);
    this.composer.addPass(this.smaa);
    this.applyAa();
  }

  private applyAa(): void {
    this.fxaa.enabled = this.quality.aa === 'fxaa';
    this.smaa.enabled = this.quality.aa === 'smaa';
  }

  setQuality(quality: QualitySpec): void {
    this.quality = quality;
    this.applyAa();
    this.setSize(this.width, this.height, this.dpr);
  }

  setSize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
    const bw = Math.max(1, Math.round(width * dpr * this.quality.bloomScale * 2));
    const bh = Math.max(1, Math.round(height * dpr * this.quality.bloomScale * 2));
    this.bloom.setSize(bw, bh); // UnrealBloomPass halves internally
    (this.lens.uniforms.uResolution!.value as THREE.Vector2).set(width * dpr, height * dpr);
  }

  render(time: number, dt: number): void {
    this.lens.uniforms.uTime!.value = time;
    this.composer.render(dt);
  }

  dispose(): void {
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
  }
}
