import type { TFunction } from "i18next";
import type { EngramEvent } from "../hooks/use-event-stream";

export type EventTone = "info" | "warn" | "good";

export interface SystemEvent {
  id: string;
  label: string;
  tone: EventTone;
  ts: string;
}

/** Render a live system event as a one-line strip entry, or null to hide it. */
export function describeSystemEvent(
  event: EngramEvent,
  t: TFunction,
): { label: string; tone: EventTone } | null {
  const data = (event.data ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case "presence.changed":
      return {
        label: t("eventPresenceChanged", {
          engramName: (data["engramName"] as string) ?? t("eventAnEngram"),
          spaceName: (data["spaceName"] as string) ?? t("eventASpace"),
        }),
        tone: "info",
      };
    case "controls.changed": {
      const bits = [
        data["paused"] ? t("eventControlsPaused") : t("eventControlsActive"),
      ];
      if (data["quietMode"]) bits.push(t("eventControlsQuiet"));
      return { label: t("eventControlsUpdated", { bits: bits.join(", ") }), tone: "warn" };
    }
    case "simulation.step":
      return {
        label: t("eventSimulationStep", {
          step: (data["step"] as number) ?? "?",
          maxSteps: (data["maxSteps"] as number) ?? "?",
        }),
        tone: "info",
      };
    case "media.completed":
      return {
        label: t("eventMediaCompleted", {
          modality: (data["modality"] as string) ?? t("eventMediaFallback"),
          filename: (data["filename"] as string) ?? "",
        }),
        tone: "good",
      };
    case "artifact.created":
      return {
        label: t("eventArtifactCreated", {
          kind: (data["kind"] as string) ?? t("eventArtifactFallback"),
          title: (data["title"] as string) ?? "",
        }),
        tone: "info",
      };
    case "artifact.completed":
      return {
        label: t("eventArtifactCompleted", {
          kind: (data["kind"] as string) ?? t("eventArtifactFallback"),
          title: (data["title"] as string) ?? "",
        }),
        tone: "good",
      };
    case "artifact.failed":
      return {
        label: t("eventArtifactFailed", {
          title: (data["title"] as string) ?? "",
        }),
        tone: "warn",
      };
    case "chat.self_initiated":
      return { label: t("eventChatSelfInitiated"), tone: "good" };
    case "artifact.updated":
    case "message.created":
      return null;
  }
}
