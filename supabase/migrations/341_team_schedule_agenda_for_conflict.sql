-- 341_team_schedule_agenda_for_conflict.sql
-- Fase 1 da sugestao de horario livre no conflito de agenda de equipe.
--
-- Problema: `programming_team_schedule_conflict` (317) JA devolve a etapa
-- conflitante com projeto e horario, mas todos os chamadores fazem `limit 1` e
-- so testam `programming_id is not null`. O usuario recebe apenas
-- "Equipe ja tem alocacao ativa com horario sobreposto nesta data." — sem saber
-- COM QUEM conflitou nem QUANDO a equipe esta livre.
--
-- Esta migration NAO altera nenhuma RPC transacional. Cria uma funcao de LEITURA
-- que devolve a agenda ocupada das equipes numa data, e o backend usa esse
-- retorno para enriquecer a mensagem quando a RPC responde TEAM_TIME_CONFLICT.
-- Assim o caminho de escrita (save/add team/adiar/corrigir data) fica intocado.
--
-- Expediente: NAO e assumido aqui de proposito. A janela de trabalho pode variar
-- (por equipe/tipo de servico) e essa decisao ficou para a fase 2. Por isso a
-- funcao devolve apenas os intervalos OCUPADOS — quem monta o texto deriva as
-- folgas ENTRE eles e os extremos ("antes de HH:MM" / "a partir de HH:MM"), sem
-- inventar limite de inicio ou fim de dia.
--
-- Resolucao de parametros:
--   - p_team_ids preenchido  -> usa essas equipes (caso do save com varias equipes);
--     senao, usa as equipes ATIVAS de p_programming_id (caso do adicionar equipe,
--     adiar e corrigir data, onde o front so tem a etapa).
--   - p_execution_date/p_start_time/p_end_time nulos caem para os valores da
--     propria etapa p_programming_id (a janela pretendida e a da etapa).
--   - p_exclude_programming_id remove a propria etapa da lista de ocupacao, para
--     ela nao aparecer conflitando consigo mesma.
--
-- Status considerados ocupando agenda: PROGRAMADA e REPROGRAMADA — mesmos da
-- `programming_team_schedule_conflict`, menos o valor morto 'PENDENCIA' (a 318
-- tirou PENDENCIA do CHECK de status; pendencia virou a flag is_pendencia e a
-- etapa continua com status de agenda, entao continua ocupando normalmente).

create or replace function public.programming_team_schedule_agenda(
  p_tenant_id uuid,
  p_team_ids uuid[] default null,
  p_programming_id uuid default null,
  p_execution_date date default null,
  p_start_time time default null,
  p_end_time time default null,
  p_exclude_programming_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_stage record;
  v_date date := p_execution_date;
  v_start time := p_start_time;
  v_end time := p_end_time;
  v_team_ids uuid[] := p_team_ids;
  v_exclude uuid := p_exclude_programming_id;
  v_teams jsonb;
begin
  if p_tenant_id is null then
    return jsonb_build_object('requested', null, 'teams', '[]'::jsonb);
  end if;

  if p_programming_id is not null then
    select id, execution_date, start_time, end_time
    into v_stage
    from public.programming
    where id = p_programming_id and tenant_id = p_tenant_id;

    if v_stage.id is not null then
      v_date := coalesce(v_date, v_stage.execution_date);
      v_start := coalesce(v_start, v_stage.start_time);
      v_end := coalesce(v_end, v_stage.end_time);
      v_exclude := coalesce(v_exclude, v_stage.id);

      if v_team_ids is null or cardinality(v_team_ids) = 0 then
        select array_agg(distinct pt.team_id)
        into v_team_ids
        from public.programming_team pt
        where pt.tenant_id = p_tenant_id
          and pt.programming_id = p_programming_id
          and pt.status = 'ATIVA';
      end if;
    end if;
  end if;

  if v_date is null or v_team_ids is null or cardinality(v_team_ids) = 0 then
    return jsonb_build_object(
      'requested', jsonb_build_object('executionDate', v_date, 'startTime', v_start, 'endTime', v_end),
      'teams', '[]'::jsonb
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'teamId', agenda.team_id,
        'teamName', agenda.team_name,
        'busy', agenda.busy
      )
      order by agenda.team_name
    ),
    '[]'::jsonb
  )
  into v_teams
  from (
    select
      t.id as team_id,
      t.name as team_name,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'programmingId', slot.id,
              'projectCode', slot.sob,
              'startTime', slot.start_time,
              'endTime', slot.end_time
            )
            order by slot.start_time, slot.end_time
          )
          from (
            select p.id, p.start_time, p.end_time, pr.sob
            from public.programming_team pt
            join public.programming p
              on p.id = pt.programming_id and p.tenant_id = pt.tenant_id
            left join public.project pr
              on pr.id = p.project_id and pr.tenant_id = p.tenant_id
            where pt.tenant_id = p_tenant_id
              and pt.team_id = t.id
              and pt.status = 'ATIVA'
              and p.status in ('PROGRAMADA', 'REPROGRAMADA')
              and p.execution_date = v_date
              and p.start_time is not null
              and p.end_time is not null
              and (v_exclude is null or p.id <> v_exclude)
          ) slot
        ),
        '[]'::jsonb
      ) as busy
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.id = any (v_team_ids)
  ) agenda;

  return jsonb_build_object(
    'requested', jsonb_build_object('executionDate', v_date, 'startTime', v_start, 'endTime', v_end),
    'teams', coalesce(v_teams, '[]'::jsonb)
  );
end;
$$;


-- Hardening de grants: mesma politica das demais SECURITY DEFINER do modulo —
-- so `service_role` executa; o backend chama com validacao explicita de tenant.
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'programming_team_schedule_agenda'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);

    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '341: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
