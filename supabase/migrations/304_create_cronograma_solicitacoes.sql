-- 304_create_cronograma_solicitacoes.sql
-- Cria a base multi-tenant do Cronograma de Solicitacoes Tecnicas (Inspecao / As Built / Locacao),
-- historico de alteracoes, RLS por tenant, indices, RPC de resolucao de estado da Programacao
-- e o registro/backfill de permissoes da nova pagina.

-- ============================================================
-- Tabela principal
-- ============================================================
create table if not exists public.cronograma_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  projeto_id uuid not null references public.project(id),
  projeto_codigo text not null,
  tipo_solicitacao text not null,
  prioridade text not null,
  data_entrada date not null,
  data_limite date not null,
  data_conclusao date,
  status text not null default 'PENDENTE',
  responsavel_id uuid not null references public.people(id),
  solicitante_id uuid not null references public.app_users(id),
  observacao text,
  justificativa_prioridade text,
  motivo_cancelamento text,
  estado_programacao_snapshot text,
  programacao_id uuid references public.project_programming(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint cronograma_solicitacoes_tipo_check
    check (tipo_solicitacao in ('INSPECAO', 'AS_BUILT', 'LOCACAO')),
  constraint cronograma_solicitacoes_prioridade_check
    check (prioridade in ('BAIXA', 'MEDIA', 'ALTA')),
  constraint cronograma_solicitacoes_status_check
    check (status in ('PENDENTE', 'CONCLUIDO', 'CANCELADO')),
  constraint cronograma_solicitacoes_data_limite_check
    check (data_limite >= data_entrada),
  constraint cronograma_solicitacoes_prioridade_alta_justificativa_check
    check (
      prioridade <> 'ALTA'
      or nullif(btrim(coalesce(justificativa_prioridade, '')), '') is not null
    ),
  constraint cronograma_solicitacoes_conclusao_check
    check (
      (status = 'CONCLUIDO' and data_conclusao is not null)
      or (status <> 'CONCLUIDO' and data_conclusao is null)
    ),
  constraint cronograma_solicitacoes_cancelamento_check
    check (
      status <> 'CANCELADO'
      or nullif(btrim(coalesce(motivo_cancelamento, '')), '') is not null
    ),
  constraint cronograma_solicitacoes_dedupe_key
    unique (tenant_id, projeto_id, data_entrada, tipo_solicitacao)
);

create index if not exists idx_cronograma_solicitacoes_tenant_status
  on public.cronograma_solicitacoes (tenant_id, status);

create index if not exists idx_cronograma_solicitacoes_tenant_data_limite
  on public.cronograma_solicitacoes (tenant_id, data_limite);

create index if not exists idx_cronograma_solicitacoes_tenant_projeto_tipo
  on public.cronograma_solicitacoes (tenant_id, projeto_id, tipo_solicitacao);

create index if not exists idx_cronograma_solicitacoes_tenant_responsavel
  on public.cronograma_solicitacoes (tenant_id, responsavel_id);

alter table if exists public.cronograma_solicitacoes enable row level security;

drop policy if exists cronograma_solicitacoes_tenant_select on public.cronograma_solicitacoes;
create policy cronograma_solicitacoes_tenant_select on public.cronograma_solicitacoes
for select
to authenticated
using (public.user_can_access_tenant(cronograma_solicitacoes.tenant_id));

drop policy if exists cronograma_solicitacoes_tenant_insert on public.cronograma_solicitacoes;
create policy cronograma_solicitacoes_tenant_insert on public.cronograma_solicitacoes
for insert
to authenticated
with check (public.user_can_access_tenant(cronograma_solicitacoes.tenant_id));

drop policy if exists cronograma_solicitacoes_tenant_update on public.cronograma_solicitacoes;
create policy cronograma_solicitacoes_tenant_update on public.cronograma_solicitacoes
for update
to authenticated
using (public.user_can_access_tenant(cronograma_solicitacoes.tenant_id))
with check (public.user_can_access_tenant(cronograma_solicitacoes.tenant_id));

drop trigger if exists trg_cronograma_solicitacoes_audit on public.cronograma_solicitacoes;
create trigger trg_cronograma_solicitacoes_audit before insert or update on public.cronograma_solicitacoes
for each row execute function public.apply_audit_fields();

-- ============================================================
-- Historico de alteracoes
-- ============================================================
create table if not exists public.cronograma_solicitacoes_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  solicitacao_id uuid not null references public.cronograma_solicitacoes(id) on delete cascade,
  change_type text not null,
  changes jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  constraint cronograma_solicitacoes_history_change_type_check
    check (change_type in ('CREATE', 'UPDATE', 'VERIFY', 'CANCEL'))
);

