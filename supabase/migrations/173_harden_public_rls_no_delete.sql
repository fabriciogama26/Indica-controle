-- 173_harden_public_rls_no_delete.sql
-- Endurece RLS publica: liga RLS nas tabelas public e remove policies ALL/DELETE.

drop table if exists pg_temp.rls_all_policies_before_hardening;

create temporary table rls_all_policies_before_hardening on commit drop as
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and cmd = 'ALL';

do $$
declare
  v_table record;
begin
  for v_table in
    select
      n.nspname as schema_name,
      c.relname as table_name
    from pg_class c
    join pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table %I.%I enable row level security', v_table.schema_name, v_table.table_name);
  end loop;
end;
$$;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select
      schemaname,
      tablename,
      policyname
    from pg_policies
    where schemaname = 'public'
      and cmd in ('ALL', 'DELETE')
  loop
    execute format('drop policy if exists %I on %I.%I', v_policy.policyname, v_policy.schemaname, v_policy.tablename);
  end loop;
end;
$$;

do $$
declare
  v_policy record;
  v_roles text;
  v_policy_name text;
  v_using_expression text;
  v_check_expression text;
begin
  for v_policy in
    select *
    from pg_temp.rls_all_policies_before_hardening
  loop
    if to_regclass(format('%I.%I', v_policy.schemaname, v_policy.tablename)) is null then
      continue;
    end if;

    select string_agg(quote_ident(role_name::text), ', ')
    into v_roles
    from unnest(v_policy.roles) as role_name;

    v_roles := coalesce(nullif(v_roles, ''), 'public');
    v_using_expression := coalesce(nullif(v_policy.qual, ''), 'true');
    v_check_expression := coalesce(nullif(v_policy.with_check, ''), v_using_expression, 'true');

    v_policy_name := left(format('harden_%s_select', v_policy.policyname), 54)
      || '_'
      || substr(md5(v_policy.schemaname || '.' || v_policy.tablename || '.' || v_policy.policyname || '.select'), 1, 8);
    execute format('drop policy if exists %I on %I.%I', v_policy_name, v_policy.schemaname, v_policy.tablename);
    execute format(
      'create policy %I on %I.%I as %s for select to %s using (%s)',
      v_policy_name,
      v_policy.schemaname,
      v_policy.tablename,
      v_policy.permissive,
      v_roles,
      v_using_expression
    );

    v_policy_name := left(format('harden_%s_insert', v_policy.policyname), 54)
      || '_'
      || substr(md5(v_policy.schemaname || '.' || v_policy.tablename || '.' || v_policy.policyname || '.insert'), 1, 8);
    execute format('drop policy if exists %I on %I.%I', v_policy_name, v_policy.schemaname, v_policy.tablename);
    execute format(
      'create policy %I on %I.%I as %s for insert to %s with check (%s)',
      v_policy_name,
      v_policy.schemaname,
      v_policy.tablename,
      v_policy.permissive,
      v_roles,
      v_check_expression
    );

    v_policy_name := left(format('harden_%s_update', v_policy.policyname), 54)
      || '_'
      || substr(md5(v_policy.schemaname || '.' || v_policy.tablename || '.' || v_policy.policyname || '.update'), 1, 8);
    execute format('drop policy if exists %I on %I.%I', v_policy_name, v_policy.schemaname, v_policy.tablename);
    execute format(
      'create policy %I on %I.%I as %s for update to %s using (%s) with check (%s)',
      v_policy_name,
      v_policy.schemaname,
      v_policy.tablename,
      v_policy.permissive,
      v_roles,
      v_using_expression,
      v_check_expression
    );
  end loop;
end;
$$;

do $$
declare
  v_violations text;
begin
  select string_agg(format('%I.%I:%I:%s', schemaname, tablename, policyname, cmd), ', ' order by tablename, policyname)
  into v_violations
  from pg_policies
  where schemaname = 'public'
    and cmd in ('ALL', 'DELETE');

  if v_violations is not null then
    raise exception 'RLS hardening failed. Policies ALL/DELETE remaining: %', v_violations;
  end if;
end;
$$;

do $$
declare
  v_violations text;
begin
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ' order by c.relname)
  into v_violations
  from pg_class c
  join pg_namespace n
    on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relrowsecurity = false;

  if v_violations is not null then
    raise exception 'RLS hardening failed. Public tables without RLS: %', v_violations;
  end if;
end;
$$;
