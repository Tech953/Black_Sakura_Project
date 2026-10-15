import app from "./app";
import { db, ensureDatabaseReady } from "@workspace/db";
import { seedFullRezzArchive, seedFullRezzLiveBranch } from "@workspace/db/seed";
import { logger } from "./lib/logger";
import { startEngramEngine, stopEngramEngine } from "./services/engram-engine";
import { startMediaWorker, stopMediaWorker } from "./services/media-worker";
import {
  startArtifactWorker,
  stopArtifactWorker,
} from "./services/artifact-worker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main(): Promise<void> {
  // Embedded (desktop / pglite) boot: run migrations + idempotent seeds before
  // serving. This is a NO-OP for the default node-postgres driver (Replit/dev),
  // where schema is managed by `drizzle-kit push` and the seed scripts — so it
  // is safe to call unconditionally on every startup.
  await ensureDatabaseReady();
  // Unlike embedded PGlite, node-postgres does not run seedAll during
  // initialization. Provision both canonical templates before any account can
  // bootstrap from them. The archival seeder validates and refuses to repair
  // partial/noncanonical records; the interactive copy is a separate branch.
  await seedFullRezzArchive(db);
  await seedFullRezzLiveBranch(db);

  // Optional explicit bind host. Unset on Replit/dev (binds all interfaces,
  // unchanged); the desktop build sets HOST=127.0.0.1 to keep the embedded
  // server loopback-only.
  const host = process.env["HOST"];

  const onListening = (): void => {
    logger.info({ port, host: host ?? "0.0.0.0" }, "Server listening");
    startEngramEngine();
    startMediaWorker();
    startArtifactWorker();
  };

  const server = host
    ? app.listen(port, host, onListening)
    : app.listen(port, onListening);

  server.on("error", (err) => {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  });

  function shutdown(signal: string): void {
    logger.info({ signal }, "Shutting down");
    stopEngramEngine();
    stopMediaWorker();
    stopArtifactWorker();
    server.close(() => process.exit(0));
    // Force-exit if connections do not drain promptly.
    setTimeout(() => process.exit(0), 5000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Fatal error during startup");
  process.exit(1);
});
