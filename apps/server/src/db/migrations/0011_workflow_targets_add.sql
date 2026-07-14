CREATE TABLE "workflow_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" varchar(50) NOT NULL,
	"target_id" uuid NOT NULL,
	"target_command" varchar(100),
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trigger_actions" ALTER COLUMN "target_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trigger_actions" ADD COLUMN "workflow_target_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_workflow_targets_target" ON "workflow_targets" USING btree ("target_type","target_id");--> statement-breakpoint
ALTER TABLE "trigger_actions" ADD CONSTRAINT "trigger_actions_workflow_target_id_workflow_targets_id_fk" FOREIGN KEY ("workflow_target_id") REFERENCES "public"."workflow_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_trigger_actions_target" ON "trigger_actions" USING btree ("workflow_target_id");