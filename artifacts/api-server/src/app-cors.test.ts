import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "./app";

let server: Server;
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("public health probe", () => {
  it("allows a credential-free browser probe from another origin", async () => {
    const response = await fetch(`${base}/api/healthz`, {
      headers: { Origin: "https://web.example.test" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});