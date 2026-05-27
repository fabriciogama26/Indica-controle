-- 204_preserve_measurement_work_completion_snapshot.sql
-- Permite que a Medicao preserve qualquer Estado Trabalho normalizado no snapshot,
-- em vez de limitar o valor gravado a CONCLUIDO/PARCIAL.

alter table if exists public.project_measurement_orders
  drop constraint if exists project_measurement_orders_programming_completion_status_snapshot_check;

alter table if exists public.project_measurement_orders
  add constraint project_measurement_orders_programming_completion_status_snapshot_check
  check (
    programming_completion_status_snapshot is null
    or (
      programming_completion_status_snapshot = upper(btrim(programming_completion_status_snapshot))
      and programming_completion_status_snapshot ~ '^[A-Z0-9_]+$'
    )
  );

do $$
declare
  v_signature regprocedure := 'public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz)'::regprocedure;
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef(v_signature::oid)
  into v_definition;

  v_original := v_definition;

  v_definition := replace(
    v_definition,
    $block$    v_programming_completion_status := upper(nullif(btrim(coalesce(v_programming_completion_status, '')), ''));
    if v_programming_completion_status not in ('CONCLUIDO', 'PARCIAL') then
      v_programming_completion_status := null;
    end if;$block$,
    $block$    v_programming_completion_status := upper(nullif(btrim(coalesce(v_programming_completion_status, '')), ''));$block$
  );

  if v_definition = v_original then
    raise exception 'Nao foi possivel atualizar a preservacao do Estado Trabalho no snapshot da Medicao.';
  end if;

  execute v_definition;
end;
$$;
