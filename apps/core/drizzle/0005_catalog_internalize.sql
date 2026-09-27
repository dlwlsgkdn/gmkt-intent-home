CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"id" text PRIMARY KEY NOT NULL,
	"mall" text NOT NULL,
	"mall_product_id" text,
	"name" text NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"url" text NOT NULL,
	"image_url" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"category" text,
	"source" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"meta" jsonb,
	"recommend_count" integer DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_contents" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"image_url" text,
	"meta" text,
	"snippet" text,
	"duration" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"year" integer,
	"verified" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"recommend_count" integer DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "catalog_products_mall_idx" ON "catalog_products" USING btree ("mall","verified");--> statement-breakpoint
CREATE INDEX "catalog_products_search_trgm_idx" ON "catalog_products" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "catalog_contents_type_idx" ON "catalog_contents" USING btree ("type","verified");--> statement-breakpoint
CREATE INDEX "catalog_contents_search_trgm_idx" ON "catalog_contents" USING gin ("search_text" gin_trgm_ops);
