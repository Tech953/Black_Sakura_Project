import type { EngramMessage } from "@workspace/api-client-react";

export type OperatorReplyDisplayState = {
  saved: true;
  acknowledgement: "pending" | "acknowledged";
};

/**
 * A sync receipt only confirms that the server stored an offline reply.
 * The ENGRAM's acknowledgedAt timestamp is the separate signal that it replied.
 */
export function getOperatorReplyDisplayState(
  message: Pick<EngramMessage, "author" | "acknowledgedAt">,
): OperatorReplyDisplayState | null {
  if (message.author !== "operator") return null;

  return {
    saved: true,
    acknowledgement:
      message.acknowledgedAt == null ? "pending" : "acknowledged",
  };
}
