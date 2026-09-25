# End card: `footage/end-slabs.mp4`

`endcard.py` builds the end-card shot procedurally from an empty Blender file: the ten badges from
`public/badges/*.png` as glossy rounded slabs slamming onto a wet neon floor. There is no `.blend` and
every random choice uses a fixed seed, so re-running it gives the same frames. It uses Blender 5.2 and EEVEE,
at 1920×1080, 60 fps, 390 frames (6.5 s). Blender frame N is clip frame N.

For the first 1.6 s the wet floor is dark and empty. A faint mint (`#19e3a7`) sheen glides left to right
across the far floor, drawn by the floor shader itself so no light source shows in the puddles. Slams land on
frames 96 104 111 119 126 134 141 149 156 164, which is `round(96 + 7.5·i)`: 16th notes at 120 BPM, starting
at 1.6 s. The badges go left to right in roster order, and bankr's slam at 164 also sends the shared floor
pulse.

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender

# stills for look-dev (half res, fewer samples, ~1 s/frame) → /tmp/end-slabs-preview/0104.png …
$B -b --factory-startup -P films/promo/blender/endcard.py -f 60,104,164,389 -- --preview --out /tmp/end-slabs-preview

# full render → /tmp/end-slabs-frames/0000.png … 0389.png  (~3.5 s/frame, ≈23 min on the M-series Mac)
$B -b --factory-startup -P films/promo/blender/endcard.py -a

# encode (a few seconds)
ffmpeg -framerate 60 -start_number 0 -i /tmp/end-slabs-frames/%04d.png -c:v libx264 -preset slow -crf 16 \
  -profile:v high -pix_fmt yuv420p -g 30 -keyint_min 30 -sc_threshold 0 -colorspace bt709 \
  -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart films/promo/footage/end-slabs.mp4
```

The view transform is Khronos PBR Neutral, not AgX. It rolls highlights off in the same filmic way, but it
passes base colours through unchanged, so the logos keep their true colours. Under AgX, uniswap's pink came out
about 40/255 greyer. A small offset in the compositor lifts pure black to about `#04060a`, the black of the game
footage.

The film finds the clip through `footage/manifest.json` entry `end-slabs` (duration 6.5, moments at 1.6 and
2.733 s). It isn't a capture clip, so add that entry by hand if the manifest is rebuilt; `capture.ts` keeps
unknown entries when it upserts.

# Transparent title: `footage/title-logo.webm`

`title.py` builds the two-line, bevelled 3D title from an empty scene, without a `.blend` file or random
simulation. Blender 5.2 / EEVEE renders 1920×1080, 60 fps, frames **0–389** (6.5 s). Frame N is time N/60.
The camera is 45 mm with about 9° yaw and a 1.2% push from 0.8–5.6 s. The held logo is approximately
1440 px wide, vertically centred near y=520; y=760–820 is left clear for a separate kicker.

- **Frames 0 and 30:** LAUNCHPAD and ROYALE start their opposite-side, camera-near slams. They land on
  **7 and 37** (0.117 and 0.617 s), then make a small damped overshoot settle.
- **30–48:** the mint neon face flickers on.
- **60–120:** a narrow, diagonally tilted white light bar sweeps left to right across both words.
- **336–359:** individual letters leave formation, tumble, and fly past the camera.
- **360–389:** empty transparent handle.

LAUNCHPAD is polished chrome (metallic 1.0, roughness 0.08) with a subtly crowned normal profile:
its face reflects a bright cool studio sky, a dark horizon band, and a warm pink lower kick.
ROYALE has an inset emissive mint face with a brighter centre and deeper `#0fae85` edges; a dark metallic
base preserves saturation beneath white specular glints. Both words have crisp glossy bevels, with a
mint `#19e3a7` area rim above and behind. The bevel/extrusion is about **18% of cap height**.
The procedural HDR studio world includes hot magenta/teal strips, but **Transparent Film** keeps it
out of the image. As in `endcard.py`,
the view transform is Khronos PBR Neutral and the covered image receives the same calibrated black lift.
A dilated, Gaussian-blurred black silhouette at 45% opacity is composited behind the title, into its alpha.
It is not an opaque background plate. The compositor works premultiplied internally; PNG output is straight RGBA.

