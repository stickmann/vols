CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TYPE "public"."cable_construction" AS ENUM('aerial', 'duct', 'ground', 'indoor', 'drop');--> statement-breakpoint
CREATE TYPE "public"."connection_kind" AS ENUM('fusion', 'mechanical', 'patch', 'through');--> statement-breakpoint
CREATE TYPE "public"."equipment_kind" AS ENUM('closure', 'terminal_box', 'odf', 'splitter', 'olt', 'onu');--> statement-breakpoint
CREATE TYPE "public"."fiber_condition" AS ENUM('ok', 'damaged', 'reserved');--> statement-breakpoint
CREATE TYPE "public"."fiber_side" AS ENUM('a', 'b');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'designer', 'technician', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."object_status" AS ENUM('planned', 'built', 'decommissioned');--> statement-breakpoint
CREATE TYPE "public"."port_face" AS ENUM('rear', 'front');--> statement-breakpoint
CREATE TYPE "public"."port_role" AS ENUM('in', 'out', 'adapter', 'pon');--> statement-breakpoint
CREATE TYPE "public"."route_kind" AS ENUM('aerial', 'duct', 'ground', 'facade', 'indoor');--> statement-breakpoint
CREATE TYPE "public"."site_kind" AS ENUM('pop', 'pole', 'manhole', 'cabinet', 'building', 'entrance', 'point');--> statement-breakpoint
CREATE TYPE "public"."terminal_kind" AS ENUM('fiber_end', 'port');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"action" text NOT NULL,
	"old_data" jsonb,
	"new_data" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "cable_type_fibers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cable_type_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"module_no" integer NOT NULL,
	"position" integer NOT NULL,
	"color_name" text NOT NULL,
	"color_hex" text NOT NULL,
	"color_marks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cable_type_fibers_number_uq" UNIQUE("cable_type_id","number"),
	CONSTRAINT "cable_type_fibers_pos_uq" UNIQUE("cable_type_id","module_no","position"),
	CONSTRAINT "cable_type_fibers_ck" CHECK ("cable_type_fibers"."number" >= 1 AND "cable_type_fibers"."position" >= 1),
	CONSTRAINT "cable_type_fibers_hex_ck" CHECK ("cable_type_fibers"."color_hex" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "cable_type_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cable_type_id" uuid NOT NULL,
	"module_no" integer NOT NULL,
	"color_name" text NOT NULL,
	"color_hex" text NOT NULL,
	"color_marks" integer DEFAULT 0 NOT NULL,
	"fiber_count" integer NOT NULL,
	CONSTRAINT "cable_type_modules_no_uq" UNIQUE("cable_type_id","module_no"),
	CONSTRAINT "cable_type_modules_no_ck" CHECK ("cable_type_modules"."module_no" >= 1),
	CONSTRAINT "cable_type_modules_count_ck" CHECK ("cable_type_modules"."fiber_count" >= 0),
	CONSTRAINT "cable_type_modules_hex_ck" CHECK ("cable_type_modules"."color_hex" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "cable_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"construction" "cable_construction" NOT NULL,
	"fiber_standard" text,
	"attenuation_1310_db_km" numeric(5, 3) DEFAULT 0.35 NOT NULL,
	"attenuation_1550_db_km" numeric(5, 3) DEFAULT 0.22 NOT NULL,
	"outer_diameter_mm" numeric(5, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cable_types_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "cable_types_tenant_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "color_schemes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"colors" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "color_schemes_tenant_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "equipment_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "equipment_kind" NOT NULL,
	"name" text NOT NULL,
	"manufacturer" text,
	"port_count" integer,
	"max_splices" integer,
	"cable_entries" integer,
	"splitter_inputs" integer,
	"splitter_outputs" integer,
	"insertion_loss_db" numeric(5, 2),
	"output_losses_db" jsonb,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_models_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "equipment_models_tenant_id_kind_uq" UNIQUE("tenant_id","id","kind"),
	CONSTRAINT "equipment_models_tenant_name_uq" UNIQUE("tenant_id","kind","name"),
	CONSTRAINT "equipment_models_splitter_ck" CHECK ("equipment_models"."kind" <> 'splitter' OR ("equipment_models"."splitter_inputs" BETWEEN 1 AND 2 AND "equipment_models"."splitter_outputs" BETWEEN 2 AND 128)),
	CONSTRAINT "equipment_models_ports_ck" CHECK ("equipment_models"."kind" NOT IN ('odf', 'terminal_box', 'olt', 'onu') OR "equipment_models"."port_count" BETWEEN 1 AND 576)
);
--> statement-breakpoint
CREATE TABLE "cable_slacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"span_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"length_m" numeric(8, 2) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cable_slacks_len_ck" CHECK ("cable_slacks"."length_m" > 0)
);
--> statement-breakpoint
CREATE TABLE "cable_spans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cable_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"from_site_id" uuid NOT NULL,
	"to_site_id" uuid NOT NULL,
	"from_equipment_id" uuid,
	"to_equipment_id" uuid,
	"measured_length_m" numeric(10, 2),
	"start_mark_m" numeric(10, 2),
	"end_mark_m" numeric(10, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cable_spans_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "cable_spans_seq_uq" UNIQUE("cable_id","seq"),
	CONSTRAINT "cable_spans_ends_ck" CHECK ("cable_spans"."from_site_id" <> "cable_spans"."to_site_id"),
	CONSTRAINT "cable_spans_seq_ck" CHECK ("cable_spans"."seq" >= 1)
);
--> statement-breakpoint
CREATE TABLE "cables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cable_type_id" uuid NOT NULL,
	"name" text,
	"status" "object_status" DEFAULT 'planned' NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cables_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "connection_kind" NOT NULL,
	"site_id" uuid NOT NULL,
	"equipment_id" uuid,
	"a_terminal_id" uuid NOT NULL,
	"b_terminal_id" uuid NOT NULL,
	"loss_db" numeric(5, 2),
	"tray_no" integer,
	"slot_no" integer,
	"performed_at" timestamp with time zone,
	"performed_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_a_uq" UNIQUE("a_terminal_id"),
	CONSTRAINT "connections_b_uq" UNIQUE("b_terminal_id"),
	CONSTRAINT "connections_ends_ck" CHECK ("connections"."a_terminal_id" <> "connections"."b_terminal_id")
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "equipment_kind" NOT NULL,
	"model_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text,
	"serial" text,
	"status" "object_status" DEFAULT 'planned' NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "equipment_tenant_id_site_uq" UNIQUE("tenant_id","id","site_id"),
	CONSTRAINT "equipment_parent_ck" CHECK ("equipment"."parent_id" IS NULL OR "equipment"."parent_id" <> "equipment"."id")
);
--> statement-breakpoint
CREATE TABLE "fibers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"span_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"module_no" integer NOT NULL,
	"position" integer NOT NULL,
	"condition" "fiber_condition" DEFAULT 'ok' NOT NULL,
	"notes" text,
	CONSTRAINT "fibers_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fibers_span_number_uq" UNIQUE("span_id","number")
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "route_kind" NOT NULL,
	"name" text,
	"from_site_id" uuid NOT NULL,
	"to_site_id" uuid NOT NULL,
	"geom" geometry(LineString,4326) NOT NULL,
	"length_m" double precision GENERATED ALWAYS AS (ST_Length(geom::geography)) STORED NOT NULL,
	"status" "object_status" DEFAULT 'planned' NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routes_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "routes_ends_ck" CHECK ("routes"."from_site_id" <> "routes"."to_site_id"),
	CONSTRAINT "routes_geom_ck" CHECK (ST_NPoints("routes"."geom") >= 2)
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "site_kind" NOT NULL,
	"name" text,
	"geom" geometry(Point,4326) NOT NULL,
	"address" text,
	"status" "object_status" DEFAULT 'planned' NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "span_routes" (
	"tenant_id" uuid NOT NULL,
	"span_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"route_id" uuid NOT NULL,
	"reversed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "span_routes_span_id_seq_pk" PRIMARY KEY("span_id","seq")
);
--> statement-breakpoint
CREATE TABLE "terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "terminal_kind" NOT NULL,
	"site_id" uuid NOT NULL,
	"equipment_id" uuid,
	"fiber_id" uuid,
	"fiber_side" "fiber_side",
	"port_role" "port_role",
	"port_no" integer,
	"port_face" "port_face",
	"label" text,
	CONSTRAINT "terminals_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "terminals_fiber_end_uq" UNIQUE("fiber_id","fiber_side"),
	CONSTRAINT "terminals_kind_ck" CHECK (("terminals"."kind" = 'fiber_end' AND "terminals"."fiber_id" IS NOT NULL AND "terminals"."fiber_side" IS NOT NULL
            AND "terminals"."port_role" IS NULL AND "terminals"."port_no" IS NULL AND "terminals"."port_face" IS NULL)
       OR ("terminals"."kind" = 'port' AND "terminals"."equipment_id" IS NOT NULL AND "terminals"."port_role" IS NOT NULL AND "terminals"."port_no" >= 1
            AND "terminals"."fiber_id" IS NULL AND "terminals"."fiber_side" IS NULL
            AND (("terminals"."port_role" = 'adapter') = ("terminals"."port_face" IS NOT NULL))))
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_type_fibers" ADD CONSTRAINT "cable_type_fibers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_type_fibers" ADD CONSTRAINT "cable_type_fibers_module_fk" FOREIGN KEY ("cable_type_id","module_no") REFERENCES "public"."cable_type_modules"("cable_type_id","module_no") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_type_fibers" ADD CONSTRAINT "cable_type_fibers_type_fk" FOREIGN KEY ("tenant_id","cable_type_id") REFERENCES "public"."cable_types"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_type_modules" ADD CONSTRAINT "cable_type_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_type_modules" ADD CONSTRAINT "cable_type_modules_type_fk" FOREIGN KEY ("tenant_id","cable_type_id") REFERENCES "public"."cable_types"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_types" ADD CONSTRAINT "cable_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "color_schemes" ADD CONSTRAINT "color_schemes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_models" ADD CONSTRAINT "equipment_models_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_slacks" ADD CONSTRAINT "cable_slacks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_slacks" ADD CONSTRAINT "cable_slacks_span_fk" FOREIGN KEY ("tenant_id","span_id") REFERENCES "public"."cable_spans"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_slacks" ADD CONSTRAINT "cable_slacks_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_spans" ADD CONSTRAINT "cable_spans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_spans" ADD CONSTRAINT "cable_spans_cable_fk" FOREIGN KEY ("tenant_id","cable_id") REFERENCES "public"."cables"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_spans" ADD CONSTRAINT "cable_spans_from_site_fk" FOREIGN KEY ("tenant_id","from_site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_spans" ADD CONSTRAINT "cable_spans_to_site_fk" FOREIGN KEY ("tenant_id","to_site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_spans" ADD CONSTRAINT "cable_spans_from_eq_fk" FOREIGN KEY ("tenant_id","from_equipment_id","from_site_id") REFERENCES "public"."equipment"("tenant_id","id","site_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cable_spans" ADD CONSTRAINT "cable_spans_to_eq_fk" FOREIGN KEY ("tenant_id","to_equipment_id","to_site_id") REFERENCES "public"."equipment"("tenant_id","id","site_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cables" ADD CONSTRAINT "cables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cables" ADD CONSTRAINT "cables_type_fk" FOREIGN KEY ("tenant_id","cable_type_id") REFERENCES "public"."cable_types"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_equipment_fk" FOREIGN KEY ("tenant_id","equipment_id","site_id") REFERENCES "public"."equipment"("tenant_id","id","site_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_a_fk" FOREIGN KEY ("tenant_id","a_terminal_id") REFERENCES "public"."terminals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_b_fk" FOREIGN KEY ("tenant_id","b_terminal_id") REFERENCES "public"."terminals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_model_fk" FOREIGN KEY ("tenant_id","model_id","kind") REFERENCES "public"."equipment_models"("tenant_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_parent_fk" FOREIGN KEY ("tenant_id","parent_id","site_id") REFERENCES "public"."equipment"("tenant_id","id","site_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fibers" ADD CONSTRAINT "fibers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fibers" ADD CONSTRAINT "fibers_span_fk" FOREIGN KEY ("tenant_id","span_id") REFERENCES "public"."cable_spans"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_from_site_fk" FOREIGN KEY ("tenant_id","from_site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_to_site_fk" FOREIGN KEY ("tenant_id","to_site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "span_routes" ADD CONSTRAINT "span_routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "span_routes" ADD CONSTRAINT "span_routes_span_fk" FOREIGN KEY ("tenant_id","span_id") REFERENCES "public"."cable_spans"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "span_routes" ADD CONSTRAINT "span_routes_route_fk" FOREIGN KEY ("tenant_id","route_id") REFERENCES "public"."routes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_equipment_fk" FOREIGN KEY ("tenant_id","equipment_id","site_id") REFERENCES "public"."equipment"("tenant_id","id","site_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_fiber_fk" FOREIGN KEY ("tenant_id","fiber_id") REFERENCES "public"."fibers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_id_table_name_row_id_index" ON "audit_log" USING btree ("tenant_id","table_name","row_id");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_id_at_index" ON "audit_log" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "memberships_user_id_index" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cable_slacks_span_id_index" ON "cable_slacks" USING btree ("span_id");--> statement-breakpoint
CREATE INDEX "cable_spans_from_site_id_index" ON "cable_spans" USING btree ("from_site_id");--> statement-breakpoint
CREATE INDEX "cable_spans_to_site_id_index" ON "cable_spans" USING btree ("to_site_id");--> statement-breakpoint
CREATE INDEX "cable_spans_from_equipment_id_index" ON "cable_spans" USING btree ("from_equipment_id");--> statement-breakpoint
CREATE INDEX "cable_spans_to_equipment_id_index" ON "cable_spans" USING btree ("to_equipment_id");--> statement-breakpoint
CREATE INDEX "connections_site_id_index" ON "connections" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "connections_equipment_id_index" ON "connections" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_site_id_index" ON "equipment" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "equipment_parent_id_index" ON "equipment" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "routes_geom_gix" ON "routes" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "routes_from_site_id_index" ON "routes" USING btree ("from_site_id");--> statement-breakpoint
CREATE INDEX "routes_to_site_id_index" ON "routes" USING btree ("to_site_id");--> statement-breakpoint
CREATE INDEX "sites_geom_gix" ON "sites" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "sites_tenant_id_kind_index" ON "sites" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "span_routes_route_id_index" ON "span_routes" USING btree ("route_id");--> statement-breakpoint
CREATE UNIQUE INDEX "terminals_port_uq" ON "terminals" USING btree ("equipment_id","port_role","port_no") WHERE "terminals"."kind" = 'port' AND "terminals"."port_face" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "terminals_adapter_uq" ON "terminals" USING btree ("equipment_id","port_no","port_face") WHERE "terminals"."port_face" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "terminals_site_id_index" ON "terminals" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "terminals_equipment_id_index" ON "terminals" USING btree ("equipment_id");