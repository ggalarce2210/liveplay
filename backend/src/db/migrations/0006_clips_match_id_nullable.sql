ALTER TABLE "clips" ALTER COLUMN "match_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clips" DROP CONSTRAINT "clips_match_id_matches_id_fk";--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;
