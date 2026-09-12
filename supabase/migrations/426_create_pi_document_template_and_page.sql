-- 426_create_pi_document_template_and_page.sql
-- Primeira migration do modulo `Permissao de Intervencao` (PI): o REGISTRO das
-- versoes do template Word e a tela em `app_pages`.
--
-- ESCOPO DELIBERADO: SO O TEMPLATE
-- ---------------------------------------------------------------------------
-- A entidade `permission_intervention` NAO nasce aqui. Esta migration cobre
-- apenas o que nao depende dela: o bucket, o cadastro de versoes do template e
-- a permissao da tela. O documento so pode ser gerado a partir de uma PI real,
-- e isso entra na Fase 1 do modulo, com migration propria.
--
-- POR QUE O CAMINHO NO STORAGE NAO CARREGA A VERSAO
-- ---------------------------------------------------------------------------
-- O plano inicial usava `{tenant_id}/v{version}/template.docx`. Isso cria um
-- ovo-e-galinha: para montar o caminho seria preciso saber a versao ANTES de
-- gravar o arquivo, e a versao so pode ser atribuida com seguranca dentro da
-- transacao que insere a linha (dois uploads simultaneos do mesmo tenant
-- receberiam o mesmo numero). O caminho passou a ser
-- `{tenant_id}/{template_id}.docx`, com o UUID gerado no servidor e usado
-- tanto como nome do objeto quanto como PK da linha. A versao continua
-- existindo, atribuida atomicamente aqui dentro, e aparece na tela — nao no
-- nome do arquivo.
--
-- ISOLAMENTO DO BUCKET
-- ---------------------------------------------------------------------------
-- `pi-templates` e privado e nasce SEM NENHUMA policy em `storage.objects`.
-- Isso e intencional e nao esquecimento: com RLS ativa e zero policy,
-- `anon`/`authenticated` nao alcancam nenhum objeto do bucket, e so o
-- `service_role` (que ignora RLS) le. Toda leitura passa por Route Handler que
-- ja resolveu sessao, tenant e permissao. Conferido contra o projeto antes
-- desta migration: `anon` lista 0 itens, `anon` nao baixa e a URL publica
-- direta responde 400.
--
-- O primeiro segmento do caminho e o `tenant_id`, mas a barreira de tenant NAO
-- e o caminho: e a linha de `pi_document_template`, que carrega `tenant_id` e
-- e lida sob RLS. O caminho nunca chega do cliente — o servidor o deriva.

-- =============================================================================
-- 1) Bucket `pi-templates`
-- =============================================================================
-- Idempotente de proposito: o bucket ja foi criado pelo Dashboard no projeto em
-- uso (privado, teto de 10 MB, MIME restrito ao .docx). Esta declaracao existe
-- para que `db reset`, branch de preview ou projeto novo reproduzam o mesmo
-- bucket (regra 26 do guia_sql). `on conflict do nothing` garante que ela nunca
-- sobrescreve a configuracao de um bucket existente.
--
-- `file_size_limit` e `allowed_mime_types` sao colunas que nem toda versao do
-- Storage possui; por isso o insert e montado dinamicamente com as colunas que
-- de fato existirem.
do $$
declare
  v_columns text := 'id, name, public';
  v_values text := format('%L, %L, false', 'pi-templates', 'pi-templates');
begin
  if to_regclass('storage.buckets') is null then
    raise notice '426: schema storage indisponivel; bucket pi-templates nao declarado nesta base.';
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    v_columns := v_columns || ', file_size_limit';
    v_values := v_values || ', 10485760';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    v_columns := v_columns || ', allowed_mime_types';
    v_values := v_values
      || ', array['
      || quote_literal('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      || ']::text[]';
  end if;

  execute format(
    'insert into storage.buckets (%s) values (%s) on conflict (id) do nothing',
    v_columns,
    v_values
  );
end;
$$;

