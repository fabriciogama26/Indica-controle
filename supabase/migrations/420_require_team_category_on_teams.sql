-- 420_require_team_category_on_teams.sql
-- Tipo de equipe obrigatorio na tela Equipes, e regra de encarregado so por ele.
--
-- CONTEXTO
-- ---------------------------------------------------------------------------
-- A 415 criou `team_categories` (TECNICA/COMERCIAL) e deixou
-- `teams.team_category_id` opcional, com a regra operacional decidida por
-- `team_types.name = 'COMERCIAL' OR team_categories.code = 'COMERCIAL'`. A 416
-- deu classificacao propria ao tipo operacional (`team_types.team_category_id`).
-- Sobraram tres fontes possiveis para a mesma pergunta ("esta equipe e
-- comercial?") e um campo obrigatorio no negocio que o banco aceitava vazio.
--
-- O QUE ESTA MIGRATION FAZ
-- ---------------------------------------------------------------------------
-- 1. Backfill de `teams.team_category_id` onde ainda esta nulo, usando a
--    classificacao do proprio tipo operacional e, na falta dela, o nome do tipo
--    (COMERCIAL -> COMERCIAL, resto -> TECNICA).
-- 2. Realinha para COMERCIAL as equipes que hoje sao comerciais apenas pelo
--    atalho do nome do tipo operacional. Sem isso o passo 4 as tornaria
--    tecnicas sem encarregado -- registro impossivel de salvar depois.
-- 3. `teams.team_category_id` passa a NOT NULL.
-- 4. Encarregado/Supervisor passam a depender SO de `team_categories.code`:
--    TECNICA exige encarregado, COMERCIAL exige supervisor e nao tem
--    encarregado. O atalho por `team_types.name` sai do trigger e da RPC.
-- 5. Passa a recusar equipe cujo Tipo de equipe divirja da classificacao do
--    Tipo operacional escolhido (`team_type_category_mismatch`), quando o tipo
--    operacional tiver classificacao propria.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ---------------------------------------------------------------------------
-- Nao corrige divergencia entre Tipo de equipe e Tipo operacional fora do caso
-- do passo 2: corrigir no automatico trocaria a natureza da equipe (perdendo o
-- encarregado, ou exigindo um que nao existe). O passo 6 apenas lista essas
-- equipes por NOTICE, para correcao manual na tela.
-- Nao mexe em Medicao, Medicao Comercial nem em `team_types`.

-- =============================================================================
-- 0) Ordem de lock (obrigatorio, nao e otimizacao)
-- =============================================================================
-- Esta migration precisa de ACCESS EXCLUSIVE em `public.teams` DUAS vezes: o
-- `SET NOT NULL` do passo 3 e a troca de trigger do passo 4.
--
-- Sem este passo 0, a transacao chega no passo 3 ja segurando ROW EXCLUSIVE em
-- `teams` (pelos quatro UPDATEs dos passos 1 e 2) e precisa ELEVAR o lock. Se
-- qualquer transacao da aplicacao pegou `teams` -- ou um indice dela -- entre um
-- ponto e outro, os dois lados passam a esperar um pelo outro e o Postgres mata
-- a migration com `40P01: deadlock detected`. Foi exatamente o que aconteceu na
-- primeira tentativa de aplicar este arquivo.
--
-- Tomando o lock aqui, antes de qualquer leitura ou escrita, a transacao nao
-- eleva lock nenhum: existe UM ponto de aquisicao e o ciclo deixa de ser
-- possivel. `teams` tem poucas linhas por tenant, entao a janela de bloqueio e
-- a duracao dos proprios UPDATEs.
--
-- `lock_timeout` esta aqui para a migration FALHAR RAPIDO em vez de ficar na
-- fila. Um pedido de ACCESS EXCLUSIVE pendente bloqueia todo leitor que chegar
-- depois dele: esperar em silencio nao e "mais seguro", e derrubar a aplicacao
-- junto. Se estourar o timeout, rode de novo -- de preferencia com a aplicacao
-- ociosa. Nada foi aplicado pela metade, a transacao inteira volta atras.
set lock_timeout = '5s';

lock table public.teams in access exclusive mode;

-- =============================================================================
-- 1) Backfill de `teams.team_category_id`
-- =============================================================================
update public.teams t
set team_category_id = tt.team_category_id
from public.team_types tt
where tt.id = t.team_type_id
  and tt.tenant_id = t.tenant_id
  and tt.team_category_id is not null
  and t.team_category_id is null;

