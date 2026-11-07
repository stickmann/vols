CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_op_id" uuid
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "op_id" uuid;--> statement-breakpoint
ALTER TABLE "span_routes" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operations_tenant_id_created_at_index" ON "operations" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_op_id_index" ON "audit_log" USING btree ("op_id");--> statement-breakpoint
ALTER TABLE "span_routes" ADD CONSTRAINT "span_routes_id_unique" UNIQUE("id");--> statement-breakpoint

-- ============================================================ операции и отмена
-- Операция (удаление, очистка разварки…) ставит app.op_id на транзакцию: все изменения
-- в журнале помечаются ею. Отмена возвращает каждую затронутую строку в состояние до
-- операции. На время отмены (app.restoring = on) автоматика не срабатывает: волокна,
-- концы и порты возвращаются из журнала с прежними id, а не создаются заново.

ALTER TABLE operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON operations USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON operations TO vols_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) - 'updated_at' = to_jsonb(NEW) - 'updated_at' THEN
    RETURN NULL;
  END IF;
  INSERT INTO audit_log (tenant_id, user_id, table_name, row_id, action, old_data, new_data, op_id)
  VALUES (
    r.tenant_id,
    nullif(current_setting('app.user_id', true), '')::uuid,
    TG_TABLE_NAME,
    r.id,
    lower(TG_OP),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
    nullif(current_setting('app.op_id', true), '')::uuid
  );
  RETURN NULL;
END $$;
--> statement-breakpoint

