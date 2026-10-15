import { useCallback, useEffect, useRef, useState } from "react";
import {
  AnimationMixer,
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

type PresenterMode = "2d" | "3d";
type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

const VIEWS = [
  { id: "front", label: "Front", azimuth: 0, elevation: 5 },
  {
    id: "front_three_quarter",
    label: "Front 3/4",
    azimuth: 45,
    elevation: 5,
  },
  { id: "profile", label: "Profile", azimuth: 90, elevation: 5 },
  {
    id: "rear_three_quarter",
    label: "Rear 3/4",
    azimuth: 145,
    elevation: 5,
  },
  { id: "rear", label: "Rear", azimuth: 180, elevation: 5 },
  { id: "low_angle", label: "Low angle", azimuth: -35, elevation: -15 },
] as const;

const ASSET_NAMES = {
  front: "front.png",
  front_three_quarter: "front_three_quarter.png",
  profile: "profile.png",
  rear_three_quarter: "rear_three_quarter.png",
  rear: "rear.png",
  low_angle: "low_angle.png",
} as const;

interface FullRezzPresenterProps {
  open: boolean;
  onClose: () => void;
  audioUrl?: string | null;
  assetBaseUrl: string;
  authFetch: AuthFetch;
}

interface Orbit {
  azimuth: number;
  elevation: number;
}

function assetUrl(base: string, name: string): string {
  return `${base}/${encodeURIComponent(name)}`;
}

export function FullRezzPresenter({
  open,
  onClose,
  audioUrl,
  assetBaseUrl,
  authFetch,
}: FullRezzPresenterProps) {
  const [mode, setMode] = useState<PresenterMode>("3d");
  const [viewId, setViewId] = useState<(typeof VIEWS)[number]["id"]>("front");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [gltf, setGltf] = useState<GLTF | null>(null);
  const [clipName, setClipName] = useState("");
  const [assetError, setAssetError] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [orbit, setOrbit] = useState<Orbit>({ azimuth: 0, elevation: 5 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const assetPanelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const modelCenterRef = useRef(new Vector3());
  const modelRadiusRef = useRef(1);

  const selectedView = VIEWS.find((view) => view.id === viewId) ?? VIEWS[0];
  const setAudioState = useCallback((playing: boolean) => {
    setIsPlaying(playing);
  }, []);

  useEffect(() => {
    if (!open || mode !== "2d") {
      setImageUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setAssetError("");
    void authFetch(assetUrl(assetBaseUrl, ASSET_NAMES[viewId]))
      .then(async (response) => {
        if (!response.ok) throw new Error("The selected 2D view is unavailable.");
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAssetError(
            error instanceof Error ? error.message : "Could not load this view.",
          );
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetBaseUrl, authFetch, mode, open, viewId]);

  useEffect(() => {
    if (!open || mode !== "3d") {
      setGltf(null);
      return;
    }
    let cancelled = false;
    setAssetError("");
    void authFetch(assetUrl(assetBaseUrl, "studio_unit.gltf"))
      .then(async (response) => {
        if (!response.ok) throw new Error("The rigged 3D asset is unavailable.");
        return response.text();
      })
      .then(
        (source) =>
          new Promise<GLTF>((resolve, reject) => {
            new GLTFLoader().parse(source, "", resolve, reject);
          }),
      )
      .then((model) => {
        if (!cancelled) {
          setGltf(model);
          setClipName(model.animations[0]?.name ?? "");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAssetError(
            error instanceof Error
              ? error.message
              : "Could not load the rigged 3D asset.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assetBaseUrl, authFetch, mode, open]);

  useEffect(() => {
    if (!open || mode !== "3d" || !gltf || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const container = assetPanelRef.current;
    if (!container) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
      });
    } catch {
      setAssetError("WebGL is unavailable in this browser.");
      return;
    }

    const scene = new Scene();
    scene.background = new Color("#080e14");
    scene.add(new HemisphereLight(0xcde8ff, 0x25202a, 2.1));
    const keyLight = new DirectionalLight(0xffe8d3, 2.3);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);
    const fillLight = new DirectionalLight(0x66d9ff, 1.2);
    fillLight.position.set(-4, 1, -3);
    scene.add(fillLight);

    const model = gltf.scene.clone(true);
    scene.add(model);
    const bounds = new Box3().setFromObject(model);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.5);
    model.position.sub(center);
    modelCenterRef.current.set(0, 0, 0);
    modelRadiusRef.current = radius;

    const camera = new PerspectiveCamera(34, 1, 0.01, radius * 100);
    cameraRef.current = camera;
    const mixer = new AnimationMixer(model);
    const clip =
      gltf.animations.find((animation) => animation.name === clipName) ??
      gltf.animations[0];
    const action = clip ? mixer.clipAction(clip) : null;
    action?.play();

    let animationFrame = 0;
    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(resize);
    resizeObserver?.observe(container);

    const render = () => {
      const audio = audioRef.current;
      if (action && clip) {
        const clipTime = (audio?.currentTime ?? 0) % Math.max(clip.duration, 0.001);
        mixer.setTime(clipTime);
      }
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    animationFrame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      mixer.stopAllAction();
      scene.remove(model);
      renderer.dispose();
      cameraRef.current = null;
    };
  }, [clipName, gltf, mode, open]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera || mode !== "3d") return;
    const radius = modelRadiusRef.current * 2.7;
    const azimuth = (orbit.azimuth * Math.PI) / 180;
    const elevation = (orbit.elevation * Math.PI) / 180;
    const horizontal = Math.cos(elevation) * radius;
    camera.position.set(
      modelCenterRef.current.x + Math.sin(azimuth) * horizontal,
      modelCenterRef.current.y + Math.sin(elevation) * radius,
      modelCenterRef.current.z + Math.cos(azimuth) * horizontal,
    );
    camera.lookAt(modelCenterRef.current);
  }, [gltf, mode, orbit]);

  useEffect(() => {
    if (!open) {
      setAudioState(false);
      setCurrentTime(0);
      setAssetError("");
    }
  }, [open, setAudioState]);

  const chooseView = (nextView: (typeof VIEWS)[number]["id"]) => {
    setViewId(nextView);
    const view = VIEWS.find((candidate) => candidate.id === nextView);
    if (view) setOrbit({ azimuth: view.azimuth, elevation: view.elevation });
  };

  const startDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({ x: event.clientX, y: event.clientY });
  };
  const moveDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStart) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    setOrbit((current) => ({
      azimuth: current.azimuth - dx * 0.55,
      elevation: Math.max(-70, Math.min(70, current.elevation + dy * 0.45)),
    }));
    setDragStart({ x: event.clientX, y: event.clientY });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="full-rezz-presenter-title"
    >
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden border border-cyan-400/30 bg-[#071016] text-foreground shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-cyan-400/20 px-5 py-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cyan-300/70">
              FULL_REZZ · browser presenter
            </p>
            <h2
              id="full-rezz-presenter-title"
              className="mt-1 text-lg font-semibold"
            >
              Studio Unit demonstration
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Neutral rigged demo asset—not the selected engram’s likeness or
              authored character.
            </p>
          </div>
          <button
            type="button"
            className="rounded border border-border px-3 py-1.5 font-mono text-xs hover:bg-white/5"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <section className="min-h-[320px]">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex border border-border p-0.5">
                {(["2d", "3d"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    className={`px-3 py-1 font-mono text-[10px] uppercase ${
                      mode === value ? "bg-cyan-400/20 text-cyan-100" : "text-muted-foreground"
                    }`}
                    onClick={() => setMode(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                Camera / view
                <select
                  value={viewId}
                  onChange={(event) =>
                    chooseView(event.target.value as (typeof VIEWS)[number]["id"])
                  }
                  className="border border-border bg-[#0b171e] px-2 py-1 text-foreground"
                >
                  {VIEWS.map((view) => (
                    <option key={view.id} value={view.id}>
                      {view.label}
                    </option>
                  ))}
                </select>
              </label>
              {mode === "3d" && gltf?.animations.length ? (
                <label className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                  Authored clip
                  <select
                    value={clipName}
                    onChange={(event) => setClipName(event.target.value)}
                    className="border border-border bg-[#0b171e] px-2 py-1 text-foreground"
                  >
                    {gltf.animations.map((animation) => (
                      <option key={animation.uuid} value={animation.name}>
                        {animation.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <div
              ref={assetPanelRef}
              className="relative h-[min(58vh,38rem)] min-h-[320px] overflow-hidden border border-cyan-400/20 bg-[#080e14]"
            >
              {mode === "2d" ? (
                imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={`Studio Unit ${selectedView.label.toLowerCase()} reference view`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-center font-mono text-xs text-muted-foreground">
                    {assetError || "Loading calibrated view…"}
                  </div>
                )
              ) : (
                <>
                  <canvas
                    ref={canvasRef}
                    aria-label="Interactive skinned 3D Studio Unit model; drag to orbit the camera"
                    className="h-full w-full touch-none"
                    onPointerDown={startDrag}
                    onPointerMove={moveDrag}
                    onPointerUp={() => setDragStart(null)}
                    onPointerCancel={() => setDragStart(null)}
                  />
                  {!gltf && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center font-mono text-xs text-muted-foreground">
                      {assetError || "Loading rigged glTF surface…"}
                    </div>
                  )}
                </>
              )}
              {assetError && mode === "3d" && gltf && (
                <p className="absolute bottom-2 left-2 bg-black/80 px-2 py-1 font-mono text-[10px] text-amber-200">
                  {assetError}
                </p>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="border border-border/70 p-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-cyan-200/70">
                Speech clock
              </p>
              {audioUrl ? (
                <>
                  <audio
                    ref={audioRef}
                    controls
                    preload="metadata"
                    src={audioUrl}
                    className="mt-3 w-full"
                    onPlay={() => setAudioState(true)}
                    onPause={() => setAudioState(false)}
                    onEnded={() => setAudioState(false)}
                    onTimeUpdate={(event) =>
                      setCurrentTime(event.currentTarget.currentTime)
                    }
                  />
                  <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                    The authored 3D clip follows the audio element clock. This
                    is not phoneme alignment or inferred lip sync.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  No saved speech audio is attached. Generate speech for a
                  saved assistant reply to preview an audio-timed action.
                </p>
              )}
            </div>

            <div className="border border-border/70 p-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-cyan-200/70">
                Supported in this asset
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>Six supplied calibrated 2D views</li>
                <li>One skinned glTF surface and its authored clips</li>
                <li>Preset camera angles plus pointer orbit in 3D</li>
                <li>
                  {isPlaying
                    ? `Audio playing at ${currentTime.toFixed(2)}s`
                    : "Audio-timed clip paused"}
                </li>
              </ul>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground/80">
              2D views are static images. Unsupported motions, unseen views,
              phoneme timing, and character-specific likeness are not
              synthesized.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
