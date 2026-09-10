CREATE TYPE "public"."camera_status" AS ENUM('ONLINE', 'OFFLINE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."camera_type" AS ENUM('IP_CAMERA', 'RTSP', 'NVR', 'DVR');--> statement-breakpoint
CREATE TYPE "public"."clip_status" AS ENUM('PENDING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."court_status" AS ENUM('ACTIVE', 'MAINTENANCE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('GOAL', 'YELLOW_CARD', 'RED_CARD', 'GREAT_SAVE', 'HIGHLIGHT', 'SET_POINT', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('SCHEDULED', 'RECORDING', 'PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('MATCH_READY', 'CLIP_READY', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('SUPER_ADMIN', 'COMPLEX_ADMIN', 'PLAYER');--> statement-breakpoint
CREATE TYPE "public"."segment_status" AS ENUM('PENDING', 'PROCESSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."sport_type" AS ENUM('FUTBOL5', 'PADEL');--> statement-breakpoint
CREATE TYPE "public"."storage_provider" AS ENUM('LOCAL', 'S3');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan" AS ENUM('FREE', 'BASIC', 'PRO', 'ENTERPRISE');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIALING');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('PUBLIC', 'PRIVATE', 'REGISTERED_ONLY');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"metadata" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"timestamp_seconds" double precision NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cameras" (
	"id" uuid PRIMARY KEY NOT NULL,
	"court_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "camera_type" NOT NULL,
	"rtsp_url" text,
	"nvr_channel" integer,
	"status" "camera_status" DEFAULT 'UNKNOWN' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cameras_court_id_unique" UNIQUE("court_id")
);
--> statement-breakpoint
CREATE TABLE "clips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"start_seconds" double precision NOT NULL,
	"end_seconds" double precision NOT NULL,
	"status" "clip_status" DEFAULT 'PENDING' NOT NULL,
	"storage_key" text,
	"visibility" "visibility" DEFAULT 'PRIVATE' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complexes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"timezone" text DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
	"opening_hours" jsonb,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"complex_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sport_type" "sport_type" NOT NULL,
	"status" "court_status" DEFAULT 'ACTIVE' NOT NULL,
	"location" text,
	"operating_hours" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"type" "event_type" NOT NULL,
	"timestamp_seconds" double precision NOT NULL,
	"label" text,
	"team_id" uuid,
	"match_player_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_players" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"team_id" uuid,
	"user_id" uuid,
	"guest_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"complex_id" uuid NOT NULL,
	"court_id" uuid NOT NULL,
	"sport_type" "sport_type" NOT NULL,
	"date" date NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone,
	"status" "match_status" DEFAULT 'SCHEDULED' NOT NULL,
	"result_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"match_id" uuid,
	"clip_id" uuid,
	"visibility" "visibility" DEFAULT 'PRIVATE' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"complex_id" uuid NOT NULL,
	"plan" "subscription_plan" DEFAULT 'FREE' NOT NULL,
	"status" "subscription_status" DEFAULT 'TRIALING' NOT NULL,
	"renews_at" timestamp with time zone,
	"camera_limit" integer DEFAULT 5 NOT NULL,
	"retention_days" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_complex_id_unique" UNIQUE("complex_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"label" text NOT NULL,
	"score" integer,
	"sets_won" integer
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"avatar_url" text,
	"role" "role" DEFAULT 'PLAYER' NOT NULL,
	"home_complex_id" uuid,
	"managed_complex_id" uuid,
	"email_verified_at" timestamp with time zone,
	"email_verify_token" text,
	"password_reset_token" text,
	"password_reset_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_verify_token_unique" UNIQUE("email_verify_token"),
	CONSTRAINT "users_password_reset_token_unique" UNIQUE("password_reset_token")
);
--> statement-breakpoint
CREATE TABLE "video_segments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"video_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"start_offset_seconds" double precision NOT NULL,
	"end_offset_seconds" double precision NOT NULL,
	"storage_key" text NOT NULL,
	"duration_seconds" double precision NOT NULL,
	"status" "segment_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"status" "video_status" DEFAULT 'PENDING' NOT NULL,
	"storage_provider" "storage_provider" DEFAULT 'LOCAL' NOT NULL,
	"storage_base_key" text NOT NULL,
	"original_file_key" text,
	"hls_manifest_key" text,
	"thumbnail_sprite_key" text,
	"thumbnail_vtt_key" text,
	"duration_seconds" double precision,
	"width" integer,
	"height" integer,
	"fps" double precision,
	"size_bytes" double precision,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "videos_match_id_unique" UNIQUE("match_id")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courts" ADD CONSTRAINT "courts_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_match_player_id_match_players_id_fk" FOREIGN KEY ("match_player_id") REFERENCES "public"."match_players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_clip_id_clips_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_segments" ADD CONSTRAINT "video_segments_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "bookmarks_match_user_idx" ON "bookmarks" USING btree ("match_id","user_id");--> statement-breakpoint
CREATE INDEX "clips_match_idx" ON "clips" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "clips_user_idx" ON "clips" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "courts_complex_idx" ON "courts" USING btree ("complex_id");--> statement-breakpoint
CREATE INDEX "events_match_time_idx" ON "events" USING btree ("match_id","timestamp_seconds");--> statement-breakpoint
CREATE INDEX "match_players_match_idx" ON "match_players" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "match_players_user_idx" ON "match_players" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "matches_complex_date_idx" ON "matches" USING btree ("complex_id","date");--> statement-breakpoint
CREATE INDEX "matches_court_date_idx" ON "matches" USING btree ("court_id","date");--> statement-breakpoint
CREATE INDEX "matches_sport_date_idx" ON "matches" USING btree ("sport_type","date");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "share_links_token_idx" ON "share_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "teams_match_idx" ON "teams" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "video_segments_video_index_unique" ON "video_segments" USING btree ("video_id","index");--> statement-breakpoint
CREATE INDEX "video_segments_video_idx" ON "video_segments" USING btree ("video_id");