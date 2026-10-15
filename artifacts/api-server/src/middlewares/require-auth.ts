import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { ensureAccountBootstrap } from "../lib/account-bootstrap";

declare global {
  namespace Express {
    interface Request {
      /** Authenticated Clerk subject. Never populated from client input. */
      userId?: string;
    }
  }
}

/**
 * Establishes the sole account identity accepted by API handlers. Public routes
 * are deliberately mounted before this middleware in routes/index.ts.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  // Clerk 2.x types custom session claims as unknown values. The canonical,
  // verified Clerk subject is exposed directly as `userId`; do not read an
  // untyped custom claim (or any client-controlled value) for ownership.
  const userId = auth.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  try {
    await ensureAccountBootstrap(userId);
    next();
  } catch (error) {
    req.log?.error(error, "Account bootstrap failed");
    res.status(503).json({ error: "Account setup is temporarily unavailable" });
  }
}