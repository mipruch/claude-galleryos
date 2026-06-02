CREATE TABLE "config" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"driver_id" varchar(100) NOT NULL,
	"host" varchar(255),
	"port" integer,
	"protocol" varchar(20) DEFAULT 'tcp',
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(100) DEFAULT 'admin'
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"room_id" uuid,
	"name" varchar(100) NOT NULL,
	"description" text,
	"type" varchar(50) NOT NULL,
	"subtype" varchar(100),
	"address" jsonb NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"icon" varchar(50),
	"display_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(100) DEFAULT 'admin'
);
--> statement-breakpoint
CREATE TABLE "input_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"protocol" varchar(20) NOT NULL,
	"pattern" varchar(255) NOT NULL,
	"target_type" varchar(50) NOT NULL,
	"target_id" uuid,
	"target_command" varchar(100),
	"params_template" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" bigserial NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"level" varchar(10) NOT NULL,
	"source" varchar(100) NOT NULL,
	"entity_type" varchar(50),
	"entity_id" uuid,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"icon" varchar(50),
	"color" varchar(7),
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scene_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"step_order" integer DEFAULT 0 NOT NULL,
	"parallel_group" integer DEFAULT 0 NOT NULL,
	"delay_ms" integer DEFAULT 0 NOT NULL,
	"command" varchar(100) NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"on_failure" varchar(20) DEFAULT 'continue' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scene_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"source" varchar(100) NOT NULL,
	"source_detail" varchar(255),
	"pre_state" jsonb,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "scene_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(100) DEFAULT 'admin'
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid,
	"name" varchar(100) NOT NULL,
	"description" text,
	"icon" varchar(50),
	"color" varchar(7),
	"is_favorite" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(100) DEFAULT 'admin'
);
--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"scene_id" uuid NOT NULL,
	"cron" varchar(100) NOT NULL,
	"timezone" varchar(50) DEFAULT 'Europe/Prague' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(100) DEFAULT 'admin'
);
--> statement-breakpoint
CREATE TABLE "ui_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_actions" ADD CONSTRAINT "scene_actions_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_actions" ADD CONSTRAINT "scene_actions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_executions" ADD CONSTRAINT "scene_executions_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_versions" ADD CONSTRAINT "scene_versions_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_connections_driver" ON "connections" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "idx_devices_room" ON "devices" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "idx_devices_connection" ON "devices" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "idx_devices_type" ON "devices" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_input_mappings_protocol" ON "input_mappings" USING btree ("protocol","enabled");--> statement-breakpoint
CREATE INDEX "idx_logs_entity" ON "logs" USING btree ("entity_type","entity_id","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_logs_source" ON "logs" USING btree ("source","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_scene_actions_scene" ON "scene_actions" USING btree ("scene_id","step_order");--> statement-breakpoint
CREATE INDEX "idx_scene_executions_scene" ON "scene_executions" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "idx_scene_executions_status" ON "scene_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_scene_executions_started" ON "scene_executions" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_scene_versions_scene" ON "scene_versions" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "idx_scenes_room" ON "scenes" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "idx_scenes_favorite" ON "scenes" USING btree ("is_favorite");