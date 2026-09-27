ALTER TABLE "eval_runs" ADD COLUMN "components" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "judge" jsonb;