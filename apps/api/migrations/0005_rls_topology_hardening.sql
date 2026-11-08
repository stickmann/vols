-- Защита целостности на уровне БД: аудит, транзиты и маршруты пролётов.
-- Миграция намеренно не меняет существующие данные; после применения новые и изменяемые
-- записи проходят более строгую проверку.

-- Аудит должен записываться только триггерами. SECURITY DEFINER позволяет триггеру
-- вставлять строку после отзыва прямого INSERT у vols_app.
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) - 'updated_at' = to_jsonb(NEW) - 'updated_at' THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.audit_log (tenant_id, user_id, table_name, row_id, action, old_data, new_data)
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
REVOKE INSERT, UPDATE, DELETE ON audit_log FROM vols_app;
--> statement-breakpoint

-- Проверка направленности и соседства транзита выполняется отдельным триггером,
-- чтобы сохранить существующие проверки занятости и расположения точек.
CREATE FUNCTION connection_topology_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ta terminals;
  tb terminals;
  fa fibers;
  fb fibers;
  sa cable_spans;
  sb cable_spans;
  ra equipment;
  rb equipment;
BEGIN
  SELECT * INTO ta FROM terminals WHERE id = NEW.a_terminal_id;
  SELECT * INTO tb FROM terminals WHERE id = NEW.b_terminal_id;
  IF ta.id IS NULL OR tb.id IS NULL THEN RETURN NEW; END IF;

  IF NEW.kind = 'through' THEN
    IF ta.kind <> 'fiber_end' OR tb.kind <> 'fiber_end' THEN
      RAISE EXCEPTION 'Транзит возможен только между концами волокон' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO fa FROM fibers WHERE id = ta.fiber_id;
    SELECT * INTO fb FROM fibers WHERE id = tb.fiber_id;
    SELECT * INTO sa FROM cable_spans WHERE id = fa.span_id;
    SELECT * INTO sb FROM cable_spans WHERE id = fb.span_id;

    IF fa.number IS DISTINCT FROM fb.number
       OR sa.cable_id IS DISTINCT FROM sb.cable_id
       OR sa.id = sb.id
       OR abs(sa.seq - sb.seq) <> 1
       OR NOT (
         (sa.seq < sb.seq AND sa.to_site_id = sb.from_site_id AND ta.fiber_side = 'b' AND tb.fiber_side = 'a')
         OR
         (sb.seq < sa.seq AND sb.to_site_id = sa.from_site_id AND tb.fiber_side = 'b' AND ta.fiber_side = 'a')
       )
       OR NEW.site_id IS DISTINCT FROM CASE WHEN sa.seq < sb.seq THEN sa.to_site_id ELSE sb.to_site_id END
    THEN
      RAISE EXCEPTION 'Транзит должен соединять одноимённые волокна соседних пролётов одного кабеля на общей границе' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- У сплиттера вход и выход имеют разное назначение. Не допускаем сварку
  -- одноимённых портов (input-input или output-output).
  IF NEW.kind IN ('fusion', 'mechanical')
     AND ta.kind = 'port' AND tb.kind = 'port'
     AND ta.equipment_id IS NOT NULL AND tb.equipment_id IS NOT NULL THEN
    SELECT * INTO ra FROM equipment WHERE id = ta.equipment_id;
    SELECT * INTO rb FROM equipment WHERE id = tb.equipment_id;
    IF ra.kind = 'splitter' AND rb.kind = 'splitter'
       AND ta.port_role IN ('in', 'out') AND tb.port_role IN ('in', 'out')
       AND ta.port_role = tb.port_role THEN
      RAISE EXCEPTION 'Нельзя соединять вход сплиттера со входом или выход с выходом' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Патч-корд должен иметь хотя бы один лицевой адаптерный порт; он не может
  -- подключаться к PON-порту или напрямую к концу волокна.
  IF NEW.kind = 'patch' THEN
    IF ta.kind <> 'port' OR tb.kind <> 'port'
       OR NOT (
         (ta.port_role = 'adapter' AND ta.port_face = 'front')
         OR (tb.port_role = 'adapter' AND tb.port_face = 'front')
       )
       OR ta.port_role = 'pon' OR tb.port_role = 'pon' THEN
      RAISE EXCEPTION 'Патч-корд должен подключаться к лицевому адаптерному порту и не может подключаться к PON-порту или волокну' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER connection_topology_guard
  BEFORE INSERT OR UPDATE ON connections
  FOR EACH ROW EXECUTE FUNCTION connection_topology_guard();
--> statement-breakpoint

-- Проверяем span_routes целиком в конце транзакции: API, импорт и прямой SQL
-- должны формировать непрерывный путь от начала до конца кабельного пролёта.
CREATE FUNCTION span_routes_integrity_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_span_id uuid;
  sp cable_spans;
  route_count integer;
  min_seq integer;
  max_seq integer;
  first_start uuid;
  last_end uuid;
  broken boolean;
BEGIN
  IF TG_TABLE_NAME = 'cable_spans' THEN
    target_span_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_span_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.span_id ELSE NEW.span_id END;
  END IF;

  SELECT * INTO sp FROM cable_spans WHERE id = target_span_id;
  IF sp.id IS NULL THEN RETURN NULL; END IF;

  SELECT count(*)::int, min(seq), max(seq)
    INTO route_count, min_seq, max_seq
    FROM span_routes WHERE span_id = target_span_id;

  IF route_count = 0 OR min_seq <> 1 OR max_seq <> route_count THEN
    RAISE EXCEPTION 'Маршрут кабельного пролёта должен содержать трассы с последовательными номерами начиная с 1' USING ERRCODE = '23514';
  END IF;

  SELECT
    (SELECT CASE WHEN x.reversed THEN r.to_site_id ELSE r.from_site_id END
       FROM span_routes x JOIN routes r ON r.id = x.route_id
      WHERE x.span_id = target_span_id ORDER BY x.seq LIMIT 1),
    (SELECT CASE WHEN x.reversed THEN r.from_site_id ELSE r.to_site_id END
       FROM span_routes x JOIN routes r ON r.id = x.route_id
      WHERE x.span_id = target_span_id ORDER BY x.seq DESC LIMIT 1),
    EXISTS (
      SELECT 1
      FROM span_routes x
      JOIN routes r ON r.id = x.route_id
      JOIN span_routes nx ON nx.span_id = x.span_id AND nx.seq = x.seq + 1
      JOIN routes nr ON nr.id = nx.route_id
      WHERE x.span_id = target_span_id
        AND (CASE WHEN x.reversed THEN r.from_site_id ELSE r.to_site_id END)
            IS DISTINCT FROM
            (CASE WHEN nx.reversed THEN nr.to_site_id ELSE nr.from_site_id END)
    )
  INTO first_start, last_end, broken;

  IF first_start IS DISTINCT FROM sp.from_site_id
     OR last_end IS DISTINCT FROM sp.to_site_id
     OR broken THEN
    RAISE EXCEPTION 'Маршрут пролёта должен непрерывно соединять его начальное и конечное места; проверьте порядок трасс и reversed' USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER span_routes_integrity
  AFTER INSERT OR UPDATE OR DELETE ON span_routes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION span_routes_integrity_check();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cable_span_routes_integrity
  AFTER INSERT OR UPDATE OF from_site_id, to_site_id ON cable_spans
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION span_routes_integrity_check();
