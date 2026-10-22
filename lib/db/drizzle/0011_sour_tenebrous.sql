ALTER TABLE "conversations" ADD COLUMN "group_continuation_claim_token" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "group_continuation_claimed_at" timestamp with time zone;