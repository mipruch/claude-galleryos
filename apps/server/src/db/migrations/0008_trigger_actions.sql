CREATE TABLE "trigger_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid,
	"mapping_id" uuid,
	"target_type" varchar(50) NOT NULL,
	"target_id" uuid,
	"target_command" varchar(100),
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trigger_actions_owner_chk" CHECK (("trigger_actions"."schedule_id" IS NOT NULL AND "trigger_actions"."mapping_id" IS NULL)
        OR ("trigger_actions"."mapping_id" IS NOT NULL AND "trigger_actions"."schedule_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "scheduled_jobs" DROP CONSTRAINT "scheduled_jobs_scene_id_scenes_id_fk";
--> statement-breakpoint
ALTER TABLE "trigger_actions" ADD CONSTRAINT "trigger_actions_schedule_id_scheduled_jobs_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."scheduled_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_actions" ADD CONSTRAINT "trigger_actions_mapping_id_input_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."input_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_trigger_actions_schedule" ON "trigger_actions" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "idx_trigger_actions_mapping" ON "trigger_actions" USING btree ("mapping_id");--> statement-breakpoint
ALTER TABLE "input_mappings" DROP COLUMN "target_type";--> statement-breakpoint
ALTER TABLE "input_mappings" DROP COLUMN "target_id";--> statement-breakpoint
ALTER TABLE "input_mappings" DROP COLUMN "target_command";--> statement-breakpoint
ALTER TABLE "input_mappings" DROP COLUMN "params_template";--> statement-breakpoint
ALTER TABLE "scheduled_jobs" DROP COLUMN "scene_id";