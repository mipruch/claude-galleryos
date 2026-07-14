ALTER TABLE "trigger_actions" ALTER COLUMN "workflow_target_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "scenes" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "trigger_actions" DROP COLUMN "target_type";--> statement-breakpoint
ALTER TABLE "trigger_actions" DROP COLUMN "target_id";--> statement-breakpoint
ALTER TABLE "trigger_actions" DROP COLUMN "target_command";--> statement-breakpoint
ALTER TABLE "trigger_actions" DROP COLUMN "params";