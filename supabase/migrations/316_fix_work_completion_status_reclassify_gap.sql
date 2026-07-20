-- 316_fix_work_completion_status_reclassify_gap.sql
-- Bug real encontrado ao investigar "etapas sem ordem" na tela Programacao
-- Normalizada: set_project_programming_work_completion_status (migration 314)
-- e a UNICA RPC de escrita do modulo (310/311/313) que NUNCA chama
-- reclassify_project_programming_stages ao final. Todas as outras (save,
-- postpone, cancel, complete, reopen) chamam.
--
-- Consequencia, so quando o valor manual e/ou sai de 'PENDENCIA' (unico
-- codigo que reclassify exclui do seu cursor — ver migration 311):
-- 1) Ao ENTRAR em PENDENCIA: a etapa mantem o etapa_number/etapa_unica/
--    etapa_final que tinha antes (reclassify jamais visita essa linha, pois
--    seu cursor ja filtra `coalesce(work_completion_status,'') <> 'PENDENCIA'`
--    — nao ha como reclassify limpar o que nunca seleciona). Na lista/card
--    isso fica invisivel (getStageClassificationLabel checa
--    workCompletionStatus === 'PENDENCIA' ANTES de olhar a classificacao,
--    ver utils.ts), mas nao no export ENEL/ENEL NOVO
--    (formatInfoStatusEtapa nao checa workCompletionStatus, so etapa_number/
--    etapa_unica/etapa_final) — pode exportar "5a ETAPA" ou "ETAPA FINAL"
--    para uma linha que na tela mostra "Pendencia".
--    Alem disso, se a etapa em Pendencia carregava etapa_final=true, nenhuma
--    outra etapa e promovida a Final ate a proxima escrita (save/postpone/
--    cancel/complete) em QUALQUER etapa do mesmo projeto acionar reclassify
--    de outro caminho — ate la, o projeto fica sem nenhuma etapa Final
--    visivel.
-- 2) Ao SAIR de PENDENCIA (usuario escolhe outro valor manualmente): a etapa
--    volta a ser elegivel para o cursor de reclassify, mas como esta RPC
--    nunca chama reclassify, ela fica com o etapa_number antigo (de antes de
--    virar Pendencia) ate a proxima escrita em outra etapa do projeto
--    disparar reclassify por outro caminho. Nesse intervalo o numero exibido
--    pode nao bater mais com a posicao cronologica real entre as demais
--    etapas ativas — a causa raiz de "etapas sem ordem, deveria seguir as
--    datas" reportada pelo usuario.
--
-- Fora de escopo (investigado e descartado nesta rodada): a formula de Final
-- em reclassify_project_programming_stages (migration 311, linha ~152-184)
-- ja restringe corretamente a `status in ('PROGRAMADA','REPROGRAMADA') and
-- coalesce(work_completion_status,'') <> 'PENDENCIA'` tanto para o count
-- quanto para o row_number/Final — nao inclui Adiada/Cancelada/Pendencia no
-- calculo de "ultima data ativa". Confirmado em dado real (projeto
-- A044811036, tenant 7e65b733-1fe1-4137-93af-ee41f0ffc242): a etapa Final
-- existe e esta corretamente marcada na maior execution_date ativa
-- (2027-06-22); ela so nao aparece na lista porque fica fora da janela
-- padrao de filtro (mes atual + 90 dias) — efeito esperado do filtro, nao
-- bug de calculo. Nao alterar a formula de Final nem o cursor de exclusao de
-- reclassify.
--
-- Fix: set_project_programming_work_completion_status passa a (a) zerar a
-- classificacao da propria linha quando o novo valor e 'PENDENCIA' (ninguem
-- mais vai limpar essa linha depois, ja que reclassify nunca a seleciona) e
-- (b) chamar reclassify_project_programming_stages ao final, sempre — mesmo
-- padrao ja usado por save/postpone/cancel/complete/reopen neste modulo.
create or replace function public.set_project_programming_work_completion_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_work_completion_status text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_status text;
  v_updated_at timestamptz;
