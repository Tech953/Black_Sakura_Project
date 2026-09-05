ALTER TABLE "journal" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "beliefs" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "evolution" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "hiero_symbols" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
ALTER TABLE "expressions" ADD COLUMN "owner_id" text DEFAULT '__engram_system_template__' NOT NULL;--> statement-breakpoint
CREATE INDEX "journal_owner_idx" ON "journal" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "personas_owner_idx" ON "personas" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "beliefs_owner_idx" ON "beliefs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "evolution_owner_idx" ON "evolution" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "initiative_owner_idx" ON "initiative" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "hiero_owner_idx" ON "hiero_symbols" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "expressions_owner_idx" ON "expressions" USING btree ("owner_id");