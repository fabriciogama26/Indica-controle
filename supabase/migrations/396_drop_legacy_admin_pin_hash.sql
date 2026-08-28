-- 396_drop_legacy_admin_pin_hash.sql
-- Fase de CONTRACT do PIN admin. Remove a coluna `admin_pin_hash`.
--
-- ATENCAO: NAO APLICAR JUNTO COM A 395.
-- ---------------------------------------------------------------------------
-- A 395 fez o expand (nova coluna `admin_pin_secret` + RPC bcrypt) mantendo a
-- coluna antiga, para que um rollback da Edge Function `verify_admin_pin`
-- continuasse funcionando. Esta migration so deve ser aplicada DEPOIS que:
--
--   1. a nova versao de `verify_admin_pin` estiver publicada
--      (`npx supabase functions deploy verify_admin_pin`, ver
--      guias/runbook_deploy_edge_functions.md); e
--   2. um teste funcional real tiver confirmado PIN correto e PIN incorreto
--      com um usuario administrador.
--
-- Enquanto `admin_pin_hash` existir, o risco de dump descrito na 395 continua
-- aberto: e um SHA-256 sem sal de um segredo de baixa entropia. E por isso que
-- esta migration existe, e nao apenas um comentario dizendo "remover depois".
--
-- Aplicar antes do deploy quebra a autenticacao por PIN do cliente movel: o
-- fallback de transicao da RPC deixa de ter onde comparar.

do $$
declare
  v_missing int := 0;
begin
  -- Pre-condicao: a 395 precisa ter rodado. Sem `admin_pin_secret` nao existe
  -- para onde migrar, e tanto a guarda abaixo quanto a RPC republicada mais
  -- adiante referenciam a coluna -- sem esta checagem o erro sairia como um
  -- 42703 cru, sem dizer o que fazer.
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_users'
      and column_name = 'admin_pin_secret'
  ) then
    raise exception
      '396 ABORTADA: coluna admin_pin_secret nao existe. Aplique a migration 395 antes desta.';
  end if;

  -- A guarda so faz sentido enquanto a coluna antiga existir. Antes, este bloco
  -- referenciava `admin_pin_hash` em SQL estatico e quebrava com
  -- "42703: column admin_pin_hash does not exist" nos dois cenarios em que a
  -- coluna esta ausente: re-execucao desta migration (o `drop column if exists`
  -- e idempotente, o bloco nao era) e drift em relacao a migration 000, que
  -- declara a coluna. SQL dentro de PL/pgSQL e planejado na execucao, entao
  -- proteger com `if` nao basta -- precisa ser dinamico.
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_users'
      and column_name = 'admin_pin_hash'
  ) then
    raise notice '396: coluna admin_pin_hash ja ausente; nada a remover.';
  else
    -- Guarda: se algum admin ficou sem o hash novo, remover o antigo o deixaria
    -- sem PIN nenhum. Melhor abortar do que trancar um administrador para fora.
    execute $check$
      select count(*)
      from public.app_users
      where nullif(btrim(coalesce(admin_pin_hash, '')), '') is not null
        and nullif(btrim(coalesce(admin_pin_secret, '')), '') is null
    $check$
    into v_missing;

    if v_missing > 0 then
      raise exception
        '396 ABORTADA: % usuario(s) tem admin_pin_hash sem admin_pin_secret. Rode a 395 novamente antes do contract.',
        v_missing;
    end if;
  end if;
end;
$$;

alter table public.app_users
  drop column if exists admin_pin_hash;

-- Republica a RPC sem o fallback de transicao: a partir daqui existe um unico
-- caminho de verificacao, o bcrypt.
create or replace function public.verify_admin_pin_secret(
  p_auth_user_id uuid,
  p_app_user_id uuid,
  p_pin_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret     text;
  v_is_admin   boolean;
  v_normalized text := lower(btrim(coalesce(p_pin_sha256, '')));
begin
  if p_auth_user_id is null or p_app_user_id is null or v_normalized = '' then
    return false;
  end if;

  select
    u.admin_pin_secret,
    coalesce(r.is_admin, false)
  into v_secret, v_is_admin
  from public.app_users u
  left join public.app_roles r on r.id = u.role_id
  where u.id = p_app_user_id
    and u.auth_user_id = p_auth_user_id
    and coalesce(u.ativo, false) = true
    and coalesce(r.ativo, false) = true;

  if not found then
    return false;
  end if;

  if not coalesce(v_is_admin, false) then
    return false;
  end if;

  if nullif(btrim(coalesce(v_secret, '')), '') is null then
    return false;
  end if;

  return coalesce(crypt(v_normalized, v_secret) = v_secret, false);
end;
$$;

revoke all on function public.verify_admin_pin_secret(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.verify_admin_pin_secret(uuid, uuid, text) to service_role;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_users'
      and column_name = 'admin_pin_hash'
  ) then
    raise exception '396 FALHOU: coluna admin_pin_hash ainda existe.';
  end if;

  raise notice '396 OK: admin_pin_hash removida, verificacao apenas por bcrypt.';
end;
$$;
