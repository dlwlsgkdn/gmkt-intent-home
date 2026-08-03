-- threadId를 uuid → 스노우플레이크(text 19자리, 앱 생성)로 전환.
-- 기존 uuid 값은 19자리 숫자 계약에 안 맞아 테이블을 재생성한다 — 개발 단계라 기존 쓰레드 데이터는 버린다.
DROP TABLE IF EXISTS "thread_steps";--> statement-breakpoint
DROP TABLE IF EXISTS "threads";--> statement-breakpoint
CREATE TABLE "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"source" jsonb,
	"status" text DEFAULT 'exploring' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "thread_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" text NOT NULL,
	"seq" integer NOT NULL,
	"stage" text NOT NULL,
	"payload" jsonb NOT NULL,
	"llm_meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "thread_steps" ADD CONSTRAINT "thread_steps_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "thread_steps_thread_seq_uq" ON "thread_steps" USING btree ("thread_id","seq");--> statement-breakpoint
CREATE INDEX "threads_user_updated_idx" ON "threads" USING btree ("user_id","updated_at");
