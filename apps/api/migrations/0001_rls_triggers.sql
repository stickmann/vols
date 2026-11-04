-- Изоляция операторов (RLS), права роли приложения и триггеры целостности сети.
-- Таблицы описаны в Drizzle-схеме; здесь то, что Drizzle не генерирует.

-- ============================================================ роль приложения

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vols_app') THEN
    CREATE ROLE vols_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO vols_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vols_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vols_app;
REVOKE UPDATE, DELETE ON audit_log FROM vols_app;
REVOKE INSERT, UPDATE, DELETE ON spatial_ref_sys FROM vols_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vols_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vols_app;
--> statement-breakpoint

-- ============================================================ RLS

-- Текущий оператор задаётся на транзакцию: SELECT set_config('app.tenant_id', '<uuid>', true).
-- Не задан — NULL, и ни одна строка не видна.
CREATE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
--> statement-breakpoint

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memberships', 'audit_log',
    'color_schemes', 'cable_types', 'cable_type_modules', 'cable_type_fibers', 'equipment_models',
    'sites', 'routes', 'equipment', 'cables', 'cable_spans', 'span_routes', 'cable_slacks',
    'fibers', 'terminals', 'connections'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- ============================================================ updated_at и аудит

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) - 'updated_at' = to_jsonb(NEW) - 'updated_at' THEN
    RETURN NULL;
  END IF;
  INSERT INTO audit_log (tenant_id, user_id, table_name, row_id, action, old_data, new_data)
  VALUES (
    r.tenant_id,
    nullif(current_setting('app.user_id', true), '')::uuid,
    TG_TABLE_NAME,
    r.id,
    lower(TG_OP),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
  );
  RETURN NULL;
END $$;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants', 'users', 'color_schemes', 'cable_types', 'equipment_models',
    'sites', 'routes', 'equipment', 'cables', 'cable_spans', 'cable_slacks', 'connections'
  ] LOOP
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'color_schemes', 'cable_types', 'equipment_models',
    'sites', 'routes', 'equipment', 'cables', 'cable_spans', 'cable_slacks', 'connections'
  ] LOOP
    EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ============================================================ конструкция типа кабеля

-- Проверка целостности конструкции в конце транзакции: модули 1..N подряд,
-- в каждом модуле волокна 1..fiber_count, сквозная нумерация по порядку модулей.
CREATE FUNCTION cable_type_structure_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  type_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.cable_type_id ELSE NEW.cable_type_id END;
  bad text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cable_types WHERE id = type_id) THEN
    RETURN NULL; -- тип удалён целиком
  END IF;

  SELECT CASE
    WHEN count(*) = 0 THEN 'в кабеле нет модулей'
    WHEN max(module_no) <> count(*) THEN 'модули должны быть пронумерованы подряд с 1'
    WHEN sum(fiber_count) = 0 THEN 'в кабеле нет волокон'
  END INTO bad
  FROM cable_type_modules WHERE cable_type_id = type_id;

  IF bad IS NULL THEN
    SELECT 'модуль ' || m.module_no || ': волокон ' || count(f.id) || ', ожидалось ' || m.fiber_count
    INTO bad
    FROM cable_type_modules m
    LEFT JOIN cable_type_fibers f ON f.cable_type_id = m.cable_type_id AND f.module_no = m.module_no
    WHERE m.cable_type_id = type_id
    GROUP BY m.module_no, m.fiber_count
    HAVING count(f.id) <> m.fiber_count OR coalesce(max(f.position), 0) <> m.fiber_count
    LIMIT 1;
  END IF;

  IF bad IS NULL THEN
    SELECT 'волокно ' || number || ': сквозная нумерация должна идти подряд по модулям'
    INTO bad
    FROM (
      SELECT number, row_number() OVER (ORDER BY module_no, position) AS expected
      FROM cable_type_fibers WHERE cable_type_id = type_id
    ) s
    WHERE number <> expected
    LIMIT 1;
  END IF;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Некорректная конструкция кабеля: %', bad USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER structure_check
  AFTER INSERT OR UPDATE OR DELETE ON cable_type_modules
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION cable_type_structure_check();
CREATE CONSTRAINT TRIGGER structure_check
  AFTER INSERT OR UPDATE OR DELETE ON cable_type_fibers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION cable_type_structure_check();
