CREATE TABLE "eval_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"intent" text NOT NULL,
	"profile" jsonb,
	"survey" jsonb,
	"answers" jsonb,
	"source_thread_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"page" jsonb,
	"drop_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta" jsonb,
	"score" integer,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_case_id_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_case_idx" ON "eval_runs" USING btree ("case_id","created_at");