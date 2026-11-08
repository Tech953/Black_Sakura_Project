# FULL_REZZ 2.2 render, geometry and audit guide

This update adds a working offline Python renderer for the existing authored 2D character project. It exports a production 1080p60 performance, supports mixed exposure timing, and separates technical audit results from artistic approval. The voice engine and compiled Windows installer remain the 2.0 baseline. The new renderer and bridge are incorporation source; they are not already inside that frozen EXE.

## Run the supplied project

The default Replit Run remains a standard-library data demo. Rendering is an optional local worker using Qt, NumPy and PyAV. The Windows baseline already packages those dependency families, including the offscreen Qt plugin. Incorporation must package the new Python module, authored assets and trusted entry point, then rebuild and test the installer. It does not need a separately installed Node, browser, Python, FFmpeg executable, API key or hosted model. The optional independent FFmpeg audit is a developer check.

For a development environment, install `requirements-render.txt` explicitly. These are the versions exercised on Linux. The existing Windows baseline pins NumPy 2.2.6; do not silently replace the frozen runtime or its manifest. Complete native acceptance when incorporating the source.

```sh
python3 -m full_rezz_render process animation/project ./my-render --preset production --fps 60
python3 -m full_rezz_render process animation/project ./another-render --preset production --fps 60 --ffmpeg ffmpeg --ffprobe ffprobe
```

Use a new output directory outside the input project. Existing renders are preserved. Cancellation/failure removes the temporary job instead of publishing a partial movie. Rendering has no model-inference or download step. Missing codecs and assets produce visible errors. Run the worker separately from the host web process; preserve the existing offline process guard and project locking when wiring it into the host.

The export writes the MP4, an exact PCM timeline, four full-resolution PNG witnesses, per-frame evidence and a compressed thumbnail/matte reference. Processing also creates a private full-resolution RGB reference in the system temporary directory, audits it, and releases it after the job. Production needs approximately 4.48 GB of temporary disk plus working space; capacity is checked before starting. The downloadable fileset omits this large buffer. Render again to repeat exhaustive comparisons. For separate developer steps, `render` returns its private `raw_reference_path`; pass it to `audit --raw-reference PATH`, then remove that job's buffer. `render --no-full-raster-reference` selects a portable subset explicitly.

## Quality settings

| Preset | Delivery size | Internal raster | H.264 CRF | Evidence |
| --- | --- | --- | --- | --- |
| Preview | 1280 × 720 | 1280 × 720 | 20 | Supported; small test fixtures exercised |
| Production | 1920 × 1080 | 3840 × 2160 | 14 | Complete 12-second character export and audits performed |
| Ultra | 3840 × 2160 | 7680 × 4320 | 12 | Configuration supported; full 4K character export not performed |

Delivery fps accepts integers from 60 to 240. The character export is 60 fps. A separate synthetic 0.5-second raster/audio fixture actually encoded 60 frames at 120 fps. That fixture is not a new voiced character performance or a real-time benchmark. Full 120/240 fps character output remains unmeasured.

Each processing job is bounded to 4,096 delivery frames, keeping its receipt and audit memory bounded. Longer performances need explicit clip segmentation; automatic long-form assembly is not implemented.

Supersampling improves edge filtering and compositing. It does not reconstruct missing linework or add anatomical detail to the source artwork. Compositing is 8-bit sRGB, with premultiplied-alpha texture sampling and Qt smooth downsampling; this is not an HDR or physically based light solver.

## Drawing timing and camera motion

`animation/project/render_config.json` owns a rational source clock, authored pose keys and half-open exposure ranges. The demonstrated source clock is 24/1, chosen for this project. It is not a measurement of the anime's delivery fps. Body mesh/breath samples hold on ones, twos or threes. At 60 fps, 24 Hz opportunities occupy alternating three/two output frames, 12 Hz occupies five, and 8 Hz alternates eight/seven. Integer arithmetic preserves phase without accumulated floating-point drift. Authored keys take precedence over a hold so an accent is not delayed.