--> statement-breakpoint

-- Конструкцию типа, по которому уже проложены кабели, менять нельзя: волокна
-- в пролётах созданы по ней. Цвета менять можно.
CREATE FUNCTION cable_type_in_use_guard(type_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cables WHERE cable_type_id = type_id) THEN
    RAISE EXCEPTION 'Тип кабеля используется в проложенных кабелях: удалить его или изменить конструкцию нельзя, менять можно только цвета'
      USING ERRCODE = '23503';
  END IF;
END $$;
--> statement-breakpoint

CREATE FUNCTION cable_type_modules_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.cable_type_id, NEW.module_no, NEW.fiber_count) IS DISTINCT FROM (OLD.cable_type_id, OLD.module_no, OLD.fiber_count) THEN
      PERFORM cable_type_in_use_guard(OLD.cable_type_id);
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM cable_type_in_use_guard(OLD.cable_type_id);
    RETURN OLD;
  END IF;
  PERFORM cable_type_in_use_guard(NEW.cable_type_id);
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE FUNCTION cable_type_fibers_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.cable_type_id, NEW.number, NEW.module_no, NEW.position) IS DISTINCT FROM (OLD.cable_type_id, OLD.number, OLD.module_no, OLD.position) THEN
      PERFORM cable_type_in_use_guard(OLD.cable_type_id);
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM cable_type_in_use_guard(OLD.cable_type_id);
    RETURN OLD;
  END IF;
  PERFORM cable_type_in_use_guard(NEW.cable_type_id);
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER structure_lock BEFORE INSERT OR UPDATE OR DELETE ON cable_type_modules
  FOR EACH ROW EXECUTE FUNCTION cable_type_modules_lock();
CREATE TRIGGER structure_lock BEFORE INSERT OR UPDATE OR DELETE ON cable_type_fibers
  FOR EACH ROW EXECUTE FUNCTION cable_type_fibers_lock();
--> statement-breakpoint

-- ============================================================ трассы: концы прилипают к местам

CREATE FUNCTION route_snap_endpoints() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  a geometry;
  b geometry;
BEGIN
  SELECT geom INTO a FROM sites WHERE id = NEW.from_site_id AND tenant_id = NEW.tenant_id;
  SELECT geom INTO b FROM sites WHERE id = NEW.to_site_id AND tenant_id = NEW.tenant_id;
  IF a IS NOT NULL AND b IS NOT NULL AND ST_NPoints(NEW.geom) >= 2 THEN
    NEW.geom := ST_SetPoint(ST_SetPoint(NEW.geom, 0, a), ST_NPoints(NEW.geom) - 1, b);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER snap_endpoints BEFORE INSERT OR UPDATE OF geom, from_site_id, to_site_id ON routes
  FOR EACH ROW EXECUTE FUNCTION route_snap_endpoints();
--> statement-breakpoint

CREATE FUNCTION site_move_routes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE routes SET geom = geom WHERE from_site_id = NEW.id OR to_site_id = NEW.id;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE TRIGGER move_routes AFTER UPDATE OF geom ON sites
  FOR EACH ROW WHEN (NOT ST_Equals(OLD.geom, NEW.geom))
  EXECUTE FUNCTION site_move_routes();
--> statement-breakpoint

-- ============================================================ оборудование: порты по модели

