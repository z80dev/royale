// Builds the capture client: the real game bundle (client/main.ts) plus a one-line hook exposing its singletons
// as globalThis.__LR, and the virtual-time prelude. Nothing in the game source changes.
// Output: films/promo/capture/dist/{prelude.js,main.js}. Usage: bun films/promo/capture/build.ts

import { join } from 'node:path';

const here = import.meta.dir;
const root = join(here, '../../..');
const outdir = join(here, 'dist');

const HOOK = `
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import type { Scene } from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
;(globalThis as unknown as { __LR: unknown }).__LR = {
  state, renderer, ui, net, input, audio, BokehPass,
  get map() { return currentMap; },
  get cinema() {
    return renderer as unknown as { scene: Scene; post: { composer: EffectComposer } };
  },
};
`;

const main = await Bun.build({
  entrypoints: [join(root, 'client/main.ts')],
  outdir,
  target: 'browser',
  minify: false,
  plugins: [
    {
      name: 'capture-hook',
      setup(build) {
        build.onLoad({ filter: /client\/main\.ts$/ }, async (args) => ({
          contents: (await Bun.file(args.path).text()) + HOOK,
          loader: 'ts',
        }));
      },
    },
  ],
});
if (!main.success) throw new AggregateError(main.logs, 'capture bundle failed');

const prelude = await Bun.build({
  entrypoints: [join(here, 'prelude.ts')],
  outdir,
  target: 'browser',
  format: 'iife',
});
if (!prelude.success) throw new AggregateError(prelude.logs, 'prelude bundle failed');
console.log(`capture client built → ${outdir}`);
