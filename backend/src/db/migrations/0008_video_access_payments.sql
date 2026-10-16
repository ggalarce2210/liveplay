-- Pago por ver videos (2026-10-16): el dueño de un complejo puede elegir cobrar por ver los
-- partidos grabados. Modelo "marketplace": la plata entra directo a la cuenta de Mercado Pago
-- del propio complejo (complex_mercadopago_accounts), no a una cuenta central de LivePlay. El
-- pago desbloquea TODO el complejo (no un partido puntual) por una cantidad de días (pase).
-- Ver el comentario grande en backend/src/db/schema.ts junto a cada tabla/columna nueva.

CREATE TYPE "video_access_pass_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');
--> statement-breakpoint

ALTER TABLE "complexes" ADD COLUMN "charges_for_video_access" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "complexes" ADD COLUMN "video_access_price_ars" double precision;
--> statement-breakpoint
ALTER TABLE "complexes" ADD COLUMN "video_access_pass_days" integer;
--> statement-breakpoint

CREATE TABLE "complex_mercadopago_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"complex_id" uuid NOT NULL UNIQUE,
	"mp_user_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"public_key" text,
	"token_expires_at" timestamp with time zone NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complex_mercadopago_accounts_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "complexes"("id") ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE "video_access_passes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"complex_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "video_access_pass_status" DEFAULT 'PENDING' NOT NULL,
	"amount_ars" double precision NOT NULL,
	"pass_days_snapshot" integer NOT NULL,
	"external_reference" text NOT NULL UNIQUE,
	"mp_preference_id" text,
	"mp_payment_id" text UNIQUE,
	"purchased_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_access_passes_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "complexes"("id") ON DELETE cascade,
	CONSTRAINT "video_access_passes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);
--> statement-breakpoint

CREATE INDEX "video_access_passes_complex_user_idx" ON "video_access_passes" ("complex_id","user_id");
--> statement-breakpoint
CREATE INDEX "video_access_passes_external_ref_idx" ON "video_access_passes" ("external_reference");
