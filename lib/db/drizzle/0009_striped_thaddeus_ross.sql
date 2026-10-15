CREATE TABLE "conversation_engram_participants" (
	"conversation_id" integer NOT NULL,
	"engram_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_engram_participants_conversation_id_engram_id_pk" PRIMARY KEY("conversation_id","engram_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "speaker_engram_id" integer;--> statement-breakpoint
ALTER TABLE "conversation_engram_participants" ADD CONSTRAINT "conversation_engram_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_engram_participants" ADD CONSTRAINT "conversation_engram_participants_engram_id_engrams_id_fk" FOREIGN KEY ("engram_id") REFERENCES "public"."engrams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_engram_participants_owner_idx" ON "conversation_engram_participants" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "conversation_engram_participants_engram_idx" ON "conversation_engram_participants" USING btree ("engram_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_speaker_engram_id_engrams_id_fk" FOREIGN KEY ("speaker_engram_id") REFERENCES "public"."engrams"("id") ON DELETE set null ON UPDATE no action;