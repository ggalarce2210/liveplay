-- Canchas favoritas de un jugador (2026-10-22): reemplaza la restricción de "un solo complejo
-- fijo" (users.home_complex_id, sigue en la tabla pero el frontend nuevo ya no lo usa) por una
-- lista de complejos favoritos por usuario. "Mis partidos" busca en todos los favoritos a la vez
-- (ver complexIds en MatchesService.search) — ver el comentario grande en schema.ts.

CREATE TABLE "user_favorite_complexes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"complex_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_favorite_complexes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade,
	CONSTRAINT "user_favorite_complexes_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "complexes"("id") ON DELETE cascade
);
--> statement-breakpoint

CREATE UNIQUE INDEX "user_favorite_complexes_user_complex_idx" ON "user_favorite_complexes" ("user_id","complex_id");
--> statement-breakpoint
CREATE INDEX "user_favorite_complexes_user_idx" ON "user_favorite_complexes" ("user_id");
