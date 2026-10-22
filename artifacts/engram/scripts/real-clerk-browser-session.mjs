import { randomUUID } from "node:crypto";

const BROWSER_FIXTURE_HEADER = "X-Engram-Browser-Fixture";
const BROWSER_FIXTURE_VALUE = "chat-archive-export";

export async function createDisposableClerkSession() {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret || !process.env.REPLIT_DEV_DOMAIN) {
    throw new Error("Real Clerk browser checks require Clerk and preview-domain configuration");
  }
  const clerkHeaders = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
  const email = `engram-browser-check-${randomUUID()}@example.com`;
  const password = `E${randomUUID()}-browser-check-7!`;
  let userId;
  let sessionId;
  let signInTokenId;
  try {
    const userResponse = await fetch("https://api.clerk.com/v1/users", {
      method: "POST",
      headers: clerkHeaders,
      body: JSON.stringify({
        email_address: [email],
        password,
        first_name: "ENGRAM",
        last_name: "Browser Check",
      }),
    });
    if (!userResponse.ok) {
      throw new Error(`Could not create disposable Clerk user (${userResponse.status})`);
    }
    userId = (await userResponse.json()).id;

    const sessionResponse = await fetch("https://api.clerk.com/v1/sessions", {
      method: "POST",
      headers: clerkHeaders,
      body: JSON.stringify({ user_id: userId }),
    });
    if (!sessionResponse.ok) {
      throw new Error(`Could not create disposable Clerk session (${sessionResponse.status})`);
    }
    sessionId = (await sessionResponse.json()).id;

    const tokenResponse = await fetch(
      `https://api.clerk.com/v1/sessions/${sessionId}/tokens`,
      {
        method: "POST",
        headers: clerkHeaders,
      },
    );
    if (!tokenResponse.ok) {
      throw new Error(`Could not mint disposable Clerk API token (${tokenResponse.status})`);
    }
    const apiToken = (await tokenResponse.json()).jwt;

    const signInTokenResponse = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
      method: "POST",
      headers: clerkHeaders,
      body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
    });
    if (!signInTokenResponse.ok) {
      throw new Error(
        `Could not mint disposable Clerk sign-in token (${signInTokenResponse.status})`,
      );
    }
    const signInTokenBody = await signInTokenResponse.json();
    signInTokenId = signInTokenBody.id;

    return {
      userId,
      sessionId,
      signInTokenId,
      signInToken: signInTokenBody.token,
      apiToken,
      clerkHeaders,
    };
  } catch (error) {
    if (sessionId) {
      await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/revoke`, {
        method: "POST",
        headers: clerkHeaders,
      });
    }
    if (userId) {
      await fetch(`https://api.clerk.com/v1/users/${userId}`, {
        method: "DELETE",
        headers: clerkHeaders,
      });
    }
    throw error;
  }
}

export async function realApi(appUrl, path, session, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.apiToken}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const baseUrl = appUrl.endsWith("/") ? appUrl.slice(0, -1) : appUrl;
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

export async function cleanupDisposableAccount(appUrl, session) {
  const response = await realApi(appUrl, "/api/openai/browser-fixture/cleanup", session, {
    method: "POST",
    headers: { [BROWSER_FIXTURE_HEADER]: BROWSER_FIXTURE_VALUE },
  });
  if (!response.ok) {
    throw new Error(`Disposable account cleanup returned HTTP ${response.status}`);
  }
}

async function deleteDisposableClerkIdentity(session) {
  const cleanupProblems = [];
  const revoke = async (url) => {
    try {
      await fetch(url, { method: "POST", headers: session.clerkHeaders });
    } catch {
      // Deleting the user below also invalidates remaining Clerk sessions/tokens.
    }
  };
  if (session.signInTokenId) {
    await revoke(
      `https://api.clerk.com/v1/sign_in_tokens/${session.signInTokenId}/revoke`,
    );
  }
  if (session.sessionId) {
    await revoke(`https://api.clerk.com/v1/sessions/${session.sessionId}/revoke`);
  }

  try {
    const response = await fetch(`https://api.clerk.com/v1/users/${session.userId}`, {
      method: "DELETE",
      headers: session.clerkHeaders,
    });
    if (!response.ok && response.status !== 404) {
      cleanupProblems.push("Clerk user deletion");
    }
  } catch {
    cleanupProblems.push("Clerk user deletion");
  }
  return cleanupProblems;
}

export async function cleanupDisposableClerkSession(appUrl, session) {
  const cleanupProblems = [];
  try {
    await cleanupDisposableAccount(appUrl, session);
  } catch {
    cleanupProblems.push("owner-scoped data cleanup");
  }
  cleanupProblems.push(...(await deleteDisposableClerkIdentity(session)));

  if (cleanupProblems.length > 0) {
    throw new Error(
      `Real Clerk browser check could not fully clean up: ${cleanupProblems.join(", ")}`,
    );
  }
}