-- Волокна, концы и участки трассы создаются автоматически тысячами — журналируем их
-- только внутри операции, где они нужны для отмены.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fibers', 'terminals', 'span_routes'] LOOP
    EXECUTE format(
      'CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW '
      'WHEN (coalesce(current_setting(''app.op_id'', true), '''') <> '''') EXECUTE FUNCTION audit_row()', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Автоматика молчит во время отмены.
DROP TRIGGER snap_endpoints ON routes;
CREATE TRIGGER snap_endpoints BEFORE INSERT OR UPDATE OF geom, from_site_id, to_site_id ON routes
  FOR EACH ROW WHEN (coalesce(current_setting('app.restoring', true), '') <> 'on') EXECUTE FUNCTION route_snap_endpoints();
DROP TRIGGER move_routes ON sites;
CREATE TRIGGER move_routes AFTER UPDATE OF geom ON sites
  FOR EACH ROW WHEN (NOT ST_Equals(OLD.geom, NEW.geom) AND coalesce(current_setting('app.restoring', true), '') <> 'on')
  EXECUTE FUNCTION site_move_routes();
DROP TRIGGER create_ports ON equipment;
CREATE TRIGGER create_ports AFTER INSERT ON equipment
  FOR EACH ROW WHEN (coalesce(current_setting('app.restoring', true), '') <> 'on') EXECUTE FUNCTION equipment_create_ports();
DROP TRIGGER model_lock ON equipment;
CREATE TRIGGER model_lock BEFORE UPDATE OF model_id, kind ON equipment
  FOR EACH ROW WHEN (coalesce(current_setting('app.restoring', true), '') <> 'on') EXECUTE FUNCTION equipment_model_lock();
DROP TRIGGER type_lock ON cables;
CREATE TRIGGER type_lock BEFORE UPDATE OF cable_type_id ON cables
  FOR EACH ROW WHEN (coalesce(current_setting('app.restoring', true), '') <> 'on') EXECUTE FUNCTION cable_type_change_lock();
DROP TRIGGER create_fibers ON cable_spans;
CREATE TRIGGER create_fibers AFTER INSERT ON cable_spans
  FOR EACH ROW WHEN (coalesce(current_setting('app.restoring', true), '') <> 'on') EXECUTE FUNCTION cable_span_create_fibers();
DROP TRIGGER sync_terminals ON cable_spans;
CREATE TRIGGER sync_terminals AFTER UPDATE OF cable_id, from_site_id, to_site_id, from_equipment_id, to_equipment_id
  ON cable_spans FOR EACH ROW WHEN (coalesce(current_setting('app.restoring', true), '') <> 'on') EXECUTE FUNCTION cable_span_sync_terminals();
DROP TRIGGER check_connection ON connections;
CREATE TRIGGER check_connection BEFORE INSERT OR UPDATE ON connections
  FOR EACH ROW WHEN (coalesce(current_setting('app.restoring', true), '') <> 'on') EXECUTE FUNCTION connection_check();
--> statement-breakpoint

-- Ссылки и номера пролётов проверяются в конце транзакции отмены: строки возвращаются
-- в любом порядке. В обычной работе поведение прежнее (INITIALLY IMMEDIATE).
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
      AND conrelid::regclass::text IN ('sites', 'routes', 'equipment', 'cables', 'cable_spans', 'span_routes',
                                       'cable_slacks', 'fibers', 'terminals', 'connections')
  LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE', c.tbl, c.conname);
  END LOOP;
END $$;
ALTER TABLE cable_spans DROP CONSTRAINT cable_spans_seq_uq;
ALTER TABLE cable_spans ADD CONSTRAINT cable_spans_seq_uq UNIQUE (cable_id, seq) DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint

-- Состояние каждой затронутой строки до и после операции.
CREATE FUNCTION operation_rows(p_op uuid)
RETURNS TABLE (table_name text, row_id uuid, before jsonb, after jsonb)
LANGUAGE sql STABLE AS $$
  WITH a AS (SELECT * FROM audit_log WHERE op_id = p_op),
  f AS (SELECT DISTINCT ON (a.table_name, a.row_id) a.table_name, a.row_id, a.action, a.old_data FROM a ORDER BY a.table_name, a.row_id, a.id),
  l AS (SELECT DISTINCT ON (a.table_name, a.row_id) a.table_name, a.row_id, a.action, a.new_data FROM a ORDER BY a.table_name, a.row_id, a.id DESC)
  SELECT f.table_name, f.row_id,
         CASE WHEN f.action = 'insert' THEN NULL ELSE f.old_data END,
         CASE WHEN l.action = 'delete' THEN NULL ELSE l.new_data END
  FROM f JOIN l USING (table_name, row_id)
$$;
--> statement-breakpoint

-- Строки, изменённые после операции: отмена их затёрла бы.
CREATE FUNCTION operation_conflicts(p_op uuid)
RETURNS TABLE (table_name text, row_id uuid)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r record;
  cur jsonb;
BEGIN
  FOR r IN SELECT * FROM operation_rows(p_op) LOOP
    EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id = $1', r.table_name) INTO cur USING r.row_id;
    IF (cur - 'updated_at') IS DISTINCT FROM (r.after - 'updated_at') THEN
      table_name := r.table_name;
      row_id := r.row_id;
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- Вернуть все строки операции в состояние до неё. Возвращает число восстановленных строк.
CREATE FUNCTION undo_operation(p_op uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  cols text;
  excl text;
  n integer := 0;
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM set_config('app.restoring', 'on', true);

  -- Сначала убираем созданное операцией (освобождает места под возвращаемые строки).
  FOR r IN SELECT * FROM operation_rows(p_op) WHERE before IS NULL LOOP
    EXECUTE format('DELETE FROM %I WHERE id = $1', r.table_name) USING r.row_id;
    n := n + 1;
  END LOOP;

  -- Затем возвращаем прежние версии удалённых и изменённых строк.
  FOR r IN SELECT * FROM operation_rows(p_op) WHERE before IS NOT NULL LOOP
    SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position),
           string_agg('EXCLUDED.' || quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
      INTO cols, excl
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = r.table_name AND c.is_generated = 'NEVER';
    EXECUTE format(
      'INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, $1) ON CONFLICT (id) DO UPDATE SET (%s) = ROW(%s)',
      r.table_name, cols, cols, r.table_name, cols, excl
    ) USING r.before;
    n := n + 1;
  END LOOP;

  PERFORM set_config('app.restoring', 'off', true);
  SET CONSTRAINTS ALL IMMEDIATE;
  RETURN n;
END $$;
