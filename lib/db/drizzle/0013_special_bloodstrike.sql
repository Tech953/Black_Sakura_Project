CREATE TABLE "mobile_push_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engram_transmissions" ADD COLUMN "push_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mobile_push_tokens" ADD CONSTRAINT "mobile_push_tokens_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_push_tokens_token_unique" ON "mobile_push_tokens" USING btree ("token");