update public.teams t
set team_category_id = tc.id
from public.team_types tt
join public.team_categories tc
  on tc.tenant_id = tt.tenant_id
 and tc.code = case
   when translate(upper(btrim(coalesce(tt.name, ''))), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') = 'COMERCIAL' then 'COMERCIAL'
   else 'TECNICA'
 end
where tt.id = t.team_type_id
  and tt.tenant_id = t.tenant_id
  and t.team_category_id is null;

-- Rede final: equipe cujo tipo operacional nao resolve no tenant ainda assim
-- precisa de categoria para o passo 3 nao falhar.
update public.teams t
set team_category_id = tc.id
from public.team_categories tc
where tc.tenant_id = t.tenant_id
  and tc.code = 'TECNICA'
  and t.team_category_id is null;

-- =============================================================================
-- 2) Realinha quem so era comercial pelo nome do tipo operacional
-- =============================================================================
-- Essas equipes nao tem encarregado (o trigger da 415 anulava na gravacao).
-- Deixa-las como TECNICA depois do passo 4 as tornaria impossiveis de salvar.
update public.teams t
set team_category_id = com.id
from public.team_types tt
join public.team_categories com
  on com.tenant_id = tt.tenant_id
 and com.code = 'COMERCIAL'
where tt.id = t.team_type_id
  and tt.tenant_id = t.tenant_id
  and translate(upper(btrim(coalesce(tt.name, ''))), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') = 'COMERCIAL'
  and t.team_category_id is distinct from com.id;

-- =============================================================================
-- 3) `teams.team_category_id` obrigatorio
-- =============================================================================
alter table if exists public.teams
  alter column team_category_id set not null;

-- =============================================================================
-- 4) Trigger: categoria obrigatoria, regra por categoria, sem atalho por nome
-- =============================================================================
create or replace function public.enforce_team_category_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_team_type_category_id uuid;
  v_is_commercial boolean := false;
begin
  if new.team_category_id is null then
    raise exception using
      errcode = '23514',
      message = 'team_requires_category: tipo de equipe e obrigatorio.';
  end if;

  select tc.code
  into v_code
  from public.team_categories tc
  where tc.id = new.team_category_id
    and tc.tenant_id = new.tenant_id;

  if v_code is null then
    raise exception using
      errcode = '23503',
      message = 'invalid_team_category: tipo de equipe invalido para o tenant atual.';
  end if;

  select tt.team_category_id
  into v_team_type_category_id
  from public.team_types tt
  where tt.id = new.team_type_id
    and tt.tenant_id = new.tenant_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'invalid_team_type: tipo operacional invalido para o tenant atual.';
  end if;

  if v_team_type_category_id is not null
     and v_team_type_category_id is distinct from new.team_category_id then
    raise exception using
      errcode = '23514',
      message = 'team_type_category_mismatch: o tipo de equipe escolhido nao pertence ao tipo operacional da equipe.';
  end if;

  -- `v_code` ja foi validado como nao nulo acima; o coalesce fica pelo padrao de
  -- boolean composto do guia_sql (regra 19), nao por duvida sobre o valor.
  v_is_commercial := coalesce(v_code = 'COMERCIAL', false);

  if v_is_commercial then
    new.foreman_person_id := null;
  end if;

  if not v_is_commercial and new.foreman_person_id is null then
    raise exception using
      errcode = '23514',
      message = 'team_requires_foreman: encarregado e obrigatorio para equipe tecnica.';
  end if;

  if v_is_commercial and new.supervisor_person_id is null then
    raise exception using
      errcode = '23514',
      message = 'team_requires_supervisor: supervisor e obrigatorio para equipe comercial.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_team_category_links() from public, anon, authenticated;

drop trigger if exists trg_enforce_team_category_links on public.teams;
create trigger trg_enforce_team_category_links
before insert or update on public.teams
for each row execute function public.enforce_team_category_links();

-- =============================================================================
-- 5) `save_team_record` com Tipo de equipe obrigatorio
-- =============================================================================
create or replace function public.save_team_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_team_id uuid default null,
  p_name text default null,
  p_vehicle_plate text default null,
  p_service_center_id uuid default null,
  p_team_type_id uuid default null,
  p_foreman_person_id uuid default null,
  p_stock_center_id uuid default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null,
  p_supervisor_person_id uuid default null,
  p_team_category_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.teams%rowtype;
  v_team_type_category_id uuid;
  v_team_id uuid;
  v_updated_at timestamptz;
  v_effective_stock_center_id uuid;
  v_team_category_code text;
  v_team_type_name text;
  v_is_commercial boolean := false;
