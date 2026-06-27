-- 277_normalize_partial_and_completed_work_status.sql
-- Normaliza PARCIAL legado para PARCIAL_NAO_PLANEJADO e fecha o catalogo
-- canonico de Estado Trabalho da Programacao.
-- Tambem impede CONCLUIDO em uma linha ativa quando ainda existe outra
-- programacao ativa no mesmo programming_group_id.

alter table if exists public.programming_work_completion_catalog
  drop constraint if exists programming_work_completion_catalog_code_normalized_check;

create or replace function public.normalize_programming_work_completion_code(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with normalized as (
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
    ) as code
  )
  select case
    when code in ('PARCIAL', 'PARTIAL', 'PARCIAL_NAO_PLANEJADO', 'PARCIAL_NAO_PROGRAMADO') then 'PARCIAL_NAO_PLANEJADO'
    when code in ('PARCIAL_PLANEJADO', 'PARCIAL_PROGRAMADO') then 'PARCIAL_PLANEJADO'
    when code = 'ANTECIPADA' then 'ANTECIPADO'
    else code
  end
  from normalized;
$$;

revoke all on function public.normalize_programming_work_completion_code(text) from public;
grant execute on function public.normalize_programming_work_completion_code(text) to authenticated;
grant execute on function public.normalize_programming_work_completion_code(text) to service_role;

insert into public.programming_work_completion_catalog (
  tenant_id,
  code,
  label_pt,
  is_active,
  sort_order
)
select
  t.id,
  base.code,
  base.label_pt,
  true,
  base.sort_order
from public.tenants t
cross join (
  values
    ('CONCLUIDO', 'Concluido', 10),
    ('PARCIAL_PLANEJADO', 'Parcial planejado', 20),
    ('PARCIAL_NAO_PLANEJADO', 'Parcial nao planejado', 30),
    ('ANTECIPADO', 'Antecipado', 40)
) as base(code, label_pt, sort_order)
on conflict (tenant_id, code) do update
set
  label_pt = excluded.label_pt,
  is_active = true,
  sort_order = excluded.sort_order,
  updated_at = now();

with canonical as (
  select tenant_id, id
  from public.programming_work_completion_catalog
  where code = 'PARCIAL_NAO_PLANEJADO'
),
legacy_rows as (
  select
    pp.*,
    canonical.id as target_work_completion_status_id
  from public.project_programming pp
  join canonical
    on canonical.tenant_id = pp.tenant_id
  where public.normalize_programming_work_completion_code(pp.work_completion_status) = 'PARCIAL_NAO_PLANEJADO'
    and (
      pp.work_completion_status is distinct from 'PARCIAL_NAO_PLANEJADO'
      or pp.work_completion_status_id is distinct from canonical.id
    )
),
updated as (
  update public.project_programming pp
  set
    work_completion_status = 'PARCIAL_NAO_PLANEJADO',
    work_completion_status_id = legacy_rows.target_work_completion_status_id,
    updated_at = now()
  from legacy_rows
  where pp.tenant_id = legacy_rows.tenant_id
    and pp.id = legacy_rows.id
  returning
    legacy_rows.tenant_id,
    legacy_rows.id,
    legacy_rows.project_id,
    legacy_rows.team_id,
    legacy_rows.status,
    legacy_rows.execution_date,
    legacy_rows.start_time,
    legacy_rows.end_time,
    legacy_rows.etapa_number,
    legacy_rows.work_completion_status as previous_work_completion_status,
    legacy_rows.work_completion_status_id as previous_work_completion_status_id,
    legacy_rows.target_work_completion_status_id
)
insert into public.project_programming_history (
  tenant_id,
  programming_id,
  project_id,
  team_id,
  related_programming_id,
  action_type,
  from_status,
  to_status,
  from_execution_date,
  to_execution_date,
  from_team_id,
  to_team_id,
  from_start_time,
  to_start_time,
  from_end_time,
  to_end_time,
  from_etapa_number,
  to_etapa_number,
  reason,
  changes,
  metadata,
  created_by
)
select
  updated.tenant_id,
  updated.id,
  updated.project_id,
  updated.team_id,
  null,
  'UPDATE',
  updated.status,
  updated.status,
  updated.execution_date,
  updated.execution_date,
  updated.team_id,
  updated.team_id,
  updated.start_time,
  updated.start_time,
  updated.end_time,
  updated.end_time,
  updated.etapa_number,
  updated.etapa_number,
  'Normalizacao tecnica de Estado Trabalho legado.',
  jsonb_build_object(
    'workCompletionStatus',
    jsonb_build_object('from', updated.previous_work_completion_status, 'to', 'PARCIAL_NAO_PLANEJADO'),
    'workCompletionStatusId',
    jsonb_build_object('from', updated.previous_work_completion_status_id, 'to', updated.target_work_completion_status_id)
  ),
  jsonb_build_object(
    'source', 'migration',
    'migration', '277_normalize_partial_work_completion_status',
    'action', 'NORMALIZE_WORK_COMPLETION_STATUS',
    'from', updated.previous_work_completion_status,
    'to', 'PARCIAL_NAO_PLANEJADO'
  ),
  null
