import { routeHarness as h } from "../test/db-harness";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { request as httpRequest, type Server } from "node:http";

vi.mock("@workspace/db", () => ({ db: h.db }));
vi.mock("@workspace/db/schema", () => h.schema);
vi.mock("drizzle-orm", () => h.drizzle);

import mobilePushRouter from "./mobile-push";

let server: Server;
let base = "";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const owner = req.headers["x-test-owner"];
    (req as Request & { userId: string }).userId =
      typeof owner === "string" ? owner : "owner-a";
    next();
  });
  app.use("/api", mobilePushRouter);
  return app;
}

async function requestJson(
  method: "POST" | "DELETE",
  route: string,
  body: unknown,
  owner = "owner-a",
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = httpRequest(
      `${base}${route}`,
      {
        method,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          "x-test-owner": owner,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("mobile push test server did not expose an address");
      }
      base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.reset();
});

describe("mobile push token routes", () => {
  it("registers a valid Expo token for the authenticated account", async () => {
    const response = await requestJson("POST", "/api/mobile/push-tokens", {
      token: "ExponentPushToken[owner-a-device]",
      platform: "android",
    });

    expect(response.status).toBe(204);
    expect(h.store.mobilePushTokensTable).toMatchObject([
      {
        ownerId: "owner-a",
        token: "ExponentPushToken[owner-a-device]",
        platform: "android",
      },
    ]);
  });

  it("rejects malformed tokens and unsupported platforms before writing", async () => {
    const response = await requestJson("POST", "/api/mobile/push-tokens", {
      token: "not-an-expo-token",
      platform: "windows",
    });

    expect(response.status).toBe(400);
    expect(h.store.mobilePushTokensTable).toHaveLength(0);
  });

  it("does not let one account unregister another account's token", async () => {
    h.store.mobilePushTokensTable.push({
      id: 1,
      ownerId: "owner-a",
      token: "ExpoPushToken[shared-device]",
      platform: "ios",
    });

    const otherOwner = await requestJson(
      "DELETE",
      "/api/mobile/push-tokens",
      {
        token: "ExpoPushToken[shared-device]",
        platform: "ios",
      },
      "owner-b",
    );

    expect(otherOwner.status).toBe(204);
    expect(h.store.mobilePushTokensTable).toHaveLength(1);

    const owner = await requestJson("DELETE", "/api/mobile/push-tokens", {
      token: "ExpoPushToken[shared-device]",
      platform: "ios",
    });

    expect(owner.status).toBe(204);
    expect(h.store.mobilePushTokensTable).toHaveLength(0);
  });
});