CREATE FUNCTION equipment_create_ports() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  m equipment_models;
BEGIN
  SELECT * INTO m FROM equipment_models WHERE id = NEW.model_id;

  IF NEW.kind = 'splitter' THEN
    INSERT INTO terminals (tenant_id, kind, site_id, equipment_id, port_role, port_no)
    SELECT NEW.tenant_id, 'port'::terminal_kind, NEW.site_id, NEW.id, 'in'::port_role, n
    FROM generate_series(1, m.splitter_inputs) n
    UNION ALL
    SELECT NEW.tenant_id, 'port'::terminal_kind, NEW.site_id, NEW.id, 'out'::port_role, n
    FROM generate_series(1, m.splitter_outputs) n;
  ELSIF NEW.kind IN ('odf', 'terminal_box') THEN
    INSERT INTO terminals (tenant_id, kind, site_id, equipment_id, port_role, port_no, port_face)
    SELECT NEW.tenant_id, 'port', NEW.site_id, NEW.id, 'adapter', n, face::port_face
    FROM generate_series(1, m.port_count) n, (VALUES ('rear'), ('front')) f(face);
  ELSIF NEW.kind IN ('olt', 'onu') THEN
    INSERT INTO terminals (tenant_id, kind, site_id, equipment_id, port_role, port_no)
    SELECT NEW.tenant_id, 'port', NEW.site_id, NEW.id, 'pon', n FROM generate_series(1, m.port_count) n;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE TRIGGER create_ports AFTER INSERT ON equipment
  FOR EACH ROW EXECUTE FUNCTION equipment_create_ports();
--> statement-breakpoint

CREATE FUNCTION equipment_model_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.model_id <> OLD.model_id OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'Модель и вид оборудования менять нельзя: порты созданы по модели. Замените оборудование.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER model_lock BEFORE UPDATE OF model_id, kind ON equipment
  FOR EACH ROW EXECUTE FUNCTION equipment_model_lock();
--> statement-breakpoint

-- ============================================================ кабели: волокна по конструкции

CREATE FUNCTION cable_type_change_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cable_type_id <> OLD.cable_type_id AND EXISTS (SELECT 1 FROM cable_spans WHERE cable_id = NEW.id) THEN
    RAISE EXCEPTION 'Нельзя сменить тип кабеля, по которому уже есть пролёты' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER type_lock BEFORE UPDATE OF cable_type_id ON cables
  FOR EACH ROW EXECUTE FUNCTION cable_type_change_lock();
--> statement-breakpoint

-- Новый пролёт: волокна по конструкции типа кабеля и по два конца на каждое.
CREATE FUNCTION cable_span_create_fibers() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO fibers (tenant_id, span_id, number, module_no, position)
  SELECT NEW.tenant_id, NEW.id, f.number, f.module_no, f.position
  FROM cables c
  JOIN cable_type_fibers f ON f.cable_type_id = c.cable_type_id
  WHERE c.id = NEW.cable_id;

  INSERT INTO terminals (tenant_id, kind, site_id, equipment_id, fiber_id, fiber_side)
  SELECT
    NEW.tenant_id, 'fiber_end',
    CASE s.side WHEN 'a' THEN NEW.from_site_id ELSE NEW.to_site_id END,
    CASE s.side WHEN 'a' THEN NEW.from_equipment_id ELSE NEW.to_equipment_id END,
    f.id, s.side::fiber_side
  FROM fibers f, (VALUES ('a'), ('b')) s(side)
  WHERE f.span_id = NEW.id;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE TRIGGER create_fibers AFTER INSERT ON cable_spans
  FOR EACH ROW EXECUTE FUNCTION cable_span_create_fibers();
--> statement-breakpoint

-- Перенос конца пролёта (другое место или корпус) переносит концы волокон.
CREATE FUNCTION cable_span_sync_terminals() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cable_id <> OLD.cable_id THEN
    RAISE EXCEPTION 'Пролёт нельзя перенести в другой кабель' USING ERRCODE = '23514';
  END IF;
  UPDATE terminals t
  SET site_id = CASE t.fiber_side WHEN 'a' THEN NEW.from_site_id ELSE NEW.to_site_id END,
      equipment_id = CASE t.fiber_side WHEN 'a' THEN NEW.from_equipment_id ELSE NEW.to_equipment_id END
  FROM fibers f
  WHERE f.span_id = NEW.id AND t.fiber_id = f.id
    AND (t.site_id, t.equipment_id) IS DISTINCT FROM (
      CASE t.fiber_side WHEN 'a' THEN NEW.from_site_id ELSE NEW.to_site_id END,
      CASE t.fiber_side WHEN 'a' THEN NEW.from_equipment_id ELSE NEW.to_equipment_id END
    );
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE TRIGGER sync_terminals AFTER UPDATE OF cable_id, from_site_id, to_site_id, from_equipment_id, to_equipment_id
  ON cable_spans FOR EACH ROW EXECUTE FUNCTION cable_span_sync_terminals();
