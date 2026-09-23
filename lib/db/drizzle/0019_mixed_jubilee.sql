CREATE TABLE "mobile_push_delivery_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"transmission_id" integer NOT NULL,
	"platform" text NOT NULL,
	"status" text NOT NULL,
	"error_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_push_delivery_results_status_check" CHECK ("mobile_push_delivery_results"."status" in ('ok', 'error')),
	CONSTRAINT "mobile_push_delivery_results_error_category_check" CHECK ("mobile_push_delivery_results"."error_category" is null or "mobile_push_delivery_results"."error_category" in ('device-not-registered', 'message-too-big', 'rate-limited', 'invalid-credentials', 'provider-error', 'provider-http-error', 'provider-unavailable', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "mobile_push_delivery_results" ADD CONSTRAINT "mobile_push_delivery_results_transmission_id_engram_transmissions_id_fk" FOREIGN KEY ("transmission_id") REFERENCES "public"."engram_transmissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mobile_push_delivery_results_transmission_created_idx" ON "mobile_push_delivery_results" USING btree ("transmission_id","created_at");