begin
  v_status := nullif(btrim(coalesce(p_work_completion_status, '')), '');

  if v_status is not null and v_status not in ('PARCIAL_PLANEJADO', 'PARCIAL_NAO_PLANEJADO', 'BENEFICIO_ATINGIDO', 'PENDENCIA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_WORK_COMPLETION_STATUS',
      'message', 'Estado do trabalho invalido para edicao manual. Use Concluir/Reabrir para Concluido.');
  end if;

  select * into v_target
  from public.programming
  where id = p_programming_id and tenant_id = p_tenant_id
  for update;

  if v_target.id is null then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Etapa nao encontrada para este tenant.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_target.project_id::text, 0));

  if v_target.status not in ('PROGRAMADA', 'REPROGRAMADA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_ACTIVE',
      'message', 'Somente etapas ativas podem ter o Estado do trabalho alterado.');
  end if;

  if coalesce(v_target.work_completion_status, '') = 'CONCLUIDO' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STAGE_COMPLETED_REQUIRES_REOPEN',
      'message', 'Etapa concluida: reabra antes de mudar o Estado do trabalho.');
  end if;

  if coalesce(v_target.work_completion_status, '') = 'ANTECIPADO' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STAGE_ANTICIPATED_NOT_EDITABLE',
      'message', 'Etapa antecipada automaticamente: reabra a etapa que antecipou antes de mudar o Estado do trabalho.');
  end if;

  if coalesce(public.programming_project_has_active_completion(p_tenant_id, v_target.project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de mudar o Estado do trabalho de outra etapa.');
  end if;

  if p_expected_updated_at is not null and v_target.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A etapa foi alterada por outro usuario. Recarregue antes de tentar novamente.',
      'currentUpdatedAt', v_target.updated_at);
  end if;

  if v_status = 'PENDENCIA' then
    -- Sai da sequencia: reclassify nunca mais vai selecionar esta linha
    -- enquanto ela for PENDENCIA, entao a classificacao tem que ser zerada
    -- aqui, na mesma escrita que a exclui do cursor.
    update public.programming
    set work_completion_status = v_status, etapa_number = null, etapa_unica = false, etapa_final = false,
        updated_by = p_actor_user_id
    where id = p_programming_id and tenant_id = p_tenant_id
    returning updated_at into v_updated_at;
  else
    update public.programming
    set work_completion_status = v_status, updated_by = p_actor_user_id
    where id = p_programming_id and tenant_id = p_tenant_id
    returning updated_at into v_updated_at;
  end if;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, null, p_actor_user_id, 'SET_WORK_COMPLETION_STATUS', null,
    jsonb_build_object('workCompletionStatus', jsonb_build_object('from', v_target.work_completion_status, 'to', v_status))
  );

  -- Reclassifica o projeto inteiro: garante que (a) quem sai de PENDENCIA
  -- reentra na sequencia com numero correto, (b) quem entra em PENDENCIA
  -- libera a vaga (renumeracao/Final) para as demais etapas ativas do
  -- projeto no mesmo commit, em vez de esperar a proxima escrita alheia.
  perform public.reclassify_project_programming_stages(p_tenant_id, v_target.project_id, p_actor_user_id);

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'message', 'Estado do trabalho atualizado com sucesso.'
  );
end;
$$;

-- Hardening de grants: revoga public/anon/authenticated, concede so a
-- service_role, mesmo padrao das migrations 311/313/314. CREATE OR REPLACE
-- preserva grants existentes no Postgres, mas reaplicar aqui e barato e
-- deixa a migration auto-contida/auditavel sem depender de estado anterior.
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'set_project_programming_work_completion_status'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'set_project_programming_work_completion_status'
  loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '316: funcao % ainda executavel por anon', v_fn;
    end if;

    if has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '316: funcao % ainda executavel por authenticated', v_fn;
    end if;
  end loop;
end;
$$;

-- Correcao de dado ja gravado: zera a classificacao de qualquer etapa ATIVA
-- que ja esteja em PENDENCIA hoje mas ainda carregue etapa_number/etapa_unica/
-- etapa_final de antes da transicao (o bug que este arquivo corrige, aplicado
-- retroativamente aos 0 casos atuais identificados na investigacao — mantido
-- por seguranca caso existam outros tenants/linhas fora da amostra checada).
update public.programming
set etapa_number = null, etapa_unica = false, etapa_final = false
where status in ('PROGRAMADA', 'REPROGRAMADA')
  and work_completion_status = 'PENDENCIA'
  and (etapa_number is not null or etapa_unica or etapa_final);
