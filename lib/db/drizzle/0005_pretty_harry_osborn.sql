CREATE TABLE "mobile_offline_sync_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"sync_id" text NOT NULL,
	"kind" text NOT NULL,
	"remote_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_offline_sync_device_sync_unique" ON "mobile_offline_sync_receipts" USING btree ("device_id","sync_id");