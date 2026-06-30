-- 279_harden_completed_group_integrity_transition.sql
-- Evita falso bloqueio ao editar campos operacionais de uma programacao que ja
-- estava tecnicamente CONCLUIDO pelo codigo ou pelo UUID do catalogo.

create or replace function public.sync_project_programming_work_completion_status_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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

  if tg_op = 'UPDATE' and v_text_changed and not v_id_changed then
    if new.work_completion_status is null then
      new.work_completion_status_id := null;
      return new;
    end if;

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

drop trigger if exists trg_project_programming_sync_work_completion_status_fields on public.project_programming;
drop trigger if exists trg_project_programming_sync_work_completion_status on public.project_programming;
create trigger trg_project_programming_sync_work_completion_status
before insert or update of tenant_id, work_completion_status, work_completion_status_id
on public.project_programming
for each row
execute function public.sync_project_programming_work_completion_status_fields();

revoke all on function public.sync_project_programming_work_completion_status_fields() from public, anon, authenticated;
grant execute on function public.sync_project_programming_work_completion_status_fields() to service_role;

create or replace function public.enforce_completed_work_status_group_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_text_status text := public.normalize_programming_work_completion_code(new.work_completion_status);
  v_new_id_status text;
  v_old_text_status text;
  v_old_id_status text;
  v_new_is_completed boolean := false;
  v_old_is_completed boolean := false;
  v_was_same_active_completed_group boolean := false;
begin
  if new.work_completion_status_id is not null then
    select public.normalize_programming_work_completion_code(c.code)
    into v_new_id_status
    from public.programming_work_completion_catalog c
    where c.tenant_id = new.tenant_id
      and c.id = new.work_completion_status_id
    limit 1;
  end if;

  v_new_is_completed := (
    v_new_text_status in ('CONCLUIDO', 'COMPLETO')
    or v_new_text_status like 'CONCLUIDO%'
    or v_new_id_status in ('CONCLUIDO', 'COMPLETO')
    or v_new_id_status like 'CONCLUIDO%'
  );

  if new.status not in ('PROGRAMADA', 'REPROGRAMADA') or not v_new_is_completed then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_text_status := public.normalize_programming_work_completion_code(old.work_completion_status);

    if old.work_completion_status_id is not null then
      select public.normalize_programming_work_completion_code(c.code)
      into v_old_id_status
      from public.programming_work_completion_catalog c
      where c.tenant_id = old.tenant_id
        and c.id = old.work_completion_status_id
      limit 1;
    end if;

    v_old_is_completed := (
      v_old_text_status in ('CONCLUIDO', 'COMPLETO')
      or v_old_text_status like 'CONCLUIDO%'
      or v_old_id_status in ('CONCLUIDO', 'COMPLETO')
      or v_old_id_status like 'CONCLUIDO%'
    );

    v_was_same_active_completed_group := (
      old.status in ('PROGRAMADA', 'REPROGRAMADA')
      and old.programming_group_id is not distinct from new.programming_group_id
      and v_old_is_completed
    );

    if v_was_same_active_completed_group then
      return new;
    end if;
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