begin
  select tt.name, tt.team_category_id
  into v_team_type_name, v_team_type_category_id
  from public.team_types tt
  where tt.id = p_team_type_id
    and tt.tenant_id = p_tenant_id
    and tt.ativo = true;

  if v_team_type_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_TEAM_TYPE',
      'message', 'Tipo operacional invalido para o tenant atual.'
    );
  end if;

  if p_team_category_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_TEAM_CATEGORY',
      'message', 'Tipo de equipe e obrigatorio.'
    );
  end if;

  select tc.code
  into v_team_category_code
  from public.team_categories tc
  where tc.id = p_team_category_id
    and tc.tenant_id = p_tenant_id
    and tc.ativo = true;

  if v_team_category_code is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_TEAM_CATEGORY',
      'message', 'Tipo de equipe invalido para o tenant atual.'
    );
  end if;

  -- `team_types.team_category_id` e anulavel desde a 416 (compatibilidade com
  -- tipos criados antes dela). Quando esta preenchido, ele manda: gravar equipe
  -- com classificacao diferente da do proprio tipo operacional deixaria duas
  -- verdades sobre a mesma equipe, e a regra de encarregado passaria a depender
  -- de qual das duas o leitor consultou.
  if v_team_type_category_id is not null
     and v_team_type_category_id is distinct from p_team_category_id then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'TEAM_TYPE_CATEGORY_MISMATCH',
      'message', 'O tipo de equipe escolhido nao pertence ao tipo operacional da equipe.'
    );
  end if;

  -- Encarregado/Supervisor passam a depender SO do Tipo de equipe. Ate a 419
  -- valia tambem `team_types.name = 'COMERCIAL'`; com o campo obrigatorio, esse
  -- atalho so abria o caminho em que a tela pedia encarregado e o banco apagava
  -- o valor em silencio.
  v_is_commercial := coalesce(v_team_category_code = 'COMERCIAL', false);

  if v_is_commercial then
    p_foreman_person_id := null;
  end if;

  if not v_is_commercial and p_foreman_person_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_FOREMAN',
      'message', 'Encarregado e obrigatorio para equipe tecnica.'
    );
  end if;

  if v_is_commercial and p_supervisor_person_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_SUPERVISOR',
      'message', 'Supervisor e obrigatorio para equipe comercial.'
    );
  end if;

  if p_foreman_person_id is not null then
    perform 1
    from public.people p
    where p.id = p_foreman_person_id
      and p.tenant_id = p_tenant_id
      and p.ativo = true;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 422,
        'reason', 'INVALID_FOREMAN',
        'message', 'Encarregado invalido para o tenant atual.'
      );
    end if;
  end if;

  if p_supervisor_person_id is not null then
    perform 1
    from public.people p
    join public.job_titles jt
      on jt.id = p.job_title_id
     and jt.tenant_id = p.tenant_id
    where p.id = p_supervisor_person_id
      and p.tenant_id = p_tenant_id
      and p.ativo = true
      and jt.ativo = true
      and (
        jt.code ilike '%SUPERVISOR%'
        or jt.name ilike '%SUPERVISOR%'
      );

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 422,
        'reason', 'INVALID_SUPERVISOR',
        'message', 'Supervisor invalido para o tenant atual.'
      );
    end if;
  end if;

  if p_stock_center_id is not null then
    perform 1
    from public.stock_centers sc
    where sc.id = p_stock_center_id
      and sc.tenant_id = p_tenant_id
      and sc.is_active = true
      and sc.center_type = 'OWN';

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 422,
        'reason', 'INVALID_STOCK_CENTER',
        'message', 'Centro de estoque proprio invalido para a equipe.'
      );
    end if;

    if exists (
      select 1
      from public.teams t
      where t.tenant_id = p_tenant_id
        and t.stock_center_id = p_stock_center_id
        and (p_team_id is null or t.id <> p_team_id)
    ) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'STOCK_CENTER_ALREADY_LINKED',
        'message', 'Este centro de estoque proprio ja esta vinculado a outra equipe.'
      );
    end if;
  end if;

  if p_team_id is null then
    -- A trava de "um encarregado, uma equipe ativa" so faz sentido quando ha
    -- encarregado: equipe comercial pode ter varias sem nenhum vinculo.
    if p_foreman_person_id is not null and exists (
      select 1
      from public.teams t
      where t.tenant_id = p_tenant_id
        and t.foreman_person_id = p_foreman_person_id
        and t.ativo = true
    ) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'DUPLICATE_TEAM_FOREMAN',
        'message', 'Ja existe equipe ativa cadastrada para este encarregado. Selecione outro encarregado.'
      );
    end if;

    insert into public.teams (
      tenant_id,
      name,
      vehicle_plate,
      service_center_id,
      team_type_id,
      team_category_id,
      foreman_person_id,
      supervisor_person_id,
      stock_center_id,
      ativo,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_name,
      p_vehicle_plate,
      p_service_center_id,
      p_team_type_id,
      p_team_category_id,
      p_foreman_person_id,
      p_supervisor_person_id,
      null,
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_team_id, v_updated_at;

    begin
      v_effective_stock_center_id := public.ensure_team_stock_center_record(
        p_tenant_id => p_tenant_id,
        p_actor_user_id => p_actor_user_id,
        p_team_id => v_team_id,
        p_team_name => p_name,
        p_existing_stock_center_id => p_stock_center_id
      );
    exception
      when others then
        if lower(coalesce(sqlerrm, '')) like '%invalid_stock_center%' then
          return jsonb_build_object(
            'success', false,
            'status', 422,
            'reason', 'INVALID_STOCK_CENTER',
            'message', 'Centro de estoque proprio invalido para a equipe.'
          );
        end if;

        raise;
    end;

    update public.teams
    set
      stock_center_id = v_effective_stock_center_id,
      updated_by = p_actor_user_id,
      updated_at = now()
    where id = v_team_id
      and tenant_id = p_tenant_id
    returning updated_at
    into v_updated_at;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'team_id', v_team_id,
      'updated_at', v_updated_at
    );
  end if;

  select *
  into v_current
  from public.teams
  where id = p_team_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_NOT_FOUND',
      'message', 'Equipe nao encontrada.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de editar a equipe.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A equipe %s foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name)
    );
  end if;

  if not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'RECORD_INACTIVE',
      'message', 'Ative a equipe antes de editar.'
    );
  end if;

  if p_foreman_person_id is not null and exists (
    select 1
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.foreman_person_id = p_foreman_person_id
      and t.ativo = true
      and t.id <> p_team_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_TEAM_FOREMAN',
      'message', 'Ja existe equipe ativa cadastrada para este encarregado. Selecione outro encarregado.'
    );
  end if;

  v_effective_stock_center_id := coalesce(p_stock_center_id, v_current.stock_center_id);

  update public.teams
  set
    name = p_name,
    vehicle_plate = p_vehicle_plate,
    service_center_id = p_service_center_id,
    team_type_id = p_team_type_id,
    team_category_id = p_team_category_id,
    foreman_person_id = p_foreman_person_id,
    supervisor_person_id = p_supervisor_person_id,
    stock_center_id = v_effective_stock_center_id,
    updated_by = p_actor_user_id
  where id = p_team_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_team_id, v_updated_at;

  if v_effective_stock_center_id is null then
    begin
      v_effective_stock_center_id := public.ensure_team_stock_center_record(
        p_tenant_id => p_tenant_id,
        p_actor_user_id => p_actor_user_id,
        p_team_id => p_team_id,
        p_team_name => p_name,
        p_existing_stock_center_id => null
      );
    exception
      when others then
        if lower(coalesce(sqlerrm, '')) like '%invalid_stock_center%' then
          return jsonb_build_object(
            'success', false,
            'status', 422,
            'reason', 'INVALID_STOCK_CENTER',
            'message', 'Centro de estoque proprio invalido para a equipe.'
          );
        end if;

        raise;
    end;

    update public.teams
    set
      stock_center_id = v_effective_stock_center_id,
      updated_by = p_actor_user_id,
      updated_at = now()
    where id = p_team_id
      and tenant_id = p_tenant_id
    returning updated_at
    into v_updated_at;
  end if;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
    insert into public.app_entity_history (
      tenant_id,
      module_key,
      entity_table,
      entity_id,
      entity_code,
      change_type,
      reason,
      changes,
      metadata,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      'equipes',
      'teams',
      p_team_id,
      p_name,
      'UPDATE',
      null,
      coalesce(p_changes, '{}'::jsonb),
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'team_id', v_team_id,
    'updated_at', v_updated_at
  );
