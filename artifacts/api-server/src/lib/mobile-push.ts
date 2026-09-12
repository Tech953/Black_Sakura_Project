import { and, eq, isNull } from "drizzle-orm";

import { db } from "@workspace/db";
import {
  engramTransmissionsTable,
  mobilePushTokensTable,
} from "@workspace/db/schema";
import { logger } from "./logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH_SIZE = 100;

export interface TransmissionPushInput {
  ownerId: string;
  engramId: number;
  engramName: string;
  transmissionId: number;
  content: string;
}

function snippet(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}…` : normalized;
}

/**
 * Send a delivered outreach to every currently registered device. The caller
 * must claim the transmission before invoking this function; the Expo API does
 * not provide an exactly-once delivery primitive.
 */
export async function sendTransmissionPush(
  input: TransmissionPushInput,
): Promise<void> {
  const tokens = await db
    .select({ token: mobilePushTokensTable.token })
    .from(mobilePushTokensTable)
    .where(eq(mobilePushTokensTable.ownerId, input.ownerId));

  for (let offset = 0; offset < tokens.length; offset += EXPO_BATCH_SIZE) {
    const batch = tokens.slice(offset, offset + EXPO_BATCH_SIZE);
    if (batch.length === 0) continue;

    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        batch.map(({ token }) => ({
          to: token,
          title: input.engramName,
          body: snippet(input.content),
          sound: "default",
          priority: "high",
          channelId: "engram-outreach",
          data: {
            type: "engram-transmission",
            engramId: String(input.engramId),
            transmissionId: String(input.transmissionId),
          },
        })),
      ),
    });

    if (!response.ok) {
      throw new Error(`Expo push service returned HTTP ${response.status}`);
    }

    const result = (await response.json()) as {
      data?: Array<{
        status?: string;
        details?: { error?: string };
      }>;
    };
    for (const [index, ticket] of (result.data ?? []).entries()) {
      if (ticket.status !== "error") continue;
      const token = batch[index]?.token;
      if (token && ticket.details?.error === "DeviceNotRegistered") {
        await db
          .delete(mobilePushTokensTable)
          .where(eq(mobilePushTokensTable.token, token));
      }
      logger.warn(
        {
          error: ticket.details?.error,
          token: token ? `${token.slice(0, 18)}…` : undefined,
        },
        "Expo push ticket failed",
      );
    }
  }
}

/**
 * Claim an outreach transmission exactly once before contacting Expo. A claim
 * is intentionally persisted even when there are no registered devices: a
 * later device registration must not replay old outreach.
 */
export async function claimTransmissionPush(
  transmissionId: number,
): Promise<boolean> {
  const [claimed] = await db
    .update(engramTransmissionsTable)
    .set({ pushNotifiedAt: new Date() })
    .where(
      and(
        eq(engramTransmissionsTable.id, transmissionId),
        isNull(engramTransmissionsTable.pushNotifiedAt),
      ),
    )
    .returning({ id: engramTransmissionsTable.id });
  return Boolean(claimed);
}