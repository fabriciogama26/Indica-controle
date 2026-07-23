-- 328_register_programming_granular_pages.sql
-- Achados 6 e 10: cria as permissoes granulares da Programacao Normalizada,
-- seguindo o padrao de permissao por operacao do CLAUDE.md (page_key propria,
-- checada DENTRO da operacao; as demais operacoes seguem sob a permissao da
-- tela `programacao-normalizada`).
--
--   programacao-concluir       -> Concluir, Reabrir e sair de CONCLUIDO
--                                 (encerram/reabrem o projeto e disparam a
--                                 antecipacao em cascata).
--   programacao-pendencia      -> marcar/desmarcar is_pendencia e criar etapa
--                                 com pendencia (fura a trava de concluido).
--   programacao-corrigir-data  -> corrigir a data da etapa (inclusive para
--                                 tras), mantendo o mesmo id.
--
-- app_pages.path tem UNIQUE: cada permissao granular usa um path VIRTUAL proprio
-- (nao e rota navegavel), mesmo padrao do saida-requisicao (migration 297).
--
-- Todas nascem bloqueadas (default_user_access = false); admin liberado no
-- backfill, mesmo padrao da migration 312.

insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values
  (
    'programacao-concluir',
    '/programacao-concluir',
    'Programacao — Concluir/Reabrir',
    'Operacao',
    'Permite concluir, reabrir e sair de CONCLUIDO na Programacao Normalizada (encerra/reabre o projeto e antecipa etapas).',
    false
  ),
  (
    'programacao-pendencia',
    '/programacao-pendencia',
    'Programacao — Pendencia',
    'Operacao',
    'Permite marcar/desmarcar a flag de Pendencia e criar etapa de pendencia (excecao da trava de projeto concluido).',
    false
  ),
  (
    'programacao-corrigir-data',
    '/programacao-corrigir-data',
    'Programacao — Corrigir data',
    'Operacao',
    'Permite corrigir a data de execucao da etapa (inclusive para tras), mantendo o mesmo registro. Remarcar continua sendo pelo Adiar.',
    false
  )
on conflict (page_key) do update
set
  path = excluded.path,
  name = excluded.name,
  section = excluded.section,
  description = excluded.description,
  default_user_access = false,
  ativo = true,
  updated_at = now();

-- Backfill de permissoes por role (admin liberado, demais bloqueados).
insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  users.tenant_id,
  roles.id,
  pages.page_key,
  coalesce(roles.is_admin, false)
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) users
cross join (
  values ('programacao-concluir'), ('programacao-pendencia'), ('programacao-corrigir-data')
) as pages(page_key)
join public.app_roles roles
  on roles.ativo = true
left join public.role_page_permissions existing
  on existing.tenant_id = users.tenant_id
 and existing.role_id = roles.id
 and existing.page_key = pages.page_key
where existing.role_id is null
on conflict (tenant_id, role_id, page_key) do nothing;

-- Backfill de permissoes por usuario (admin liberado, demais bloqueados).
insert into public.app_user_page_permissions (
  tenant_id,
  user_id,
  page_key,
  can_access,
  created_by,
  updated_by
)
select
  users.tenant_id,
  users.id,
  pages.page_key,
  coalesce(roles.is_admin, false),
  null,
  null
from public.app_users users
cross join (
  values ('programacao-concluir'), ('programacao-pendencia'), ('programacao-corrigir-data')
) as pages(page_key)
left join public.app_roles roles
  on roles.id = users.role_id
 and roles.ativo = true
left join public.app_user_page_permissions existing
  on existing.tenant_id = users.tenant_id
 and existing.user_id = users.id
 and existing.page_key = pages.page_key
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;
