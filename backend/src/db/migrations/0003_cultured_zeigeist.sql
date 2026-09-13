ALTER TYPE "public"."camera_type" ADD VALUE 'IMOU_CLOUD';--> statement-breakpoint
ALTER TABLE "cameras" ADD COLUMN "imou_device_id" text;--> statement-breakpoint
ALTER TABLE "cameras" ADD COLUMN "imou_channel_id" text;
