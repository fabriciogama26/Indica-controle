-- 045_create_tenants_and_user_tenant_access.sql
-- Formaliza tenant como entidade e permite vinculo de usuario a multiplos tenants (contratos).

create table if not exists public.tenants (
  id uuid primary key,
  name text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id)
);

create index if not exists idx_tenants_ativo_name
  on public.tenants (ativo, name);

insert into public.tenants (id, name)
select distinct src.tenant_id, src.tenant_id::text
from (
  select au.tenant_id
  from public.app_users au
  where au.tenant_id is not null
  union
  select c.tenant_id
  from public.contract c
  where c.tenant_id is not null
) src
on conflict (id) do nothing;

update public.tenants t
set name = c.name,
    updated_at = now()
from public.contract c
where c.tenant_id = t.id
  and c.ativo = true
  and nullif(btrim(coalesce(c.name, '')), '') is not null;

create table if not exists public.app_user_tenants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  is_default boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (user_id, tenant_id)
);

create unique index if not exists ux_app_user_tenants_default
  on public.app_user_tenants (user_id)
  where is_default = true and ativo = true;

create index if not exists idx_app_user_tenants_user_ativo
  on public.app_user_tenants (user_id, ativo);

create index if not exists idx_app_user_tenants_tenant_ativo
  on public.app_user_tenants (tenant_id, ativo);

insert into public.app_user_tenants (user_id, tenant_id, is_default, ativo)
select
  au.id,
  au.tenant_id,
  true,
  au.ativo
from public.app_users au
where au.tenant_id is not null
on conflict (user_id, tenant_id) do update
set
  is_default = excluded.is_default,
  ativo = excluded.ativo,
  updated_at = now();

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'app_users'
  ) and not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'app_users'
      and tc.constraint_name = 'app_users_tenant_id_fk'
  ) then
    alter table public.app_users
      add constraint app_users_tenant_id_fk
      foreign key (tenant_id) references public.tenants(id);
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'contract'
  ) and not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'contract'
      and tc.constraint_name = 'contract_tenant_id_fk'
  ) then
    alter table public.contract
      add constraint contract_tenant_id_fk
      foreign key (tenant_id) references public.tenants(id);
  end if;
end;
$$;

alter table if exists public.tenants enable row level security;

drop policy if exists tenants_tenant_select on public.tenants;
create policy tenants_tenant_select on public.tenants
for select
to authenticated
using (public.user_can_access_tenant(tenants.id));

alter table if exists public.app_user_tenants enable row level security;

drop policy if exists app_user_tenants_self_select on public.app_user_tenants;
create policy app_user_tenants_self_select on public.app_user_tenants
for select
to authenticated
using (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.id = app_user_tenants.user_id
      and au.ativo = true
  )
);

drop trigger if exists trg_tenants_audit on public.tenants;
create trigger trg_tenants_audit before insert or update on public.tenants
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_app_user_tenants_audit on public.app_user_tenants;
create trigger trg_app_user_tenants_audit before insert or update on public.app_user_tenants
for each row execute function public.apply_audit_fields();

create or replace function public.user_can_access_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.ativo = true
      and (
        exists (
          select 1
          from public.app_user_tenants aut
          where aut.user_id = au.id
            and aut.tenant_id = p_tenant_id
            and aut.ativo = true
        )
        or au.tenant_id = p_tenant_id
      )
  )
$$;

comment on function public.user_can_access_tenant(uuid) is
'Retorna true quando auth.uid() ativo possui vinculo com o tenant informado em app_user_tenants (fallback para app_users.tenant_id).';
