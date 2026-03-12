-- 046_add_tenant_fk_to_all_tenant_tables.sql
-- Garante FK de tenant_id -> tenants(id) em todas as tabelas de negocio com tenant_id.

do $$
declare
  v_table record;
  v_constraint_name text;
begin
  -- 1) Backfill de tenants com qualquer tenant_id existente em tabelas publicas.
  for v_table in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and t.table_type = 'BASE TABLE'
      and c.table_name <> 'tenants'
    group by c.table_name
    order by c.table_name
  loop
    execute format(
      'insert into public.tenants (id, name)
       select distinct x.tenant_id, x.tenant_id::text
       from public.%I x
       where x.tenant_id is not null
       on conflict (id) do nothing',
      v_table.table_name
    );
  end loop;

  -- 2) FK em todas as tabelas que ainda nao apontam tenant_id para tenants(id).
  for v_table in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and t.table_type = 'BASE TABLE'
      and c.table_name <> 'tenants'
      and not exists (
        select 1
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_schema = kcu.constraint_schema
         and tc.constraint_name = kcu.constraint_name
         and tc.table_schema = kcu.table_schema
         and tc.table_name = kcu.table_name
        join information_schema.referential_constraints rc
          on rc.constraint_schema = tc.constraint_schema
         and rc.constraint_name = tc.constraint_name
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_schema = rc.unique_constraint_schema
         and ccu.constraint_name = rc.unique_constraint_name
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_schema = 'public'
          and tc.table_name = c.table_name
          and kcu.column_name = 'tenant_id'
          and ccu.table_schema = 'public'
          and ccu.table_name = 'tenants'
          and ccu.column_name = 'id'
      )
    group by c.table_name
    order by c.table_name
  loop
    v_constraint_name := format(
      '%s_tenant_id_fk_%s',
      left(v_table.table_name, 44),
      substr(md5(v_table.table_name), 1, 8)
    );

    execute format(
      'alter table public.%I
       add constraint %I
       foreign key (tenant_id) references public.tenants(id)',
      v_table.table_name,
      v_constraint_name
    );
  end loop;
end;
$$;