from updated
where updated.previous_work_completion_status is distinct from 'PARCIAL_NAO_PLANEJADO'
   or updated.previous_work_completion_status_id is distinct from updated.target_work_completion_status_id;

update public.programming_work_completion_catalog
set
  is_active = false,
  label_pt = 'Parcial legado',
  sort_order = greatest(sort_order, 900),
  updated_at = now()
where code = 'PARCIAL';

create or replace function public.sync_project_programming_work_completion_status_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_catalog record;
  v_text_changed boolean;
  v_id_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_text_changed := true;
    v_id_changed := true;
  else
    v_text_changed := new.work_completion_status is distinct from old.work_completion_status;
    v_id_changed := new.work_completion_status_id is distinct from old.work_completion_status_id;
  end if;

  new.work_completion_status := public.normalize_programming_work_completion_code(new.work_completion_status);

  if new.work_completion_status is null and new.work_completion_status_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and v_id_changed and not v_text_changed then
    if new.work_completion_status_id is null then
      new.work_completion_status := null;
      return new;
    end if;

    select c.id, c.code
    into v_catalog
    from public.programming_work_completion_catalog c
    where c.tenant_id = new.tenant_id
      and c.id = new.work_completion_status_id
      and c.is_active = true
    limit 1;

    if v_catalog.id is null then
      raise exception 'Estado Trabalho (UUID) invalido ou inativo para o tenant atual.'
        using errcode = '23503';
    end if;

    new.work_completion_status_id := v_catalog.id;
    new.work_completion_status := v_catalog.code;
    return new;
  end if;

  if new.work_completion_status is not null then
    select c.id, c.code
    into v_catalog
    from public.programming_work_completion_catalog c
    where c.tenant_id = new.tenant_id
      and c.code = new.work_completion_status
      and c.is_active = true
    limit 1;

    if v_catalog.id is null then
      raise exception 'Estado Trabalho (codigo) invalido ou inativo para o tenant atual.'
        using errcode = '23503';
    end if;

    new.work_completion_status_id := v_catalog.id;
    new.work_completion_status := v_catalog.code;
    return new;
  end if;

  select c.id, c.code
  into v_catalog
  from public.programming_work_completion_catalog c
  where c.tenant_id = new.tenant_id
    and c.id = new.work_completion_status_id
    and c.is_active = true
  limit 1;

  if v_catalog.id is null then
    raise exception 'Estado Trabalho (UUID) invalido ou inativo para o tenant atual.'
      using errcode = '23503';
  end if;

  new.work_completion_status_id := v_catalog.id;
  new.work_completion_status := v_catalog.code;
  return new;
end;
$$;