create index if not exists idx_cronograma_solicitacoes_history_tenant_solicitacao
  on public.cronograma_solicitacoes_history (tenant_id, solicitacao_id, created_at desc);

alter table if exists public.cronograma_solicitacoes_history enable row level security;

drop policy if exists cronograma_solicitacoes_history_tenant_select on public.cronograma_solicitacoes_history;
create policy cronograma_solicitacoes_history_tenant_select on public.cronograma_solicitacoes_history
for select
to authenticated
using (public.user_can_access_tenant(cronograma_solicitacoes_history.tenant_id));

drop policy if exists cronograma_solicitacoes_history_tenant_insert on public.cronograma_solicitacoes_history;
create policy cronograma_solicitacoes_history_tenant_insert on public.cronograma_solicitacoes_history
for insert
to authenticated
with check (public.user_can_access_tenant(cronograma_solicitacoes_history.tenant_id));

-- ============================================================
-- RPC: ids de projetos elegiveis para As Built
-- (estado atual da Programacao = ultima linha por projeto)
-- Apenas leitura. Normaliza as grafias legadas de BENEFICIO/BENFICIO.
-- ============================================================
create or replace function public.get_cronograma_asbuilt_project_ids(p_tenant_id uuid)
returns table(project_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (pp.project_id)
      pp.project_id,
      upper(regexp_replace(btrim(coalesce(pp.work_completion_status, '')), '\s+', '_', 'g')) as status_code
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
    order by pp.project_id, pp.execution_date desc, pp.etapa_number desc nulls last, pp.updated_at desc
  )
  select latest.project_id
  from latest
  where replace(latest.status_code, 'BENFICIO', 'BENEFICIO')
    in ('CONCLUIDO', 'CONCLUÍDO', 'PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO');
$$;

-- Chamada exclusivamente pelo backend com o client service-role.
-- Nao deve ser executavel por anon/authenticated (Supabase Advisor 0028/0029).
revoke all on function public.get_cronograma_asbuilt_project_ids(uuid)
from public, anon, authenticated;
grant execute on function public.get_cronograma_asbuilt_project_ids(uuid)
to service_role;

-- ============================================================
-- Registro da pagina e backfill de permissoes
-- ============================================================
insert into public.app_pages (page_key, path, name, section, description)
values
  (
    'cronograma-solicitacoes',
    '/cronograma-solicitacoes',
    'Cronograma de Solicitacoes',
    'Operacao',
    'Cadastro e acompanhamento de solicitacoes tecnicas (Inspecao, As Built, Locacao) com controle de prazo.'
  )
on conflict (page_key) do update
set
  path = excluded.path,
  name = excluded.name,
  section = excluded.section,
  description = excluded.description,
  ativo = true,
  updated_at = now();

insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  tenants.tenant_id,
  roles.id,
  pages.page_key,
  case
    when roles.role_key = 'viewer' then false
    else true
  end as can_access
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) as tenants
join public.app_roles as roles
  on roles.ativo = true
 and roles.role_key in ('master', 'admin', 'supervisor', 'user', 'viewer')
join public.app_pages as pages
  on pages.ativo = true
 and pages.page_key = 'cronograma-solicitacoes'
on conflict (tenant_id, role_id, page_key) do update
set
  can_access = excluded.can_access,
  updated_at = now();

with target_pages as (
  select page_key
  from public.app_pages
  where ativo = true
    and page_key = 'cronograma-solicitacoes'
),
target_users as (
  select
    au.id as user_id,
    au.tenant_id,
    au.role_id,
    coalesce(ar.role_key, 'user') as role_key
  from public.app_users au
  left join public.app_roles ar
    on ar.id = au.role_id
  where au.tenant_id is not null
    and exists (
      select 1
      from public.app_user_page_permissions upp
      where upp.tenant_id = au.tenant_id
        and upp.user_id = au.id
    )
)
insert into public.app_user_page_permissions (
  tenant_id,
  user_id,
  page_key,
  can_access,
  created_by,
  updated_by
)
select
  tu.tenant_id,
  tu.user_id,
  tp.page_key,
  coalesce(
    rpp.can_access,
    case
      when tu.role_key = 'viewer' then false
      else true
    end
  ) as can_access,
  null,
  null
from target_users tu
cross join target_pages tp
left join public.app_user_page_permissions existing
  on existing.tenant_id = tu.tenant_id
 and existing.user_id = tu.user_id
 and existing.page_key = tp.page_key
left join public.role_page_permissions rpp
  on rpp.tenant_id = tu.tenant_id
 and rpp.role_id = tu.role_id
 and rpp.page_key = tp.page_key
where existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;
