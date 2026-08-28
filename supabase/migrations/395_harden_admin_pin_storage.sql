-- 395_harden_admin_pin_storage.sql
-- Substitui o SHA-256 sem sal do PIN de administrador por bcrypt, e move a
-- comparacao para dentro do banco.
--
-- POR QUE ESTA MIGRATION EXISTE
-- ---------------------------------------------------------------------------
-- A Edge Function `verify_admin_pin` compara `sha256Hex(pin) = admin_pin_hash`.
-- Tres problemas somados:
--
--   1. SHA-256 sem sal sobre segredo de baixissima entropia. Um PIN de 4 a 6
--      digitos tem no maximo um milhao de combinacoes: quem obtiver um dump de
--      `app_users` recupera todos os PINs em segundos, com tabela pre-computada.
--      Sal e fator de trabalho sao exatamente o que falta.
--   2. O hash trafega para fora do banco (a funcao faz SELECT do
--      `admin_pin_hash` e compara em TypeScript). Nao ha razao para o segredo
--      sair da tabela.
--   3. A comparacao com `===` em JS nao e de tempo constante. Menos grave que
--      os outros dois, mas gratuito de corrigir: `crypt()` compara em tempo
--      constante por construcao.
--
-- O rate limit, terceira perna do problema, e resolvido na propria Edge
-- Function (nao ha como um RPC limitar quem nunca chega ate ele).
--
-- POR QUE bcrypt SOBRE O SHA-256, E NAO bcrypt SOBRE O PIN
-- ---------------------------------------------------------------------------
-- Nao e possivel converter um SHA-256 existente em bcrypt-do-PIN sem conhecer
-- o PIN original, e nao ha como obte-lo. Entao o backfill aplica bcrypt SOBRE
-- o hash que ja existe: `crypt(admin_pin_hash, gen_salt('bf', 12))`.
--
-- Isso mantem o dado migravel sem pedir novo PIN a ninguem, e ainda assim
-- resolve o problema real: o atacante com o dump passa a enfrentar bcrypt com
-- fator 12 por tentativa, em vez de uma tabela pre-computada. A entropia do
-- segredo nao muda -- ela e do PIN -- mas o custo por tentativa deixa de ser
-- desprezivel, que e o que torna um espaco de um milhao inviavel na pratica.
--
-- A Edge Function continua enviando o SHA-256 do PIN, entao o contrato HTTP
-- externo (POST com user_id + pin) nao muda. O cliente movel nao percebe.
--
-- EXPAND AGORA, CONTRACT DEPOIS
-- ---------------------------------------------------------------------------
-- Esta migration so ADICIONA (`admin_pin_secret` + RPC). A coluna fraca
-- `admin_pin_hash` permanece, para que um rollback da Edge Function continue
-- funcionando. Enquanto ela existir, o risco de dump NAO esta fechado.
-- A migration 396 faz o contract e deve ser aplicada depois que a nova versao
-- de `verify_admin_pin` estiver publicada e testada.

alter table public.app_users
  add column if not exists admin_pin_secret text;

comment on column public.app_users.admin_pin_secret is
  'Hash bcrypt (fator 12) aplicado sobre o SHA-256 do PIN admin. Comparado apenas por public.verify_admin_pin_secret; nunca sai da tabela.';

-- ---------------------------------------------------------------------------
-- Backfill: so preenche quem ainda nao tem, e so a partir de hash existente.
-- Idempotente por causa do `where`.
--
-- O backfill inteiro roda por `execute`, e nao como comando solto, porque
-- `admin_pin_hash` pode nao existir no banco: ou porque a 396 ja rodou (esta
-- migration precisa ser re-executavel depois dela), ou por drift em relacao a
-- migration 000. SQL estatico dentro de PL/pgSQL e planejado na execucao e
-- falharia com 42703 mesmo protegido por um `if` -- so o dinamico e planejado
-- apenas quando de fato executa.
-- ---------------------------------------------------------------------------
do $$
declare
  v_has_legacy boolean;
  v_updated    int := 0;
