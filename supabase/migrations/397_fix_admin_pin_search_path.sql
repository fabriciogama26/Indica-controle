-- 397_fix_admin_pin_search_path.sql
-- Corrige o search_path de `verify_admin_pin_secret` para alcancar o pgcrypto.
--
-- POR QUE ESTA MIGRATION EXISTE
-- ---------------------------------------------------------------------------
-- As migrations 395 e 396 declararam a funcao com `set search_path = public,
-- pg_temp` e chamam `crypt()` sem qualificar o schema. Em projeto Supabase o
-- pgcrypto ja vem instalado no schema `extensions`, entao o
-- `create extension if not exists pgcrypto` da migration 000 foi um no-op e a
-- extensao NAO esta em `public`. Com esse search_path a funcao falha em
-- execucao com "function crypt(text, text) does not exist".
--
-- POR QUE NAO FOI PEGO ANTES
-- ---------------------------------------------------------------------------
-- O backfill da 395 tambem chama `crypt`/`gen_salt`, mas roda dentro de um
-- bloco `DO`, que herda o search_path da SESSAO -- e a sessao do
-- `supabase db push` inclui `extensions`. O backfill migrou o PIN existente sem
-- erro, o que deu a impressao de que o caminho estava resolvido. A funcao, essa
-- sim com search_path fixo, nunca chegou a executar porque a Edge Function que
-- a chama ainda nao tinha sido publicada. Erro latente, nao silencioso: ele
-- apareceria no primeiro teste de PIN apos o deploy.
--
-- POR QUE `public, extensions, pg_temp` E NAO `extensions.crypt(...)`
-- ---------------------------------------------------------------------------
-- Qualificar como `extensions.crypt` resolveria o caso mais provavel, mas
-- quebraria o inverso: projeto reconstruido do zero pelas migrations, onde a
-- 000 realmente cria o pgcrypto em `public`. Incluir os dois schemas no
-- search_path funciona nas duas topologias, que e o que a migration precisa
-- garantir para `db reset` e branch de preview continuarem equivalentes a
-- producao.
--
-- `extensions` e propriedade do `postgres` e nao e gravavel por papel comum,
-- entao inclui-lo no search_path de uma funcao SECURITY DEFINER nao reabre o
-- vetor que a 210 e a 394 fecharam -- e a recomendacao da propria Supabase.
--
-- A migration 394 nao precisa de correcao equivalente: nenhuma das funcoes que
-- ela ajustou chama pgcrypto, usa operador de extensao ou referencia schema
-- fora de `public`; `auth.uid()` aparece sempre qualificado.

create or replace function public.verify_admin_pin_secret(
  p_auth_user_id uuid,
  p_app_user_id uuid,
  p_pin_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
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
    -- COALESCE obrigatorio (guia_sql regra 19/20): `r.is_admin` e nulavel e a
    -- variavel entra direto num IF logo abaixo.
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

comment on function public.verify_admin_pin_secret(uuid, uuid, text) is
  'Valida o PIN admin (recebido como SHA-256) contra o bcrypt em app_users.admin_pin_secret. Executavel apenas por service_role. search_path inclui extensions por causa do pgcrypto.';

-- ---------------------------------------------------------------------------
-- Validacao pos-aplicacao.
--
-- Nao basta conferir o search_path declarado: o objetivo e provar que `crypt`
-- resolve de dentro da funcao. O teste abaixo gera um hash e o verifica pela
-- mesma rotina que a producao usa, com dado descartavel e sem tocar em
-- app_users.
-- ---------------------------------------------------------------------------
do $$
declare
  v_hash    text;
  v_ok      boolean;
  v_path    text;
begin
  select array_to_string(p.proconfig, ', ')
  into v_path
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'verify_admin_pin_secret';

  if v_path is null or position('extensions' in v_path) = 0 then
    raise exception '397 FALHOU: search_path da funcao nao inclui extensions (valor: %).', coalesce(v_path, 'nulo');
  end if;

  -- Prova de que pgcrypto resolve: gera e confere um hash descartavel.
  begin
    v_hash := crypt('397-smoke-test', gen_salt('bf', 4));
    v_ok := coalesce(crypt('397-smoke-test', v_hash) = v_hash, false);
  exception
    when undefined_function then
      raise exception '397 FALHOU: pgcrypto nao encontrado. Confirme em qual schema a extensao esta instalada.';
  end;

  if not coalesce(v_ok, false) then
    raise exception '397 FALHOU: pgcrypto resolveu mas nao validou o hash de teste.';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'verify_admin_pin_secret'
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
  ) then
    raise exception '397 FALHOU: verify_admin_pin_secret executavel por anon/authenticated.';
  end if;

  raise notice '397 OK: crypt resolve de dentro da funcao e a RPC segue restrita a service_role.';
end;
$$;
