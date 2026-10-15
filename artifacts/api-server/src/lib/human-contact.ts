import type { Engram, EngramMessage } from "@workspace/db";
import {
  classifyPriority,
  decideHumanContact,
  type Capabilities,
} from "./engram-policy";
import { recordMessage, recentHumanCounts } from "./messages-store";

/**
 * Per-engram caps on how many human-contact attempts may actually reach the
 * operator (delivered/queued/digest) within the trailing window. Refusals do not
 * count against these. Deliberately tighter than the transmission caps — direct
 * human contact is the most intrusive channel.
 */
export const HUMAN_CONTACT_HOURLY_CAP = 3;
export const HUMAN_CONTACT_DAILY_CAP = 12;

export interface HumanContactOutcome {
  message: EngramMessage;
  delivered: boolean;
}

/**
 * Route one engram-initiated human-contact attempt through the policy and persist
 * the result on the bus. The drive charge sets the priority class; current rate
 * windows + capabilities decide delivered/queued/digest/blocked. Every attempt is
 * recorded (including refusals) for the human-contact terminal's audit trail.
 *
 * `delivered` is true only for the immediate (urgent) status, and is mirrored onto
 * the companion transmission's `wasDelivered` flag by the caller.
 */
export async function attemptHumanContact(opts: {
  ownerId: string;
  engram: Engram;
  capabilities: Capabilities;
  charge: number;
  content: string;
  now?: Date;
}): Promise<HumanContactOutcome> {
  const { ownerId, engram, capabilities, charge, content } = opts;
  const now = opts.now ?? new Date();

  const priority = classifyPriority(charge);
  const { hour, day } = await recentHumanCounts(ownerId, engram.id, now);
  const decision = decideHumanContact({
    priority,
    capabilities,
    recentHour: hour,
    recentDay: day,
    hourCap: HUMAN_CONTACT_HOURLY_CAP,
    dayCap: HUMAN_CONTACT_DAILY_CAP,
  });

  const delivered = decision.status === "delivered";
  const message = await recordMessage(ownerId, {
    fromEngramId: engram.id,
    toEngramId: null,
    spaceId: null,
    channel: "human",
    priority,
    status: decision.status,
    content,
    reason: decision.reason,
    seen: false,
    deliveredAt: decision.status === "blocked" ? null : now,
  });

  return { message, delivered };
}
