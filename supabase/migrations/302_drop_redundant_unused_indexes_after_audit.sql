-- 302_drop_redundant_unused_indexes_after_audit.sql
-- Remove somente indices `unused_index` confirmados como redundantes.
--
-- Auditoria feita antes desta migration:
-- - Janela de estatisticas: 147 dias desde stats_reset.
-- - Os indices-alvo nao sustentam constraints em pg_constraint.
-- - Existem indices equivalentes/melhores cobrindo as mesmas consultas.

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'app_users_tenant_id_matricula_key'
      and indexdef ilike '%(tenant_id, matricula)%'
  ) then
    raise exception '302: indice unique app_users_tenant_id_matricula_key nao encontrado';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'idx_fk_team_composition_members_team_composition_membe_eb4e3546'
      and indexdef ilike '%(composition_id, tenant_id)%'
  ) then
    raise exception '302: indice composto de team_composition_members nao encontrado';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conindid in (
      to_regclass('public.idx_app_users_tenant_matricula'),
      to_regclass('public.idx_fk_team_composition_members_team_composition_membe_3b95065b')
    )
  ) then
    raise exception '302: algum indice-alvo ainda sustenta constraint';
  end if;
end;
$$;

drop index if exists public.idx_app_users_tenant_matricula;
drop index if exists public.idx_fk_team_composition_members_team_composition_membe_3b95065b;

do $$
begin
  if exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'idx_app_users_tenant_matricula',
        'idx_fk_team_composition_members_team_composition_membe_3b95065b'
      )
  ) then
    raise exception '302: indices redundantes ainda existem apos drop';
  end if;
end;
$$;
