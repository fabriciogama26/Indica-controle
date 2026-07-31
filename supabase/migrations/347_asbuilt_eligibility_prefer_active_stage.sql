-- 347_asbuilt_eligibility_prefer_active_stage.sql
-- Fase 1b do plano de correcao de reutilizacao de data (346): revisao do
-- primeiro consumidor real que tratava projeto+data como identidade unica
-- absoluta e ficou exposto pela 346.
--
-- O PROBLEMA
-- ---------------------------------------------------------------------------
-- get_cronograma_asbuilt_project_ids (344) resolve "o ultimo estado do
-- trabalho do projeto" com:
--   distinct on (p.project_id) ... order by p.project_id, p.execution_date desc, p.updated_at desc
-- Antes da 346 isso era seguro: so podia existir 1 etapa por projeto+data,
-- entao "maior execution_date" identificava uma linha so, sem ambiguidade.
-- A 346 passou a permitir uma etapa HISTORICA (CANCELADA/ADIADA/ANTECIPADA)
-- coexistir com uma etapa ATIVA na MESMA data. Se isso acontecer no maior
-- execution_date do projeto, o desempate por updated_at pode escolher a
-- etapa historica (ex.: uma ANTECIPADA antiga, que legitimamente conta para
-- elegibilidade — decisao preservada da 305/344) no lugar de uma etapa ATIVA
-- nova que acabou de reusar aquela data, decidindo elegibilidade de As Built
-- com o Estado do Trabalho errado.
--
-- FORA DE ESCOPO NESTA MIGRATION (ainda nao afetados por 346)
-- ---------------------------------------------------------------------------
-- Controle APR (project_apr_controls.programming_id) e Medicao
-- (project_measurement_orders.programming_id) AINDA referenciam a tabela
-- LEGADA `project_programming` (226 e 112), nao `programming` — confirmado
-- nesta rodada, nenhuma migration entre 226/112 e 345 repontou essas FKs.
-- Portanto nao leem `programming` hoje e nao sao afetados pela 346. Quando a
-- "Fase 5" desses dois modulos for feita (cutover para `programming`, mesmo
-- padrao desta migration para o Cronograma), a resolucao "ultima etapa por
-- projeto" precisa nascer JA com o desempate por status ativo abaixo — nao
-- repetir o gap que esta migration corrige aqui.
--
-- FIX
-- ---------------------------------------------------------------------------
-- Mesmo corpo da 344, com UM desempate a mais entre execution_date e
-- updated_at: status ATIVO (PROGRAMADA/REPROGRAMADA) vence qualquer outro
-- status na mesma data. ANTECIPADA continua contando quando NAO houver etapa
-- ativa competindo na mesma data (regra de negocio preservada da 305/344,
-- nao alterada aqui).
create or replace function public.get_cronograma_asbuilt_project_ids(p_tenant_id uuid)
returns table(project_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (p.project_id)
      p.project_id,
      upper(regexp_replace(btrim(coalesce(p.work_completion_status, '')), '\s+', '_', 'g')) as status_code
    from public.programming p
    where p.tenant_id = p_tenant_id
      and p.status <> 'CANCELADA'
      and nullif(btrim(coalesce(p.work_completion_status, '')), '') is not null
    order by
      p.project_id,
      p.execution_date desc,
      (case when p.status in ('PROGRAMADA', 'REPROGRAMADA') then 0 else 1 end),
      p.updated_at desc
  )
  select latest.project_id
  from latest
  where replace(latest.status_code, 'BENFICIO', 'BENEFICIO')
    in ('CONCLUIDO', 'CONCLUÍDO', 'PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO', 'BENEFICIO_ATINGIDO');
$$;

-- Grants (mesmo padrao das migrations 314/316/344): so service_role.
revoke all on function public.get_cronograma_asbuilt_project_ids(uuid)
from public, anon, authenticated;
grant execute on function public.get_cronograma_asbuilt_project_ids(uuid)
to service_role;

do $$
declare
  v_fn regprocedure := 'public.get_cronograma_asbuilt_project_ids(uuid)'::regprocedure;
begin
  if has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception '347: funcao % ainda executavel por anon/authenticated', v_fn;
  end if;
end;
$$;
