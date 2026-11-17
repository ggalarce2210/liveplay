ALTER TABLE "video_access_passes" ADD COLUMN IF NOT EXISTS "match_id" uuid REFERENCES "matches"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "video_access_passes_match_user_idx" ON "video_access_passes" USING btree ("match_id","user_id");
