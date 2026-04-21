-- 160_fix_work_completion_status_sync_priority.sql
-- Corrige sincronismo codigo/UUID de Estado Trabalho para respeitar mudancas por texto
-- (incluindo limpeza) quando o UUID antigo ainda estiver preenchido no registro.

create or replace function public.sync_project_programming_work_completion_status_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_catalog record;
  v_text_changed boolean := tg_op = 'INSERT' or new.work_completion_status is distinct from old.work_completion_status;
  v_id_changed boolean := tg_op = 'INSERT' or new.work_completion_status_id is distinct from old.work_completion_status_id;
begin
  new.work_completion_status := nullif(upper(btrim(coalesce(new.work_completion_status, ''))), '');

  if new.work_completion_status is null and new.work_completion_status_id is null then
    return new;
  end if;

  -- Update explicito por texto: permite trocar PARCIAL -> CONCLUIDO mesmo com UUID antigo.
  if tg_op = 'UPDATE' and v_text_changed and not v_id_changed then
    if new.work_completion_status is null then
      new.work_completion_status_id := null;
      return new;
    end if;

    select c.id, c.code
    into v_catalog
    from public.programming_work_completion_catalog c
    where c.tenant_id = new.tenant_id
      and upper(btrim(c.code)) = upper(btrim(coalesce(new.work_completion_status, '')))
    limit 1;

    if v_catalog.id is null then
      raise exception 'Estado Trabalho (codigo) invalido para o tenant atual.'
        using errcode = '23503';
    end if;

    new.work_completion_status_id := v_catalog.id;
    new.work_completion_status := v_catalog.code;
    return new;
  end if;

  -- Update explicito por UUID: preserva compatibilidade para fluxos que enviam apenas o ID.
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
    limit 1;

    if v_catalog.id is null then
      raise exception 'Estado Trabalho (UUID) invalido para o tenant atual.'
        using errcode = '23503';
    end if;

    new.work_completion_status_id := v_catalog.id;
    new.work_completion_status := v_catalog.code;
    return new;
  end if;

  -- Insert ou update misto: texto informado tem prioridade e recalcula UUID.
  if new.work_completion_status is not null then
    select c.id, c.code
    into v_catalog
    from public.programming_work_completion_catalog c
    where c.tenant_id = new.tenant_id
      and upper(btrim(c.code)) = upper(btrim(coalesce(new.work_completion_status, '')))
    limit 1;

    if v_catalog.id is null then
      raise exception 'Estado Trabalho (codigo) invalido para o tenant atual.'
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
  limit 1;

  if v_catalog.id is null then
    raise exception 'Estado Trabalho (UUID) invalido para o tenant atual.'
      using errcode = '23503';
  end if;

  new.work_completion_status_id := v_catalog.id;
  new.work_completion_status := v_catalog.code;
  return new;
end;
$$;
