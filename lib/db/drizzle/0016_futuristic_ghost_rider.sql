CREATE TABLE "engram_simulation_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"simulation_id" integer NOT NULL,
	"engram_id" integer NOT NULL,
	"owner_id" text DEFAULT '__engram_system_template__' NOT NULL,
	"last_spoke_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engram_simulation_steps" ADD COLUMN "speaker_engram_id" integer;--> statement-breakpoint
ALTER TABLE "engram_simulation_participants" ADD CONSTRAINT "engram_simulation_participants_simulation_id_engram_simulations_id_fk" FOREIGN KEY ("simulation_id") REFERENCES "public"."engram_simulations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engram_simulation_participants" ADD CONSTRAINT "engram_simulation_participants_engram_id_engrams_id_fk" FOREIGN KEY ("engram_id") REFERENCES "public"."engrams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "engram_simulation_participant_unique" ON "engram_simulation_participants" USING btree ("simulation_id","engram_id");--> statement-breakpoint
CREATE INDEX "engram_simulation_participants_sim_idx" ON "engram_simulation_participants" USING btree ("simulation_id");--> statement-breakpoint
CREATE INDEX "engram_simulation_participants_engram_idx" ON "engram_simulation_participants" USING btree ("engram_id");--> statement-breakpoint
ALTER TABLE "engram_simulation_steps" ADD CONSTRAINT "engram_simulation_steps_speaker_engram_id_engrams_id_fk" FOREIGN KEY ("speaker_engram_id") REFERENCES "public"."engrams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "engram_simulation_participants" ("simulation_id", "engram_id", "owner_id")
SELECT "id", "engram_id", "owner_id"
FROM "engram_simulations"
ON CONFLICT ("simulation_id", "engram_id") DO NOTHING;