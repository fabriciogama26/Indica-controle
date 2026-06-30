-- debug-trigger-capture-281.sql
-- TEMPORARIO - substitui a mensagem de excecao por dados de diagnostico.
-- Aplique, reproduza o erro, leia a mensagem, depois restaure a 281 original.
-- NAO manter em producao.

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
  v_new_canonical text;
  v_old_canonical text;
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

    if v_old_is_completed then
      v_old_canonical := coalesce(v_old_text_status, v_old_id_status);
      v_new_canonical := coalesce(v_new_text_status, v_new_id_status);

      if v_old_canonical is not distinct from v_new_canonical then
        return new;
      end if;
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
    -- DIAGNOSTICO: substitui a mensagem normal pelo estado exato do trigger.
    raise exception
      'CONCLUIDO_DEBUG id=% status=% new_wcs=[%] new_wcs_id=[%] old_wcs=[%] old_wcs_id=[%] old_group=[%] new_group=[%] v_old_completed=% v_old_canonical=[%] v_new_canonical=[%] tg_op=%',
      new.id,
      new.status,
      coalesce(new.work_completion_status, 'NULL'),
      coalesce(new.work_completion_status_id::text, 'NULL'),
      coalesce(old.work_completion_status, 'NULL'),
      coalesce(old.work_completion_status_id::text, 'NULL'),
      coalesce(old.programming_group_id::text, 'NULL'),
      coalesce(new.programming_group_id::text, 'NULL'),
      v_old_is_completed,
      coalesce(v_old_canonical, 'NULL'),
      coalesce(v_new_canonical, 'NULL'),
      tg_op
      using errcode = '23514';
  end if;

  return new;
end;
$$;
