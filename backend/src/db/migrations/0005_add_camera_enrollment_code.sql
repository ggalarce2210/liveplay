ALTER TABLE "cameras" ADD COLUMN "enrollment_code_hash" text;--> statement-breakpoint
ALTER TABLE "cameras" ADD COLUMN "enrollment_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cameras" ADD COLUMN "pending_agent_token" text;
