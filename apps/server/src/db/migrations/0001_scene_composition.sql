ALTER TABLE "scene_actions" ALTER COLUMN "device_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scene_actions" ALTER COLUMN "command" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scene_actions" ADD COLUMN "child_scene_id" uuid;--> statement-breakpoint
ALTER TABLE "scene_actions" ADD CONSTRAINT "scene_actions_child_scene_id_scenes_id_fk" FOREIGN KEY ("child_scene_id") REFERENCES "public"."scenes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scene_actions_child" ON "scene_actions" USING btree ("child_scene_id");--> statement-breakpoint
ALTER TABLE "scene_actions" ADD CONSTRAINT "scene_actions_target_chk" CHECK (("scene_actions"."device_id" IS NOT NULL AND "scene_actions"."child_scene_id" IS NULL AND "scene_actions"."command" IS NOT NULL)
        OR ("scene_actions"."child_scene_id" IS NOT NULL AND "scene_actions"."device_id" IS NULL));