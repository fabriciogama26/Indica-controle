-- 281_fix_completed_group_bypass_canonical_code.sql
--
-- Correcao do Bypass 2 introduzido na migration 280.
--
-- Problema:
--   O Bypass 2 comparava os valores brutos de NEW e OLD no DB:
--     new.work_completion_status is not distinct from old.work_completion_status
--     AND new.work_completion_status_id is not distinct from old.work_completion_status_id
--
--   Isso falha quando a linha tem estado pre-279 inconsistente:
--     old.work_completion_status = 'CONCLUIDO', old.work_completion_status_id = NULL
--
--   O trigger sync (trg_project_programming_sync_work_completion_status) fires no PUT
--   e preenche o UUID: new.work_completion_status_id = <catalog_uuid>.
--   Resultado: new.uuid (<UUID>) != old.uuid (NULL) -> bypass falha -> EXCEPTION.
--
-- Solucao:
--   Substituir a comparacao de valores brutos pela comparacao dos codigos canonicos
--   ja resolvidos pela funcao normalize (v_old_text_status vs v_new_text_status),
--   que sao estabilizados ANTES da verificacao UUID. O sync pode mudar o UUID sem
--   mudar o codigo canonico; a restricao de grupo nao deve ser re-aplicada nesse caso.

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

    -- Bypass 1 (migration 279): mesmo grupo ativo ja estava CONCLUIDO.
    v_was_same_active_completed_group := (
      old.status in ('PROGRAMADA', 'REPROGRAMADA')
      and old.programming_group_id is not distinct from new.programming_group_id
      and v_old_is_completed
    );

    if v_was_same_active_completed_group then
      return new;
    end if;

    -- Bypass 2 (migration 281, corrigido de 280):
    -- Compara o codigo canonico resolvido (texto > UUID), nao os valores brutos.
    -- O trigger sync pode alterar work_completion_status_id de NULL para <UUID>
    -- sem mudar o estado canonico (CONCLUIDO continua CONCLUIDO).
    -- Se o codigo canonico nao mudou e o OLD ja era CONCLUIDO, a restricao de grupo
    -- nao deve ser re-aplicada.
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
    raise exception 'Estado Trabalho CONCLUIDO nao pode ser salvo enquanto houver outra programacao ativa no mesmo grupo operacional.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_completed_work_status_group_integrity() from public, anon, authenticated;
grant execute on function public.enforce_completed_work_status_group_integrity() to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'project_programming'
      and t.tgname = 'zz_trg_project_programming_completed_group_integrity'
      and not t.tgisinternal
  ) then
    raise exception '281: trigger zz_trg_project_programming_completed_group_integrity nao encontrado';
  end if;
end;
$$;