begin
  select coalesce(
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'app_users'
        and column_name = 'admin_pin_hash'
    ),
    false
  )
  into v_has_legacy;

  if not v_has_legacy then
    raise notice '395: coluna admin_pin_hash ausente; backfill dispensado (396 ja aplicada ou drift em relacao a 000).';
    return;
  end if;

  execute $backfill$
    update public.app_users
    set admin_pin_secret = crypt(lower(btrim(admin_pin_hash)), gen_salt('bf', 12))
    where admin_pin_secret is null
      and nullif(btrim(coalesce(admin_pin_hash, '')), '') is not null
  $backfill$;

  get diagnostics v_updated = row_count;
  raise notice '395: % usuario(s) migrado(s) de SHA-256 para bcrypt.', v_updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC de verificacao. Recebe o SHA-256 do PIN, nunca o PIN em claro, e devolve
-- apenas booleano -- o hash nao sai do banco.
--
-- Valida tambem o vinculo (auth_user_id) e o papel de admin, para que a
-- checagem nao dependa so do que a Edge Function conferiu antes: se um GRANT
-- for reaberto por engano no futuro, a funcao continua se defendendo sozinha.
-- Mesmo padrao de defesa em camadas que a migration 388 aplicou em Faturamento.
-- ---------------------------------------------------------------------------
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
  v_legacy     text;
  v_is_admin   boolean;
  v_has_legacy boolean;
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

  -- Caminho novo: bcrypt. `crypt` compara em tempo constante.
  if nullif(btrim(coalesce(v_secret, '')), '') is not null then
    return coalesce(crypt(v_normalized, v_secret) = v_secret, false);
  end if;

  -- Fallback de transicao: usuario cujo backfill nao alcancou (PIN definido
  -- entre a aplicacao da 395 e o deploy da Edge Function). Sai de cena com a
  -- migration 396, que remove `admin_pin_hash`.
  --
  -- A leitura da coluna antiga e dinamica de proposito: quando a 396 ja tiver
  -- rodado, `admin_pin_hash` nao existe mais e uma referencia estatica quebraria
  -- a funcao inteira com 42703 no primeiro uso, mesmo protegida por `if`.
  select coalesce(
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'app_users'
        and column_name = 'admin_pin_hash'
    ),
    false
  )
  into v_has_legacy;

  if coalesce(v_has_legacy, false) then
    execute 'select lower(btrim(coalesce(admin_pin_hash, ''''))) from public.app_users where id = $1'
      into v_legacy
      using p_app_user_id;

    if nullif(coalesce(v_legacy, ''), '') is not null then
      return coalesce(v_legacy = v_normalized, false);
    end if;
  end if;

  return false;
end;
$$;

revoke all on function public.verify_admin_pin_secret(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.verify_admin_pin_secret(uuid, uuid, text) to service_role;

comment on function public.verify_admin_pin_secret(uuid, uuid, text) is
  'Valida o PIN admin (recebido como SHA-256) contra o bcrypt em app_users.admin_pin_secret. Executavel apenas por service_role.';

-- ---------------------------------------------------------------------------
-- Validacao pos-aplicacao.
-- ---------------------------------------------------------------------------
do $$
declare
  v_pending int := 0;
  v_exposed int;
begin
  -- Mesma razao do backfill: so consulta a coluna antiga se ela existir, e por
  -- SQL dinamico, para nao falhar com 42703 quando a 396 ja tiver rodado.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_users'
      and column_name = 'admin_pin_hash'
  ) then
    execute $check$
      select count(*)
      from public.app_users
      where admin_pin_secret is null
        and nullif(btrim(coalesce(admin_pin_hash, '')), '') is not null
    $check$
    into v_pending;
  end if;

  if v_pending > 0 then
    raise exception '395 FALHOU: % usuario(s) com admin_pin_hash sem admin_pin_secret correspondente.', v_pending;
  end if;

  select count(*) into v_exposed
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'verify_admin_pin_secret'
    and (
      has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute')
    );

  if v_exposed > 0 then
    raise exception '395 FALHOU: verify_admin_pin_secret executavel por anon/authenticated.';
  end if;

  raise notice '395 OK: admin_pin_secret preenchido e RPC restrita a service_role.';
end;
$$;
