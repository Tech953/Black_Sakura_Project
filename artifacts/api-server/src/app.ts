import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Offline mobile reconciliation is intentionally bounded by its route schema,
// but valid history batches can exceed Express's 100 KB default.
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Optional single-port mode for fully-local / offline runs: when WEB_DIST points
// at the production-built frontend (artifacts/engram/dist/public), this server
// also serves the dashboard, so the whole app runs on one port with no separate
// web service. Gated on WEB_DIST so Replit dev/preview/production — where the web
// is served as its own static artifact — are completely unaffected.
const webDist = process.env.WEB_DIST;
if (webDist) {
  const indexHtml = path.join(webDist, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(webDist, { fallthrough: true }));
    // SPA fallback: serve index.html for client-side routes. Never shadow /api;
    // only handle GET/HEAD requests that actually want HTML (missing assets fall
    // through to the normal 404 from express.static above). Avoids Express 5
    // string-wildcard path pitfalls by using a plain middleware.
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api")) return next();
      if (!req.accepts("html")) return next();
      res.sendFile(indexHtml);
    });
    logger.info({ webDist }, "Serving built frontend (single-port local mode)");
  } else {
    logger.warn(
      { webDist },
      "WEB_DIST is set but index.html was not found; static serving is disabled",
    );
  }
}

export default app;