The delivered performance still schedules 23 existing drawings. Held procedural samples are not new drawings. Facial aperture and eyelids use delivery fps; mouth activity stops on the exact speech-sample boundary. Lip movement follows audio energy, without phoneme alignment. A 1.8% camera push uses the ground pivot while the design-space contacts stay planted. No optical-flow blending is applied across cels.

Directional rim shading follows the current warm/cool palette and excludes the interior face and held prop. The supplied daylight background is retained. Strong neon lighting, smear drawings, impact frames, afterimages, distortion and cuts should be authored for an appropriate shot; the screenshots do not justify enabling them indiscriminately.

## Read the audit

`animation/render_evidence/audit_report.json` is the actual delivered run. `render_receipt.json` binds input assets, parameters, outputs and frame evidence. `audit_coverage` distinguishes an exhaustive run from a portable subset. Every run independently decodes all video frames and audio. Exhaustive runs also compare every full-resolution RGB frame and its raw SHA256. The optional second decoder checks the whole video and verifies decoded audio through FFmpeg/ffprobe.

The auditor checks presentation timestamps, dimensions, codec format, full image agreement, source/voice byte consistency, audio alignment and headroom, complete silhouettes, raster sole support, declared rig guards, exposure boundaries and mouth activity. Declared engineering thresholds remain in the config/report. Compression PSNR scores agreement with the rendered image; it does not score art, identity or studio likeness.

Silhouette changes and large authored hand steps become review flags, including drawing boundaries. The player can jump to each flagged frame. A technical pass never changes human review to Approved. Contact mattes are 320 × 180 with a four-design-pixel sampling floor; reported geometry provides an additional exact-coordinate check. Authored hand landmarks are proxies, not optical tracking. Review anatomy, expression, acting, contour continuity and pronunciation before approving a performance.

Voice PCM and the original character/reference profile remain unchanged. Review notes do not train the voice model or alter embeddings. New dialogue requires a new implemented animation timeline; this update does not automatically animate new speech or generate sidesteps, back views or unseen actions.

## Geometry guides and continuity (source 2.2)

Source 2.2 adds `geometry.py` and `layout.py`; the supplied 1080p60 movie remains the actual 2.1 render with its original exhaustive codec/audio audit. The new continuity report reviews the same media and saved rasters. It is not a new animation or a replacement for the original audit.

The two additional Google-summary screenshots suggest shared geometry for perspective and environmental continuity. They supply no CAD, game assets, wireframes or measured cameras. `docs/REFERENCE_CLAIMS.json` records their hashes and the scope of verification against primary pages. The strict Maya limitation and precise game-wireframe workflow remain unestablished by those pages.

`animation/project/scene_layout.json` is the current authored flat image-plane guide. World axes are right-handed and y-up; projected pixels begin at the upper left. Its orthographic camera maps `[x,720-y,0]` to image point `[x,y]`. Projected boot anchors follow the independently calculated ground-pivot shot push. The floor rectangle is a registration guide, not a reconstructed ground mesh. Keep `metric_geometry_verified` false until actual measurements have been reviewed.

```sh
python3 -m full_rezz_render layout animation/project animation/render_evidence ./my-layout-review --movie animation/Rebecca_Full_Voiced_Action.mp4
```

Use a new review directory. Existing results are preserved. The command writes a report, four SVG guides and self-contained HTML with the real witness images. Open it locally; no web service or Node is needed. Gold circles mark contacts, green lines the floor guide, and blue rectangles the background review regions.

`process()` automatically adds this review when `scene_layout.json` exists, retaining it under `OUTPUT/layout_review/`. It returns `scene_continuity` separately from codec/audio results. Either audit failing makes the job fail; technical passes leave artistic approval pending. Older projects without a layout retain the previous route. Direct `audit` runs the original codec/audio checks; direct `layout` runs only geometry/continuity checks.

