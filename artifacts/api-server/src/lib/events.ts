import { EventEmitter } from "node:events";

/**
 * In-process live-push event bus. A single Node EventEmitter fans events out to
 * any number of connected SSE clients (see routes/events.ts). It is deliberately
 * in-process only — there is one api-server process per deployment, and events are
 * ephemeral UI nudges (the durable record always lives in the DB). Mutating paths
 * publish here AFTER their DB write commits, so a client that reacts by refetching
 * always sees the committed state.
 */

export type EngramEventType =
  | "presence.changed"
  | "controls.changed"
  | "simulation.step"
  | "media.completed"
  | "artifact.created"
  | "artifact.updated"
  | "artifact.completed"
  | "artifact.failed"
  | "chat.self_initiated"
  | "message.created";

export interface EngramEvent {
  type: EngramEventType;
  /** Engram this event concerns, when scoped to one. Null/undefined = not engram-scoped. */
  engramId?: number | null;
  /** Conversation this event concerns, when scoped to one. */
  conversationId?: number | null;
  /** Clerk subject authorized to receive this event. Undefined events are private by default. */
  ownerId?: string;
  /** Arbitrary serializable payload (already serialized shape — no Dates). */
  data?: unknown;
  /** ISO timestamp, stamped at publish time. */
  ts: string;
}

export interface EventScope {
  ownerId?: string;
  engramId?: number | null;
  conversationId?: number | null;
}

const CHANNEL = "engram-event";

const emitter = new EventEmitter();
// SSE connections are the listeners; there may be many. Disable the warning cap.
emitter.setMaxListeners(0);

/**
 * Decide whether an event reaches a subscriber with the given scope. Rules:
 * - Global events (no engramId AND no conversationId) reach everyone — they are
 *   system-wide (e.g. controls.changed).
 * - A scoped event reaches a subscriber only when it matches one of the scope keys
 *   the subscriber explicitly asked for. A subscriber that asked for nothing gets
 *   global events only — never another scope's events (no cross-scope leakage).
 */
export function eventMatchesScope(event: EngramEvent, scope: EventScope): boolean {
  // Do not broadcast legacy/worker events that have not established ownership.
  if (scope.ownerId != null && event.ownerId !== scope.ownerId) return false;
  const isGlobal = event.engramId == null && event.conversationId == null;
  if (isGlobal) return true;
  if (scope.engramId != null && event.engramId === scope.engramId) return true;
  if (scope.conversationId != null && event.conversationId === scope.conversationId)
    return true;
  return false;
}

/** Publish an event to all matching subscribers. Stamps `ts` if not provided. */
export function publishEvent(
  event: Omit<EngramEvent, "ts"> & { ts?: string },
): void {
  const full: EngramEvent = { ...event, ts: event.ts ?? new Date().toISOString() };
  emitter.emit(CHANNEL, full);
}

/**
 * Subscribe to scope-filtered events. Returns an unsubscribe function. The
 * listener is only invoked for events that pass `eventMatchesScope`.
 */
export function subscribe(
  scope: EventScope,
  listener: (event: EngramEvent) => void,
): () => void {
  const handler = (event: EngramEvent) => {
    if (eventMatchesScope(event, scope)) listener(event);
  };
  emitter.on(CHANNEL, handler);
  return () => {
    emitter.off(CHANNEL, handler);
  };
}
