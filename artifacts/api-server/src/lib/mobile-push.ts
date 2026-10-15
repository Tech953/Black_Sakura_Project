import { and, eq, isNull } from "drizzle-orm";

import { db } from "@workspace/db";
import {
  engramTransmissionsTable,
  mobilePushDeliveryResultsTable,
  mobilePushTokensTable,
} from "@workspace/db/schema";
import { logger } from "./logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH_SIZE = 100;
const EXPO_ERROR_CATEGORIES = [
  "device-not-registered",
  "message-too-big",
  "rate-limited",
  "invalid-credentials",
  "provider-error",
  "provider-http-error",
  "provider-unavailable",
  "unknown",
] as const;

type ExpoPushErrorCategory = (typeof EXPO_ERROR_CATEGORIES)[number];
type ExpoPushTicket = {
  status?: string;
  details?: { error?: string };
};

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

function errorCategory(error: string | undefined): ExpoPushErrorCategory {
  switch (error) {
    case "DeviceNotRegistered":
      return "device-not-registered";
    case "MessageTooBig":
      return "message-too-big";
    case "MessageRateExceeded":
      return "rate-limited";
    case "InvalidCredentials":
      return "invalid-credentials";
    default:
      return error ? "provider-error" : "unknown";
  }
}

async function recordDeliveryResults(
  transmissionId: number,
  batch: Array<{ token: string; platform: string }>,
  tickets: ExpoPushTicket[],
  fallbackCategory?: ExpoPushErrorCategory,
): Promise<void> {
  const recordedAt = new Date();
  await db.insert(mobilePushDeliveryResultsTable).values(
    batch.map(({ platform }, index) => {
      const ticket = tickets[index];
      const category =
        fallbackCategory ??
        (ticket?.status === "ok"
          ? null
          : errorCategory(ticket?.details?.error));
      return {
        transmissionId,
        platform,
        status: category ? "error" : "ok",
        errorCategory: category,
        createdAt: recordedAt,
      };
    }),
  );
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
    .select({
      token: mobilePushTokensTable.token,
      platform: mobilePushTokensTable.platform,
    })
    .from(mobilePushTokensTable)
    .where(eq(mobilePushTokensTable.ownerId, input.ownerId));

  for (let offset = 0; offset < tokens.length; offset += EXPO_BATCH_SIZE) {
    const batch = tokens.slice(offset, offset + EXPO_BATCH_SIZE);
    if (batch.length === 0) continue;

    let response: Response;
    try {
      response = await fetch(EXPO_PUSH_URL, {
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
    } catch (error) {
      await recordDeliveryResults(
        input.transmissionId,
        batch,
        [],
        "provider-unavailable",
      );
      logger.warn(
        {
          category: "provider-unavailable",
          platform: [...new Set(batch.map(({ platform }) => platform))],
          transmissionId: input.transmissionId,
        },
        "Expo push request failed",
      );
      throw error;
    }

    if (!response.ok) {
      await recordDeliveryResults(
        input.transmissionId,
        batch,
        [],
        "provider-http-error",
      );
      throw new Error(`Expo push service returned HTTP ${response.status}`);
    }

    const result = (await response.json()) as {
      data?: ExpoPushTicket[];
    };
    const tickets = result.data ?? [];
    for (const [index, ticket] of tickets.entries()) {
      if (ticket.status !== "error") continue;
      const token = batch[index]?.token;
      if (
        token &&
        errorCategory(ticket.details?.error) === "device-not-registered"
      ) {
        await db
          .delete(mobilePushTokensTable)
          .where(eq(mobilePushTokensTable.token, token));
      }
      logger.warn(
        {
          category: errorCategory(ticket.details?.error),
          platform: batch[index]?.platform,
          transmissionId: input.transmissionId,
        },
        "Expo push ticket failed",
      );
    }
    await recordDeliveryResults(input.transmissionId, batch, tickets);
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