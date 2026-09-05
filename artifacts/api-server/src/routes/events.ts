import { Router, type IRouter } from "express";
import { subscribe, type EngramEvent } from "../lib/events";
import { loadOwnedConversation, loadOwnedEngram } from "../lib/account-bootstrap";

const router: IRouter = Router();

/** How often to send an SSE comment heartbeat so proxies/clients keep the stream open. */
const HEARTBEAT_MS = 25_000;

function parseId(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Live-push event stream (Server-Sent Events). Clients connect with optional
 * `engramId` / `conversationId` query params to scope what they receive; scoping is
 * enforced server-side (see lib/events.ts) so no client can observe another scope's
 * events. Each event is delivered as a single `data:` line carrying the full event
 * JSON (which includes its `type`), so a client needs only one `onmessage` handler.
 * Not modeled in OpenAPI (SSE streams aren't expressible there), mirroring the chat
 * stream and the media/artifact raw routes.
 */
router.get("/events", async (req, res) => {
  const scope = {
    ownerId: req.userId!,
    engramId: parseId(req.query["engramId"]),
    conversationId: parseId(req.query["conversationId"]),
  };
  if (scope.engramId != null && !(await loadOwnedEngram(scope.engramId, scope.ownerId))) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  if (
    scope.conversationId != null &&
    !(await loadOwnedConversation(scope.conversationId, scope.ownerId))
  ) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  // Advise the browser's EventSource to reconnect quickly, then open the stream.
  res.write("retry: 3000\n\n");
  res.write(": connected\n\n");

  const send = (event: EngramEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const unsubscribe = subscribe(scope, send);

  const heartbeat = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

export default router;