alter table if exists public.programming_work_completion_catalog
  add constraint programming_work_completion_catalog_code_normalized_check
  check (
    (
      code = public.normalize_programming_work_completion_code(code)
      and code ~ '^[A-Z0-9_]+$'
    )
    or (
      code = 'PARCIAL'
      and is_active = false
    )
  );

do $$
declare
  v_invalid_count integer;
  v_invalid_details text;
begin
  select count(*)
  into v_invalid_count
  from public.project_programming pp
  where public.normalize_programming_work_completion_code(pp.work_completion_status) = 'PARCIAL_NAO_PLANEJADO'
    and pp.work_completion_status is distinct from 'PARCIAL_NAO_PLANEJADO';

  if v_invalid_count > 0 then
    select string_agg(format('id=%s tenant_id=%s status=%s work_completion_status=%s', id, tenant_id, status, work_completion_status), '; ')
    into v_invalid_details
    from (
      select id, tenant_id, status, work_completion_status
      from public.project_programming pp
      where public.normalize_programming_work_completion_code(pp.work_completion_status) = 'PARCIAL_NAO_PLANEJADO'
        and pp.work_completion_status is distinct from 'PARCIAL_NAO_PLANEJADO'
      order by updated_at desc nulls last, id
      limit 20
    ) invalid;

    raise exception 'Ainda existem programacoes com PARCIAL legado apos a migration 277. Detalhes: %', coalesce(v_invalid_details, '[sem detalhes]');
  end if;

  if exists (
    select 1
    from public.programming_work_completion_catalog c
    where c.code = 'PARCIAL'
      and c.is_active = true
  ) then
    raise exception 'Catalogo PARCIAL legado ainda esta ativo apos a migration 277.';
  end if;
end;
$$;

revoke all on function public.sync_project_programming_work_completion_status_fields() from public, anon, authenticated;
grant execute on function public.sync_project_programming_work_completion_status_fields() to service_role;

drop trigger if exists trg_project_programming_sync_work_completion_status on public.project_programming;

create or replace function public.sync_programming_work_completion_status_by_project_date()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := coalesce(new.updated_by, old.updated_by, new.created_by, old.created_by);
  v_next_status text := public.normalize_programming_work_completion_code(new.work_completion_status);
  v_row record;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if coalesce(new.status, '') not in ('PROGRAMADA', 'REPROGRAMADA') then
    return new;
  end if;

  if old.work_completion_status is not distinct from new.work_completion_status then
    return new;
  end if;

  if new.programming_group_id is null then
    return new;
  end if;

  if v_next_status in ('CONCLUIDO', 'COMPLETO', 'ANTECIPADO')
    or v_next_status like 'CONCLUIDO%' then
    return new;
  end if;

  for v_row in
    select
      pp.id,
      pp.project_id,
      pp.team_id,
      pp.work_completion_status
    from public.project_programming pp
    where pp.tenant_id = new.tenant_id
      and pp.programming_group_id = new.programming_group_id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.id <> new.id
      and pp.work_completion_status is distinct from new.work_completion_status
    for update
  loop
    update public.project_programming
    set
      work_completion_status = new.work_completion_status,
      updated_by = v_actor_user_id
    where tenant_id = new.tenant_id
      and id = v_row.id;

    perform public.append_project_programming_history_record(
      p_tenant_id => new.tenant_id,
      p_actor_user_id => v_actor_user_id,
      p_programming_id => v_row.id,
      p_project_id => v_row.project_id,
      p_team_id => v_row.team_id,
      p_related_programming_id => new.id,
      p_action_type => 'UPDATE',
      p_reason => null,
      p_changes => jsonb_build_object(
        'workCompletionStatus',
        jsonb_build_object(
          'from', nullif(v_row.work_completion_status, ''),
          'to', nullif(new.work_completion_status, '')
        )
      ),
      p_metadata => jsonb_build_object(
        'source', 'work-completion-group-sync',
        'syncSourceProgrammingId', new.id,
        'programmingGroupId', new.programming_group_id,
        'scope', 'programming_group_id'
      )
    );
  end loop;

  return new;
