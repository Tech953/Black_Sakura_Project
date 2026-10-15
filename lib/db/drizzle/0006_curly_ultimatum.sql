CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engrams" DROP CONSTRAINT "engrams_slug_unique";--> statement-breakpoint
DROP INDEX "mobile_offline_sync_device_sync_unique";--> statement-breakpoint
ALTER TABLE "personality" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "engrams" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "mobile_offline_sync_receipts" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
CREATE INDEX "personality_owner_idx" ON "personality" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "memories_owner_idx" ON "memories" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "engrams_owner_idx" ON "engrams" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "engrams_owner_slug_unique" ON "engrams" USING btree ("owner_id","slug");--> statement-breakpoint
CREATE INDEX "conversations_owner_idx" ON "conversations" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_offline_sync_device_sync_unique" ON "mobile_offline_sync_receipts" USING btree ("owner_id","device_id","sync_id");