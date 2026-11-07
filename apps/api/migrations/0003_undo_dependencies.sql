-- Custom SQL migration file, put your code below! ---- Объекты, на которые ссылаются возвращаемые отменой строки, но которых сейчас нет
-- и которые эта же отмена не вернёт (например, место удалили позже другой операцией).
CREATE FUNCTION operation_missing_refs(p_op uuid)
RETURNS TABLE (ref_table text, ref_id uuid)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r record;
  c record;
  v text;
  ok boolean;
  restored uuid[];
BEGIN
  restored := ARRAY(SELECT o.row_id FROM operation_rows(p_op) o WHERE o.before IS NOT NULL);
  FOR r IN SELECT * FROM operation_rows(p_op) WHERE before IS NOT NULL LOOP
    FOR c IN
      SELECT con.confrelid::regclass::text AS rt, k.col, k.rcol
      FROM pg_constraint con
      CROSS JOIN LATERAL (
        SELECT a.attname::text AS col, b.attname::text AS rcol
        FROM unnest(con.conkey, con.confkey) AS u(k, fk)
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.k
        JOIN pg_attribute b ON b.attrelid = con.confrelid AND b.attnum = u.fk
        WHERE a.attname <> 'tenant_id'
        LIMIT 1
      ) k
      WHERE con.contype = 'f' AND con.conrelid = r.table_name::regclass AND con.confrelid <> 'tenants'::regclass
    LOOP
      v := r.before ->> c.col;
      CONTINUE WHEN v IS NULL OR v::uuid = ANY(restored);
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', c.rt, c.rcol) INTO ok USING v::uuid;
      IF NOT ok THEN
        ref_table := c.rt;
        ref_id := v::uuid;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END $$;