exception
  when unique_violation then
    if p_stock_center_id is not null then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'STOCK_CENTER_ALREADY_LINKED',
        'message', 'Este centro de estoque proprio ja esta vinculado a outra equipe.'
      );
    end if;

    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_TEAM_COMBINATION',
      'message', 'Ja existe equipe com o mesmo nome, encarregado e placa no tenant atual.'
    );
end;
$$;

revoke all on function public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, uuid, uuid) to service_role;

-- =============================================================================
-- 6) Verificacao
-- =============================================================================
do $$
declare
  v_null_category bigint;
  v_mismatch bigint;
begin
  select count(*) into v_null_category
  from public.teams
  where team_category_id is null;

  if v_null_category > 0 then
    raise exception '420: % equipe(s) ainda sem tipo de equipe apos o backfill.', v_null_category;
  end if;

  select count(*)
  into v_mismatch
  from public.teams t
  join public.team_types tt
    on tt.id = t.team_type_id
   and tt.tenant_id = t.tenant_id
  where tt.team_category_id is not null
    and t.team_category_id is distinct from tt.team_category_id;

  if v_mismatch > 0 then
    raise notice '420: % equipe(s) com Tipo de equipe divergente da classificacao do Tipo operacional. Elas continuam funcionando, mas so voltam a salvar depois de corrigir um dos dois campos na tela Equipes.', v_mismatch;
  end if;
end;
$$;

reset lock_timeout;
