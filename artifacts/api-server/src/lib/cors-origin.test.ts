import { describe, expect, it } from "vitest";
import {
  configuredCorsOrigins,
  isAllowedCorsOrigin,
} from "./cors-origin";

describe("credentialed CORS origin policy", () => {
  it("allows native requests, same-host browsers, and configured first parties", () => {
    const configured = configuredCorsOrigins(
      "https://app.example.com, https://admin.example.com/",
    );
    expect(isAllowedCorsOrigin(undefined, "api.example.com", configured)).toBe(
      true,
    );
    expect(
      isAllowedCorsOrigin(
        "https://api.example.com",
        "api.example.com",
        configured,
      ),
    ).toBe(true);
    expect(
      isAllowedCorsOrigin(
        "https://app.example.com/",
        "api.example.com",
        configured,
      ),
    ).toBe(true);
  });

  it("rejects arbitrary, malformed, and deceptive origins", () => {
    const configured = configuredCorsOrigins("https://app.example.com");
    expect(
      isAllowedCorsOrigin(
        "https://attacker.example",
        "api.example.com",
        configured,
      ),
    ).toBe(false);
    expect(
      isAllowedCorsOrigin(
        "https://api.example.com.attacker.example",
        "api.example.com",
        configured,
      ),
    ).toBe(false);
    expect(isAllowedCorsOrigin("null", "api.example.com", configured)).toBe(
      false,
    );
  });
});