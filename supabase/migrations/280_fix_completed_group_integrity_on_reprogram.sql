-- 280_fix_completed_group_integrity_on_reprogram.sql
--
-- Problema (descoberto apos 279):
--   Ao REPROGRAMAR um registro com work_completion_status = 'CONCLUIDO' para uma nova
--   data, o trigger trg_project_programming_assign_group_id (migration 273) recalcula
--   programming_group_id para o grupo da nova data ANTES do trigger de integridade
--   (zz_trg_project_programming_completed_group_integrity) ser avaliado.
--
--   O trigger de integridade dispara porque 'status' esta no SET da atualizacao base.
--   Ao detectar CONCLUIDO com old.group != new.group, o bypass da migration 279
--   (v_was_same_active_completed_group) nao se aplica, e o novo grupo pode ter irmaos
--   ativos, levantando a excecao incorretamente.
--
--   Cenario concreto:
--     1. Registro A: work_completion_status = 'CONCLUIDO', group = G_OLD
--     2. REPROGRAMAR para nova data: trigger recalcula group = G_NEW
--     3. Integridade: new_is_completed = TRUE, G_OLD != G_NEW -> sem bypass
--     4. G_NEW tem irmaos ativos -> EXCEPTION (falso positivo)
--
-- Solucao:
--   Adicionar bypass quando work_completion_status E work_completion_status_id
--   nao mudaram em relacao ao OLD (CONCLUIDO foi HERDADO, nao explicitamente
--   definido nesta atualizacao). Neste caso, a restricao ja foi aplicada quando
--   CONCLUIDO foi originalmente salvo.

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

    -- Bypass 1 (migration 279): mesmo grupo ativo ja estava CONCLUIDO.
    v_was_same_active_completed_group := (
      old.status in ('PROGRAMADA', 'REPROGRAMADA')
      and old.programming_group_id is not distinct from new.programming_group_id
      and v_old_is_completed
    );

    if v_was_same_active_completed_group then
      return new;
    end if;

    -- Bypass 2 (migration 280): work_completion_status nao mudou (texto nem UUID).
    -- Ocorre quando REPROGRAMAR muda a data e o grupo e recalculado pelo trigger
    -- trg_project_programming_assign_group_id, mas o CONCLUIDO foi herdado do OLD.
    -- A restricao ja foi aplicada quando CONCLUIDO foi originalmente definido.
    if v_old_is_completed
      and new.work_completion_status is not distinct from old.work_completion_status
      and new.work_completion_status_id is not distinct from old.work_completion_status_id then
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

revoke all on function public.enforce_completed_work_status_group_integrity() from public, anon, authenticated;
grant execute on function public.enforce_completed_work_status_group_integrity() to service_role;

-- Validacao: trigger deve existir apontando para a funcao atualizada
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
    raise exception '280: trigger zz_trg_project_programming_completed_group_integrity nao encontrado em project_programming';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'enforce_completed_work_status_group_integrity'
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  ) then
    raise exception '280: enforce_completed_work_status_group_integrity sem search_path fixo';
  end if;
end;
$$;