--> statement-breakpoint

-- ============================================================ соединения

CREATE FUNCTION connection_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ta terminals;
  tb terminals;
  fa fibers;
  fb fibers;
BEGIN
  -- Блокируем обе точки в порядке id: параллельные соединения на одну точку выстроятся в очередь.
  PERFORM 1 FROM terminals WHERE id IN (NEW.a_terminal_id, NEW.b_terminal_id) ORDER BY id FOR UPDATE;
  SELECT * INTO ta FROM terminals WHERE id = NEW.a_terminal_id;
  SELECT * INTO tb FROM terminals WHERE id = NEW.b_terminal_id;
  IF ta.id IS NULL OR tb.id IS NULL THEN
    RETURN NEW; -- сообщит внешний ключ
  END IF;

  IF EXISTS (
    SELECT 1 FROM connections c
    WHERE c.id <> NEW.id
      AND (c.a_terminal_id IN (NEW.a_terminal_id, NEW.b_terminal_id)
        OR c.b_terminal_id IN (NEW.a_terminal_id, NEW.b_terminal_id))
  ) THEN
    RAISE EXCEPTION 'Точка подключения уже занята другим соединением' USING ERRCODE = '23505';
  END IF;

  IF ta.site_id <> NEW.site_id OR tb.site_id <> NEW.site_id THEN
    RAISE EXCEPTION 'Обе точки соединения должны находиться в месте соединения' USING ERRCODE = '23514';
  END IF;

  IF NEW.kind IN ('fusion', 'mechanical') AND (
       'front' IN (ta.port_face, tb.port_face) OR 'pon' IN (ta.port_role, tb.port_role)) THEN
    RAISE EXCEPTION 'Сварка возможна только с волокном, пигтейлом (rear) или сплиттером' USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'patch' AND 'rear' IN (ta.port_face, tb.port_face) THEN
    RAISE EXCEPTION 'Патч-корд подключается к лицевой стороне адаптера (front)' USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'through' THEN
    IF ta.kind <> 'fiber_end' OR tb.kind <> 'fiber_end' THEN
      RAISE EXCEPTION 'Транзит возможен только между концами волокон' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO fa FROM fibers WHERE id = ta.fiber_id;
    SELECT * INTO fb FROM fibers WHERE id = tb.fiber_id;
    IF fa.number <> fb.number OR NOT EXISTS (
      SELECT 1 FROM cable_spans sa JOIN cable_spans sb ON sa.cable_id = sb.cable_id
      WHERE sa.id = fa.span_id AND sb.id = fb.span_id AND sa.id <> sb.id
    ) THEN
      RAISE EXCEPTION 'Транзит — это одно и то же волокно соседних пролётов одного кабеля' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER check_connection BEFORE INSERT OR UPDATE ON connections
  FOR EACH ROW EXECUTE FUNCTION connection_check();
--> statement-breakpoint

-- Если точка переехала (перенесли корпус, конец пролёта), её соединения должны
-- оказаться там же. Проверка в конце транзакции: каскады успевают обновить связанные строки.
CREATE FUNCTION terminal_site_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM terminals t
    JOIN connections c ON t.id IN (c.a_terminal_id, c.b_terminal_id)
    WHERE t.id = NEW.id AND c.site_id <> t.site_id
  ) THEN
    RAISE EXCEPTION 'Точка подключения перенесена в другое место, но её соединение осталось в старом. Сначала разъедините.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER site_check AFTER UPDATE OF site_id ON terminals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION terminal_site_check();
