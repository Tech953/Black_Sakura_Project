import { useEffect, useRef, useState } from "react";
import { LANGUAGES } from "@workspace/i18n";
import { Button } from "@/components/ui/button";
export interface SpeechSettings {
  synthesis_language: string;
  speech_engine: "f5" | "espeak";
}
type AuthFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** ASR returns an editable draft; it never sends a chat message automatically. */
export function LocalVoiceControls({
  conversationId,
  endpoint,
  authFetch,
  disabled,
  onTranscript,
  settings,
  onSettings,
}: {
  conversationId: number;
  endpoint: string;
  authFetch: AuthFetch;
  disabled: boolean;
  onTranscript: (text: string) => void;
  settings: SpeechSettings;
  onSettings: (settings: SpeechSettings) => void;
}) {
  const [language, setLanguage] = useState("auto");
  const [state, setState] = useState<
    "idle" | "requesting" | "recording" | "transcribing"
  >("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [available, setAvailable] = useState(false);
  const [supported, setSupported] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  function release() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  function cancel() {
    generation.current++;
    request.current?.abort();
    request.current = null;
    if (recorder.current) {
      recorder.current.onstop = null;
      if (recorder.current.state !== "inactive") recorder.current.stop();
    }
    recorder.current = null;
    release();
    setState("idle");
  }
  useEffect(() => {
    setSupported(
      typeof MediaRecorder !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia),
    );
    const controller = new AbortController();
    void authFetch(`${endpoint}/status`, { signal: controller.signal })
      .then(async (r) => {
        const value = await r.json();
        if (controller.signal.aborted) return;
        setAvailable(r.ok && value.available === true);
        if (!value.available)
          setNotice(value.reason ?? "Local voice runtime is unavailable.");
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setNotice("Local voice runtime is unavailable.");
      });
    return () => {
      controller.abort();
      generation.current++;
      request.current?.abort();
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state !== "inactive") recorder.current.stop();
      }
      release();
    };
  }, [authFetch, endpoint]);
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled]);
  async function start() {
    if (disabled || !available || state !== "idle") return;
    const version = ++generation.current;
    setError("");
    setNotice("");
    setState("requesting");
    try {
      const captured = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (version !== generation.current) {
        captured.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = captured;
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      const recording = new MediaRecorder(
        captured,
        type ? { mimeType: type } : undefined,
      );
      recorder.current = recording;
      const chunks: Blob[] = [];
      let bytes = 0;
      recording.ondataavailable = (e) => {
        if (version !== generation.current) return;
        bytes += e.data.size;
        if (bytes > 12 * 1024 * 1024) {
          cancel();
          setError("Recording exceeds 12 MiB. Record a shorter clip.");
          return;
        }
        if (e.data.size) chunks.push(e.data);
      };
      recording.onerror = () => {
        if (version === generation.current) {
          cancel();
          setError("Microphone recording failed. Please try again.");
        }
      };
      recording.onstop = () => {
        release();
        recorder.current = null;
        if (version !== generation.current) return;
        setState("transcribing");
        const controller = new AbortController();
        request.current = controller;
        const form = new FormData();
        form.set(
          "file",
          new Blob(chunks, { type: recording.mimeType || "audio/webm" }),
          "microphone.audio",
        );
        form.set("language", language);
        void authFetch(
          `${endpoint}/conversations/${conversationId}/transcription`,
          { method: "POST", body: form, signal: controller.signal },
        )
          .then(async (r) => {
            const result = await r.json();
            if (!r.ok)
              throw new Error(result.error ?? "Local transcription failed.");
            if (version !== generation.current) return;
            if (typeof result.text === "string" && result.text.trim()) {
              onTranscript(result.text.trim());
              setNotice(
                "Transcript added to your draft. Review it before sending.",
              );
            } else
              setNotice("No speech was recognized. Try a clearer recording.");
          })
          .catch((failure: unknown) => {
            if (version === generation.current && !controller.signal.aborted)
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Local transcription failed.",
              );
          })
          .finally(() => {
            if (version === generation.current) {
              request.current = null;
              setState("idle");
            }
          });
      };
      recording.start(1000);
      setState("recording");
      timer.current = setTimeout(() => {
        if (recording.state === "recording") recording.stop();
      }, 55_000);
    } catch (failure) {
      if (version === generation.current) {
        release();
        setState("idle");
        setError(
          failure instanceof Error
            ? failure.message
            : "Microphone access failed.",
        );
      }
    }
  }
  return (
    <div className="max-w-4xl mx-auto mb-3 space-y-2 text-xs font-mono">
      <div className="flex flex-wrap items-center gap-2">
        <label>
          Transcription language{" "}
          <select
            aria-label="Transcription language"
            value={language}
            disabled={disabled || state !== "idle"}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-card border border-border p-1"
          >
            <option value="auto">Automatic</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}
              </option>
            ))}
          </select>
        </label>
        {state === "recording" ? (
          <Button
            type="button"
            size="sm"
            onClick={() => recorder.current?.stop()}
          >
            Stop and transcribe locally
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !available || !supported || state !== "idle"}
            onClick={() => void start()}
          >
            {state === "transcribing"
              ? "Transcribing locally…"
              : state === "requesting"
                ? "Requesting microphone…"
                : "Record microphone"}
          </Button>
        )}
        {state !== "idle" && (
          <Button type="button" size="sm" variant="outline" onClick={cancel}>
            Cancel recording or transcription
          </Button>
        )}
        <label>
          Speech language{" "}
          <select
            aria-label="Speech language"
            value={settings.synthesis_language}
            disabled={disabled}
            onChange={(e) =>
              onSettings({ ...settings, synthesis_language: e.target.value })
            }
            className="bg-card border border-border p-1"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Voice engine{" "}
          <select
            aria-label="Voice engine"
            value={settings.speech_engine}
            disabled={disabled}
            onChange={(e) =>
              onSettings({
                ...settings,
                speech_engine: e.target
                  .value as SpeechSettings["speech_engine"],
              })
            }
            className="bg-card border border-border p-1"
          >
            <option value="f5">
              Reference-conditioned (English / Mandarin)
            </option>
            <option value="espeak">Generic multilingual (experimental)</option>
          </select>
        </label>
      </div>
      <p className="text-muted-foreground">
        Microphone clips are transcribed locally and discarded. Generic speech
        does not imitate the bound character.
      </p>
      {!supported && (
        <p role="status">
          Microphone capture requires a supported browser and HTTPS or
          localhost.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