-- =============================================================================
-- 2) Tabela `pi_document_template`
-- =============================================================================
create table if not exists public.pi_document_template (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version integer not null,
  storage_path text not null,
  original_filename text not null,
  -- SHA-256 do arquivo exato que foi gravado. O historico de emissao aponta
  -- para o byte usado, nao so para o numero da versao: template trocado no
  -- bucket por fora do sistema fica detectavel.
  checksum_sha256 text not null,
  -- Relatorio de tags apurado na ativacao: obrigatorias ausentes, desconhecidas
  -- e presentes. Guardado para a tela explicar POR QUE uma versao foi recusada.
  tag_report jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),

  constraint pi_document_template_id_tenant_key unique (id, tenant_id),
  constraint pi_document_template_tenant_version_key unique (tenant_id, version),
  constraint pi_document_template_tenant_path_key unique (tenant_id, storage_path),
  constraint pi_document_template_version_positive_check check (version > 0),
  constraint pi_document_template_storage_path_not_blank_check
    check (nullif(btrim(storage_path), '') is not null),
  constraint pi_document_template_original_filename_not_blank_check
    check (nullif(btrim(original_filename), '') is not null),
  constraint pi_document_template_checksum_format_check
    check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pi_document_template_tag_report_object_check
    check (jsonb_typeof(tag_report) = 'object')
);

-- Um unico template ativo por tenant. Indice PARCIAL porque as versoes
-- inativas convivem: elas sao o historico, e voltar para uma versao anterior e
-- so reativa-la.
create unique index if not exists pi_document_template_active_per_tenant
  on public.pi_document_template (tenant_id)
  where is_active = true;

-- Leitura da tela: versoes do tenant, mais recente primeiro.
create index if not exists idx_pi_document_template_tenant_version
  on public.pi_document_template (tenant_id, version desc);

comment on table public.pi_document_template is
  'Versoes do template .docx da Permissao de Intervencao, por tenant. O arquivo vive no bucket privado pi-templates; esta tabela e a dona do vinculo com o tenant e de qual versao esta ativa.';

alter table if exists public.pi_document_template enable row level security;

-- Somente SELECT para `authenticated`, no padrao fixado pela 393 e repetido
-- pela 424: escrita passa por Route Handler com `service_role` chamando RPC,
-- nunca pelo JWT do usuario.
drop policy if exists pi_document_template_tenant_select on public.pi_document_template;
create policy pi_document_template_tenant_select on public.pi_document_template
for select
to authenticated
using (public.user_can_access_tenant(pi_document_template.tenant_id));

revoke insert, update, delete on public.pi_document_template from public, anon, authenticated;

drop trigger if exists trg_pi_document_template_audit on public.pi_document_template;
create trigger trg_pi_document_template_audit
before insert or update on public.pi_document_template
for each row execute function public.apply_audit_fields();

-- =============================================================================
-- 3) RPC de registro de versao
-- =============================================================================
-- O arquivo JA foi gravado no Storage quando esta funcao roda, e o `id` da
-- linha e o mesmo UUID usado como nome do objeto. Se o registro falhar, a rota
-- remove o objeto orfao — a ordem inversa (registrar e depois subir) deixaria
-- uma versao apontando para arquivo inexistente, que e o pior dos dois erros.
create or replace function public.register_pi_document_template(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_template_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_checksum_sha256 text,
  p_tag_report jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer;
  v_updated_at timestamptz;
  v_storage_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_original_filename text := nullif(btrim(coalesce(p_original_filename, '')), '');
  v_checksum text := lower(nullif(btrim(coalesce(p_checksum_sha256, '')), ''));
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para registrar o template.'
    );
  end if;

  if p_template_id is null or v_storage_path is null or v_original_filename is null or v_checksum is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Dados incompletos para registrar a versao do template.'
    );
  end if;

  if v_checksum !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_CHECKSUM',
      'message', 'Checksum do arquivo invalido.'
    );
  end if;

  -- Serializa a atribuicao de versao dentro do tenant. `max(version) + 1` sem
  -- lock nao e seguro: `SELECT` nao bloqueia linha que ainda nao existe, entao
  -- dois uploads simultaneos calculariam o mesmo numero e o segundo esbarraria
  -- na unique — erro cru no lugar de uma fila ordenada.
  perform pg_advisory_xact_lock(hashtextextended('pi_document_template:' || p_tenant_id::text, 0));

  select coalesce(max(version), 0) + 1
  into v_version
  from public.pi_document_template
  where tenant_id = p_tenant_id;

  insert into public.pi_document_template (
    id,
    tenant_id,
    version,
    storage_path,
    original_filename,
    checksum_sha256,
    tag_report,
    is_active,
    created_by,
    updated_by
  )
  values (
    p_template_id,
    p_tenant_id,
    v_version,
    v_storage_path,
    v_original_filename,
    v_checksum,
    coalesce(p_tag_report, '{}'::jsonb),
    false,
    p_actor_user_id,
    p_actor_user_id
  )
  returning updated_at into v_updated_at;

  insert into public.app_entity_history (
    tenant_id, module_key, entity_table, entity_id, entity_code,
    change_type, reason, changes, metadata, created_by, updated_by
  )
  values (
    p_tenant_id,
    'permissao-intervencao',
    'pi_document_template',
    p_template_id,
    format('v%s', v_version),
    'UPDATE',
    null,
    jsonb_build_object(
      'version', jsonb_build_object('from', null, 'to', v_version::text),
      'originalFilename', jsonb_build_object('from', null, 'to', v_original_filename)
    ),
    jsonb_build_object('checksumSha256', v_checksum, 'storagePath', v_storage_path),
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'template_id', p_template_id,
    'version', v_version,
    'updated_at', v_updated_at,
    'message', format('Versao %s do template registrada. Ative-a para passar a valer.', v_version)
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_TEMPLATE',
      'message', 'Ja existe uma versao registrada com esse identificador ou caminho.'
    );