The repository's `unbounded.ttf` is variable with default `wght=400`; Blender does not select its 900 axis.
The title therefore uses **`fonts/Unbounded-Black.ttf`**, the static weight-900 font downloaded from
[googlefonts/unbounded](https://github.com/googlefonts/unbounded/blob/main/fonts/ttf/Unbounded-Black.ttf).
It is covered by the adjacent `fonts/OFL.txt` (SIL OFL 1.1).
SHA-256: `55c8f10ee36070b433de68f8757b0e1c027053c5aeadb91ee8d97e66e055ec67`.

Run from the repository root:

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender

# Half-resolution look-dev; --python-exit-code avoids rendering after a script error.
$B -b --factory-startup --python-exit-code 1 -P films/promo/blender/title.py \
  -f 4,33,90,210,348,360 -- --preview --out /tmp/title-logo-preview

# Full RGBA PNG sequence, 96 samples and four motion-blur steps.
time $B -b --factory-startup --python-exit-code 1 -P films/promo/blender/title.py -a

# VP9 alpha. Keep libvpx, yuva420p, and auto-alt-ref=0.
ffmpeg -y -framerate 60 -start_number 0 -i /tmp/title-logo-frames/%04d.png \
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 18 -row-mt 1 -auto-alt-ref 0 \
  films/promo/footage/title-logo.webm

# Force the alpha-aware decoder (ffprobe 9 supports -c).
# The native VP9 decoder can misleadingly report yuv420p and discard alpha.
ffprobe -v error -c:v libvpx-vp9 -count_frames \
  -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_read_frames:stream_tags=alpha_mode:format=duration \
  -of json films/promo/footage/title-logo.webm

# Review the encoded asset, not only the Blender frames.
mkdir -p /tmp/title-logo-review
ffmpeg -y -ss 9 -i films/promo/footage/city.mp4 -frames:v 1 -update 1 /tmp/title-logo-review/plate.png
for t in 0.06 0.55 1.5 3.5 5.8; do
  ffmpeg -y -c:v libvpx-vp9 -i films/promo/footage/title-logo.webm \
    -ss "$t" -frames:v 1 -update 1 "/tmp/title-logo-review/alpha-$t.png"
  ffmpeg -y -i /tmp/title-logo-review/plate.png -i "/tmp/title-logo-review/alpha-$t.png" \
    -filter_complex '[0:v][1:v]overlay=alpha=straight:format=auto' -frames:v 1 -update 1 \
    "/tmp/title-logo-review/comp-$t.png"
done
```

Check the decoded PNG's alpha as well as `alpha_mode=1`: the title hold must contain zero, partial, and
fully opaque alpha; every pixel in the 6.0–6.5 s handle must be zero. The script doesn't touch the manifest or the
film: the film finds the asset through manifest entry `title-logo` (`file: title-logo.webm`, duration 6.5, fps 60,
added by hand like `end-slabs`) and composites it as an alpha layer from `timeline.js` `LAYERS`.

Verified polished-chrome production render: **578.57 s** for Blender, **10.26 s** for encoding while
other capture jobs shared this workstation. The delivered WebM probes as `vp9 / yuva420p`,
1920×1080, `60/1`, 390 frames, 6.500 s, `alpha_mode=1`.
The decoded 3.5 s frame's near-opaque bounds are `(240,315)–(1684,726)`: 1444 px wide and centred at
`(962,520.5)`. Its kicker band has zero alpha. All 30 decoded handle frames have alpha exactly zero.
All five final `comp-*.png` reviews were inspected over `city.mp4` at 9 s for legibility, saturated mint,
the chrome horizon band and diagonal glint, motion blur, and alpha edges.
