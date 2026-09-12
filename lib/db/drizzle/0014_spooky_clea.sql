ALTER TABLE "engram_messages" ADD COLUMN "is_digest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "engram_messages" ADD COLUMN "digested_at" timestamp with time zone;