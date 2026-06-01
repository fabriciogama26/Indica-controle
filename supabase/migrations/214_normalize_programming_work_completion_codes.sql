-- 214_normalize_programming_work_completion_codes.sql
-- Normaliza codigos tecnicos do catalogo de Estado Trabalho e protege o snapshot da Medicao.

create or replace function public.normalize_programming_work_completion_code(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        translate(
          upper(btrim(coalesce(p_value, ''))),
          U&'\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7\00D1',
          'AAAAAEEEEIIIIOOOOOUUUUCN'
        ),
        '[^A-Z0-9]+',
        '_',
        'g'
      ),
      '^_+|_+$',
      '',
      'g'
    ),
    ''
  );
$$;

revoke all on function public.normalize_programming_work_completion_code(text) from public;
grant execute on function public.normalize_programming_work_completion_code(text) to authenticated;
grant execute on function public.normalize_programming_work_completion_code(text) to service_role;

do $$
begin
  if exists (
    select 1
    from public.programming_work_completion_catalog c
    where public.normalize_programming_work_completion_code(c.code) is null
  ) then
    raise exception 'Nao foi possivel normalizar Estado Trabalho: existe codigo vazio apos normalizacao.';
  end if;

  if exists (
    select 1
    from public.programming_work_completion_catalog c
    group by
      c.tenant_id,
      public.normalize_programming_work_completion_code(c.code)
    having count(*) > 1
  ) then
    raise exception 'Nao foi possivel normalizar Estado Trabalho: existem codigos duplicados por tenant apos normalizacao.';
  end if;
end;
$$;

alter table if exists public.project_measurement_orders
  drop constraint if exists project_measurement_orders_programming_completion_status_snapshot_check;

update public.project_measurement_orders
set programming_completion_status_snapshot =
  public.normalize_programming_work_completion_code(programming_completion_status_snapshot)
where programming_completion_status_snapshot is not null
  and programming_completion_status_snapshot is distinct from
    public.normalize_programming_work_completion_code(programming_completion_status_snapshot);

alter table if exists public.project_measurement_orders
  add constraint project_measurement_orders_programming_completion_status_snapshot_check
  check (
    programming_completion_status_snapshot is null
    or (
      programming_completion_status_snapshot = upper(btrim(programming_completion_status_snapshot))
      and programming_completion_status_snapshot ~ '^[A-Z0-9_]+$'
    )
  );

update public.programming_work_completion_catalog
set code = public.normalize_programming_work_completion_code(code)
where code is distinct from public.normalize_programming_work_completion_code(code);

alter table if exists public.programming_work_completion_catalog
  drop constraint if exists programming_work_completion_catalog_code_normalized_check;

alter table if exists public.programming_work_completion_catalog
  add constraint programming_work_completion_catalog_code_normalized_check
  check (
    code = public.normalize_programming_work_completion_code(code)
    and code ~ '^[A-Z0-9_]+$'
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
    $block$    v_programming_completion_status := upper(nullif(btrim(coalesce(v_programming_completion_status, '')), ''));$block$,
    $block$    v_programming_completion_status := public.normalize_programming_work_completion_code(v_programming_completion_status);$block$
  );

  if v_definition = v_original then
    raise exception 'Nao foi possivel proteger a normalizacao do snapshot de Estado Trabalho na Medicao.';
  end if;

  execute v_definition;
end;
$$;