end;
$$;

revoke all on function public.register_pi_document_template(uuid, uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.register_pi_document_template(uuid, uuid, uuid, text, text, text, jsonb)
  to service_role;

-- =============================================================================
-- 4) RPC de ativacao de versao
-- =============================================================================
-- Desativar a atual e ativar a nova acontece numa transacao so. O indice
-- parcial `pi_document_template_active_per_tenant` nao permite estado
-- intermediario com duas ativas, e um erro no meio desfaz tudo — nunca deixa o
-- tenant sem template ativo por falha parcial.
create or replace function public.activate_pi_document_template(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_template_id uuid,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.pi_document_template%rowtype;
  v_previous_version integer;
  v_updated_at timestamptz;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_template_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant, usuario e versao sao obrigatorios para ativar o template.'
    );
  end if;

  select *
  into v_target
  from public.pi_document_template
  where tenant_id = p_tenant_id
    and id = p_template_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEMPLATE_NOT_FOUND',
      'message', 'Versao de template nao encontrada neste tenant.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de ativar a versao.'
    );
  end if;

  if v_target.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A versao %s foi alterada por outro usuario. Recarregue a lista antes de ativar.', v_target.version)
    );
  end if;

  if v_target.is_active then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'ALREADY_ACTIVE',
      'message', format('A versao %s ja esta ativa.', v_target.version)
    );
  end if;

  -- Recusa ativar template que nao passou na conferencia de tags. A checagem
  -- vive no servidor e o resultado dela esta gravado aqui; sem esta guarda, uma
  -- chamada direta a RPC poderia por em producao um template incompleto.
  -- `jsonb_array_length` lanca excecao quando o valor nao e array, e `->` sobre
  -- uma chave ausente devolve SQL NULL enquanto uma chave gravada como `null`
  -- devolve `'null'::jsonb`. Os dois casos precisam virar zero, nao erro.
  if coalesce(
       case when jsonb_typeof(v_target.tag_report -> 'missingRequired') = 'array'
            then jsonb_array_length(v_target.tag_report -> 'missingRequired') end, 0) > 0
     or coalesce(
       case when jsonb_typeof(v_target.tag_report -> 'unknown') = 'array'
            then jsonb_array_length(v_target.tag_report -> 'unknown') end, 0) > 0 then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'TEMPLATE_TAGS_INVALID',
      'message', 'Esta versao tem tag obrigatoria faltando ou tag desconhecida e nao pode ser ativada.',
      'tag_report', v_target.tag_report
    );
  end if;

  select version
  into v_previous_version
  from public.pi_document_template
  where tenant_id = p_tenant_id
    and is_active = true
  limit 1;

  update public.pi_document_template
  set is_active = false,
      updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and is_active = true;

  update public.pi_document_template
  set is_active = true,
      updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_template_id
  returning updated_at into v_updated_at;

  insert into public.app_entity_history (
    tenant_id, module_key, entity_table, entity_id, entity_code,
    change_type, reason, changes, metadata, created_by, updated_by
  )
  values (
    p_tenant_id,
    'permissao-intervencao',
    'pi_document_template',
    p_template_id,
    format('v%s', v_target.version),
    'ACTIVATE',
    null,
    jsonb_build_object(
      'activeVersion',
      jsonb_build_object(
        'from', case when v_previous_version is null then null else v_previous_version::text end,
        'to', v_target.version::text
      )
    ),
    jsonb_build_object('checksumSha256', v_target.checksum_sha256),
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'template_id', p_template_id,
    'version', v_target.version,
    'previous_version', v_previous_version,
    'updated_at', v_updated_at,
    'message', format('Versao %s ativada com sucesso.', v_target.version)
  );