Four continuity checks passed across 720 frames: binding project/media/witness bytes; independent camera/anchor agreement; actual opaque matte support for both projected boots; and registration of three declared background regions. There were 1,440 boot observations and 63 clear samples per region per frame. Background prediction uses area averages from the first 1920 × 1080 witness against saved 128 × 72 RGB thumbnails, avoiding aliasing from coarse reference interpolation. Maximum region error was below 0.60 RGB units against the declared limit of 8. This measures plate agreement, not visual art or studio similarity. Background sampling has a ten-design-pixel scale and boot mattes a four-pixel scale. Exact declared-coordinate agreement is not subpixel optical tracking.

Perspective projection uses vertical field of view, an eye/target/up look-at basis and near/far clipping. Edges are clipped in depth before division, then against the viewport. Orthographic projection uses vertical span. `schemas/full-rezz-scene-layout.schema.json` describes the portable format; the runtime additionally checks finite coordinates, camera degeneracy, unique IDs, edge references and region bounds. Formal JSON-Schema metaschema validation was not run; the actual authored guide and adverse cases passed the Python validator.

Locally exported vertex/edge arrays can guide props or scenery after manual registration. Native Maya/FBX/OBJ/CAD import, inferred depth, surface rendering, vehicle tracking and 3D occlusion are not implemented. `examples/perspective_wireframe_fixture.json` is a separate synthetic cube: load its camera with `Camera.from_dict()` and project edges with `Camera.segment()`. It is not part of this character scene or recovered Night City geometry.

The source passed 84 Python tests: 36 bridge, 30 renderer and 18 geometry/registration tests. New adverse cases cover changed camera receipts, shifted anchors, occluded regions, unexplained plate changes, fractional area sampling, clipped/hidden edges and invalid geometry. A synthetic 120 fps processing fixture exercised automatic continuity auditing offline. The existing player's 14 simulated tests remain prior evidence; its bytes and the movie are unchanged. The 32 artistic flags still need review. Native Windows/browser acceptance and studio-level artistic approval remain unperformed.

## Incorporate into the engram host

Keep the existing host's text/model system and character lore. Package `full_rezz_render/` alongside the existing bridge and voice engine, and include the supplied `animation/project/` inputs. Expose quality/fps/output controls through the host's job mechanism; run the renderer and auditor in an isolated offline worker. Return the receipt, audit coverage, technical failures and pending review flags. Preserve actual profile mapping and source hashes. Update `examples/rebecca_action.json` only after a new export is audited; use its actual media SHA256 and timeline. See `TASK_QUERY.md` for the full receiving-project task.

The source uses dependencies already represented in the 2.0 runtime, but the additional module is not present in its frozen installer. A single updated Windows installer must include this code/assets, regenerate its payload hashes, rebuild, and pass clean-machine offline installation/render/playback checks. No new installer or native Windows execution is claimed by this update. The existing F5 noncommercial weight restriction and all media/model/runtime license notices remain applicable.

## Reference verification

The ten supplied Google AI summaries are visual direction, not authoritative production measurements. No fixed studio-wide cadence, strict “ones only for action” rule, universal camera cadence, exact series 23.976 fps, or specific software stack was recovered from them. This update adopts useful goals—authored timing, readable poses and restrained compositing—without certifying those summaries.

- [Studio Trigger's official credits](https://www.st-trigger.co.jp/works/cyberpunk-edgerunners/) identify separate character/animation, color, art and compositing roles; they do not specify a fps policy or audit standard.
- [Celsys' exposure-sheet format](https://www.celsys.com/en/xdts/) separates timeline information from a particular application. This update uses its own JSON, not an implemented XDTS importer/exporter.
- [Clip Studio's official animation canvas manual](https://help.clip-studio.com/en-us/manual_en/210_file/Creating_a_New_Canvas.htm) describes fps as how many cels can be shown per second; a high output rate alone does not supply artwork.
- [IIT Bombay's exposure-sheet conventions](https://www.dsource.in/course/exposure-sheet/conventions) explain the 24 fps ones/twos convention. The project extends the clock mathematically for threes and 60+ delivery fps.

Primary pages checked 11 October 2026. No official motion clip, production exposure sheet or studio QA criteria were supplied. Studio Trigger equivalence, exact anime motion, performer likeness and human listening/acting acceptance remain unverified.
