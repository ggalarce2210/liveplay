CREATE UNIQUE INDEX IF NOT EXISTS "matches_court_start_unique" ON "matches" USING btree ("court_id","start_time");