end;
$$;

revoke all on function public.activate_pi_document_template(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.activate_pi_document_template(uuid, uuid, uuid, timestamptz)
  to service_role;

-- =============================================================================
-- 5) Tela em `app_pages` e propagacao de permissao
-- =============================================================================
-- Regra de permissao por tela do CLAUDE.md: este unico `page_key` libera menu,
-- listagem de versoes, upload, ativacao e geracao do documento. Nao ha
-- permissao granular por operacao neste modulo.
insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'permissao-intervencao',
  '/permissao-intervencao',
  'Permissao de Intervencao',
  'Operacao',
  'Permissao de Intervencao (PI): versoes do template Word e geracao do documento.',
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

insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  tenants.tenant_id,
  roles.id,
  'permissao-intervencao',
  coalesce(roles.is_admin, false)
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) tenants
join public.app_roles roles
  on roles.ativo = true
left join public.role_page_permissions existing
  on existing.tenant_id = tenants.tenant_id
 and existing.role_id = roles.id
 and existing.page_key = 'permissao-intervencao'
where existing.role_id is null
on conflict (tenant_id, role_id, page_key) do nothing;

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
  'permissao-intervencao',
  coalesce(roles.is_admin, false),
  null,
  null
from public.app_users users
left join public.app_roles roles
  on roles.id = users.role_id
 and roles.ativo = true
left join public.app_user_page_permissions existing
  on existing.tenant_id = users.tenant_id
 and existing.user_id = users.id
 and existing.page_key = 'permissao-intervencao'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

-- =============================================================================
-- 6) Verificacao
-- =============================================================================
do $$
declare
  v_register_fn regprocedure := 'public.register_pi_document_template(uuid, uuid, uuid, text, text, text, jsonb)'::regprocedure;
  v_activate_fn regprocedure := 'public.activate_pi_document_template(uuid, uuid, uuid, timestamptz)'::regprocedure;
begin
  if has_function_privilege('anon', v_register_fn, 'execute')
     or has_function_privilege('authenticated', v_register_fn, 'execute') then
    raise exception '426: register_pi_document_template ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_activate_fn, 'execute')
     or has_function_privilege('authenticated', v_activate_fn, 'execute') then
    raise exception '426: activate_pi_document_template ainda executavel por anon/authenticated';
  end if;

  if has_table_privilege('anon', 'public.pi_document_template', 'insert')
     or has_table_privilege('authenticated', 'public.pi_document_template', 'insert')
     or has_table_privilege('authenticated', 'public.pi_document_template', 'update')
     or has_table_privilege('authenticated', 'public.pi_document_template', 'delete') then
    raise exception '426: pi_document_template ainda aceita escrita por anon/authenticated';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'pi_document_template_active_per_tenant'
  ) then
    raise exception '426: indice de template ativo unico por tenant nao foi criado';
  end if;

  if not exists (
    select 1
    from public.app_pages
    where page_key = 'permissao-intervencao'
      and ativo = true
      and default_user_access = false
  ) then
    raise exception '426: pagina permissao-intervencao nao foi cadastrada corretamente em app_pages';
  end if;

  if to_regclass('storage.buckets') is not null
     and not exists (select 1 from storage.buckets where id = 'pi-templates') then
    raise exception '426: bucket pi-templates nao existe apos a migration';
  end if;

  if to_regclass('storage.buckets') is not null
     and exists (select 1 from storage.buckets where id = 'pi-templates' and public = true) then
    raise exception '426: bucket pi-templates esta publico; ele deve ser privado';
  end if;
end;
$$;
