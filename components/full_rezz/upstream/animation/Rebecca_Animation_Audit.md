> Historical component document. For FULL_REZZ 3.0 use docs/START_HERE.md, docs/API_CONTRACT.md and docs/FULL_REZZ_3.0_Product_Audit.md. Original measurements and contracts below retain their original version.

# FULL_REZZ — render and animation audit update

The updated test delivers 720 frames over 12 seconds at **1920 × 1080 / 60 fps**, rendered internally at 3840 × 2160 with 2× supersampling and H.264 CRF 14. It retains the same 23 scheduled drawings and exact supplied synthetic speech PCM at 1.25 seconds. This is renderer version 2.1.0 source, alongside the frozen 2.0 desktop/voice baseline.

## Results actually verified

| Check | Result |
| --- | --- |
| Exhaustive technical audit | 12 passed, 0 failed |
| Full-resolution decoded comparisons | All 720 frames and source pixel hashes |
| Full-resolution compression PSNR | Minimum 36.858 dB; mean 37.118 dB |
| Original speech | All 199,424 PCM samples unchanged at offset 30,000 / 24 kHz |
| Encoded voice | Correlation 0.99994928; signal/error 39.854 dB |
| Measured audio lag | 0 samples |
| Independent decoder | Full FFmpeg/ffprobe decode and audio agreement passed |
| Combined Python tests | 66 passed: 36 bridge tests plus 30 render/timing/input/worker tests |
| Player controls | 14 simulated DOM/media tests passed; embedded movie bytes verified |
| Human artistic/listening review | Pending; technical checks do not approve it |

Full image agreement measures encoding fidelity to the rendered raster, not artistic quality or Studio Trigger likeness. A 4.48 GB private lossless reference was reconstructed, and every frame matched its recorded raw SHA256 before exhaustive decoding checks. That reproducible temporary buffer is omitted from deliverables. The supplied raw-reference SHA256 is `c50935f09914487d9c9444a417cb20cac2f56f4b672b4dc07e892683fcf44d7a`.

## Rendering changes

The rational 24/1 source clock supports mixed ones/twos/threes for held procedural body samples, independently of 60 Hz facial/camera layers. Authored cel keys keep their original times. Faster sampling around turns reduces accidental coarse stepping. Premultiplied texture sampling avoids transparent-edge color bleed; opaque silhouette regression tests catch broken triangle sampling and holes. Directional warm/cool edge lights protect the inner face and held prop. A restrained 1.8% camera push keeps the design-space stance planted. The daylight background remains the original generated scene.

The same engineering thresholds flagged 45 events in the first mixed-timing draft and 32 after timing refinement. Within-pose flags fell from 15 to 3. These are debugging counts, not artistic improvement percentages. The maximum final hand step remains 45.829 design pixels at a drawing change; a pose redraw may be needed. The player can seek to every retained flag.

## Remaining findings

There are **32 artistic review flags**: 24 silhouette changes at drawing boundaries, five large hand steps at boundaries, two silhouette changes within a pose, and one large hand step within a pose. All remain visible. Deliberate exposure timing does not certify anatomy or excuse contour errors. The matte/contact check is 320 × 180 with a four-design-pixel quantization floor; exact planted coordinates and minimum triangle area are also renderer-reported guards. The minimum reported triangle area ratio is 0.451075, with 8 limited frames.

Mouth movement is energy-driven, not phoneme-aligned. No new character speech was synthesized in this update. The original character context, profile and all 47 original active reference-pack files remain intact. Arbitrary sidesteps, unseen views, 3D reconstruction, voice training-by-review, autonomous engram reasoning, performer likeness and Studio Trigger equivalence are not implemented or established.

The full character export is 60 fps. A separate synthetic 0.5-second raster/audio fixture encoded 60 frames at 120 fps; it is not a new character performance. Full 4K and 120/240 fps character export remain unmeasured. Native Windows execution and real browser/Qt playback remain untested.

## Files and incorporation

The Replit fileset contains `full_rezz_render/`, ready-to-render inputs under `animation/project/`, the production movie/comparison player, per-frame receipts/audit/mattes/witnesses, current tests, and the updated Replit task query. `docs/RENDER_AUDIT_GUIDE.md` documents processing, presets, audit coverage, limits and source integration. The independent model/voice evidence remains labeled as the 2.0 baseline.

The Python processing path uses Qt, NumPy and PyAV, with no Node or external FFmpeg executable required. Its new code is **not inside the previously compiled 2.0 installer**. Incorporate the module/assets in one rebuilt installer and complete native offline acceptance before claiming that revised Windows release is shipped. The existing installer hash and model licenses remain unchanged; the F5 weight configuration retains its noncommercial restriction.

The ten Google AI screenshots informed visual goals; they are not production measurement records. Exact series fps, universal software/camera timing and studio QA standards were not established. Primary reference scope is documented in the render guide.

## Separate geometry/continuity review (source 2.2)

The new screenshots motivated projection guides, without supplying CAD or camera measurements. Four separate continuity checks passed across the same 720 frames, with 1,440 projected boot/matte observations and three background regions. The review is `layout_review/FULL_REZZ_Scene_Continuity_Review.html`; its report records sampling and artistic limits. Current source tests: 84 passed. The preceding 66-test row is historical acceptance for the original renderer. Movie, voice, comparison player, original exhaustive audit and 32 artistic flags remain unchanged.