end;
$$;

create trigger trg_project_programming_sync_work_completion_status
after update of work_completion_status on public.project_programming
for each row
execute function public.sync_programming_work_completion_status_by_project_date();

revoke all on function public.sync_programming_work_completion_status_by_project_date() from public, anon, authenticated;
grant execute on function public.sync_programming_work_completion_status_by_project_date() to service_role;

do $$
declare
  v_invalid_count integer;
  v_invalid_details text;
begin
  select count(*)
  into v_invalid_count
  from public.project_programming completed
  where completed.status in ('PROGRAMADA', 'REPROGRAMADA')
    and (
      public.normalize_programming_work_completion_code(completed.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
      or public.normalize_programming_work_completion_code(completed.work_completion_status) like 'CONCLUIDO%'
    )
    and exists (
      select 1
      from public.project_programming sibling
      where sibling.tenant_id = completed.tenant_id
        and sibling.programming_group_id = completed.programming_group_id
        and sibling.id <> completed.id
        and sibling.status in ('PROGRAMADA', 'REPROGRAMADA')
    );

  if v_invalid_count > 0 then
    select string_agg(format('id=%s tenant_id=%s project_id=%s programming_group_id=%s status=%s execution_date=%s etapa=%s', id, tenant_id, project_id, programming_group_id, status, execution_date, coalesce(etapa_number::text, case when etapa_unica then 'UNICA' when etapa_final then 'FINAL' else 'SEM_ETAPA' end)), '; ')
    into v_invalid_details
    from (
      select completed.*
      from public.project_programming completed
      where completed.status in ('PROGRAMADA', 'REPROGRAMADA')
        and (
          public.normalize_programming_work_completion_code(completed.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
          or public.normalize_programming_work_completion_code(completed.work_completion_status) like 'CONCLUIDO%'
        )
        and exists (
          select 1
          from public.project_programming sibling
          where sibling.tenant_id = completed.tenant_id
            and sibling.programming_group_id = completed.programming_group_id
            and sibling.id <> completed.id
            and sibling.status in ('PROGRAMADA', 'REPROGRAMADA')
        )
      order by completed.updated_at desc nulls last, completed.id
      limit 20
    ) invalid;

    raise exception 'Existem programacoes CONCLUIDO com outras linhas ativas no mesmo grupo operacional. Reabra ou encerre as demais linhas antes da migration 277. Detalhes: %', coalesce(v_invalid_details, '[sem detalhes]');
  end if;
end;
$$;

create or replace function public.enforce_completed_work_status_group_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := public.normalize_programming_work_completion_code(new.work_completion_status);
begin
  if new.status not in ('PROGRAMADA', 'REPROGRAMADA') then
    return new;
  end if;

  if not (
    v_status in ('CONCLUIDO', 'COMPLETO')
    or v_status like 'CONCLUIDO%'
  ) then
    return new;
  end if;

  if exists (
    select 1
    from public.project_programming sibling
    where sibling.tenant_id = new.tenant_id
      and sibling.programming_group_id = new.programming_group_id
      and sibling.id <> new.id
      and sibling.status in ('PROGRAMADA', 'REPROGRAMADA')
  ) then
    raise exception 'Estado Trabalho CONCLUIDO nao pode ser salvo enquanto houver outra programacao ativa no mesmo grupo operacional.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists zz_trg_project_programming_completed_group_integrity on public.project_programming;
create trigger zz_trg_project_programming_completed_group_integrity
before insert or update of status, programming_group_id, work_completion_status, work_completion_status_id
on public.project_programming
for each row
execute function public.enforce_completed_work_status_group_integrity();

revoke all on function public.enforce_completed_work_status_group_integrity() from public, anon, authenticated;
grant execute on function public.enforce_completed_work_status_group_integrity() to service_role;
