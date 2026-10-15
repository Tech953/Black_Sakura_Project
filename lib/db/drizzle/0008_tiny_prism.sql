ALTER TABLE "hub_spaces" DROP CONSTRAINT "hub_spaces_slug_unique";--> statement-breakpoint
DROP INDEX "hub_spaces_sort_idx";--> statement-breakpoint
CREATE SEQUENCE "hub_controls_id_seq" OWNED BY "hub_controls"."id";--> statement-breakpoint
SELECT setval('hub_controls_id_seq', COALESCE((SELECT MAX("id") FROM "hub_controls"), 0) + 1, false);--> statement-breakpoint
ALTER TABLE "hub_controls" ALTER COLUMN "id" SET DEFAULT nextval('hub_controls_id_seq');--> statement-breakpoint
ALTER TABLE "engram_simulations" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "engram_artifacts" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "hub_spaces" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "hub_controls" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
CREATE INDEX "engram_simulations_owner_idx" ON "engram_simulations" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "media_assets_owner_idx" ON "media_assets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "engram_artifacts_owner_idx" ON "engram_artifacts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "hub_spaces_owner_sort_idx" ON "hub_spaces" USING btree ("owner_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_spaces_owner_slug_unique" ON "hub_spaces" USING btree ("owner_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "hub_controls_owner_unique" ON "hub_controls" USING btree ("owner_id");