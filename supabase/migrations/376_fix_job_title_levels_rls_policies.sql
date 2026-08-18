-- 376_fix_job_title_levels_rls_policies.sql
-- Corrige warning multiple_permissive_policies em public.job_title_levels.
--
-- A 371 criou uma policy FOR SELECT e outra FOR ALL para authenticated. Como
-- FOR ALL tambem cobre SELECT, o Postgres avaliava duas policies permissivas
-- na leitura da tabela. A escrita de niveis de cargo passa pela RPC
-- save_job_title_record com service_role, entao a policy direta de escrita nao
-- e necessaria.

begin;

drop policy if exists job_title_levels_tenant_write on public.job_title_levels;

do $$
declare
  v_select_policy_count integer;
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'job_title_levels'
      and policyname = 'job_title_levels_tenant_select'
      and permissive = 'PERMISSIVE'
      and cmd = 'SELECT'
      and 'authenticated' = any(roles)
  ) then
    raise exception '376: policy job_title_levels_tenant_select ausente ou divergente';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'job_title_levels'
      and policyname = 'job_title_levels_tenant_write'
  ) then
    raise exception '376: policy job_title_levels_tenant_write ainda existe';
  end if;

  select count(*)
    into v_select_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'job_title_levels'
    and permissive = 'PERMISSIVE'
    and cmd in ('SELECT', 'ALL')
    and 'authenticated' = any(roles);

  if v_select_policy_count <> 1 then
    raise exception '376: esperado 1 policy permissiva SELECT/ALL para authenticated em job_title_levels, encontrado %', v_select_policy_count;
  end if;
end;
$$;

commit;
