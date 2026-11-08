ALTER TABLE "tenants" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "point_limit" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "user_limit" integer;--> statement-breakpoint

-- ============================================================ тарифы и лимиты
-- Уже существующие операторы (в том числе на своих серверах) — без ограничений:
-- обновление не должно остановить их работу. Бесплатный тариф — у новых операторов.
UPDATE tenants SET plan = 'unlimited';
ALTER TABLE tenants ADD CONSTRAINT tenants_plan_ck CHECK (plan IN ('free', 'unlimited'));
--> statement-breakpoint

-- Лимиты тарифа: свой лимит оператора важнее лимита тарифа; NULL — без ограничений.
-- Бесплатный тариф: 200 точек учёта (муфты, ящики, кроссы, OLT, ONU; сплиттеры не считаются), 3 пользователя.
CREATE FUNCTION tenant_point_limit(p_tenant uuid) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT coalesce(point_limit, CASE plan WHEN 'free' THEN 200 END) FROM tenants WHERE id = p_tenant
$$;
CREATE FUNCTION tenant_user_limit(p_tenant uuid) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT coalesce(user_limit, CASE plan WHEN 'free' THEN 3 END) FROM tenants WHERE id = p_tenant
$$;
--> statement-breakpoint

CREATE FUNCTION equipment_point_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lim integer := tenant_point_limit(NEW.tenant_id);
  n integer;
BEGIN
  IF lim IS NULL THEN RETURN NEW; END IF;
  -- Параллельные добавления одного оператора — по очереди, чтобы не проскочить лимит.
  PERFORM pg_advisory_xact_lock(hashtext('points:' || NEW.tenant_id::text));
  SELECT count(*) INTO n FROM equipment WHERE tenant_id = NEW.tenant_id AND kind <> 'splitter';
  IF n >= lim THEN
    RAISE EXCEPTION 'Достигнут лимит тарифа: % точек учёта (муфты, ящики, кроссы, OLT, ONU). Удалите ненужные или перейдите на тариф без ограничений.', lim
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- Восстановление из корзины лимит не проверяет: вернуть удалённое можно всегда.
CREATE TRIGGER point_limit BEFORE INSERT ON equipment
  FOR EACH ROW WHEN (NEW.kind <> 'splitter' AND coalesce(current_setting('app.restoring', true), '') <> 'on')
  EXECUTE FUNCTION equipment_point_limit();
