ALTER TABLE "complexes" ADD COLUMN "city" text;--> statement-breakpoint
CREATE INDEX "complexes_city_idx" ON "complexes" USING btree ("city");