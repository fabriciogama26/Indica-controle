-- 423_backfill_measurement_project_activity_indicators.sql
-- Semeia os codigos indicadores da Medicao para tenants sem nenhuma configuracao.
--
-- POR QUE ESTA MIGRATION EXISTE
-- ---------------------------------------------------------------------------
-- A 293 criou `measurement_project_activity_indicators` e semeou `AHO717`/`AHO720`
-- com `cross join public.tenants`, ou seja, somente para os tenants que existiam
-- naquele momento. Tenant criado depois ficou com zero linhas na tabela.
--
-- O efeito na tela: `GET /api/medicao/project-activity-usage` devolve
-- `items: []`, o `.map()` do MeasurementPageView nao renderiza chip nenhum e o
-- cadastro da Medicao mostra apenas o espaco reservado embaixo do campo
-- `Projeto`. Nao ha erro visivel, porque a resposta e 200 com lista vazia.
--
-- O que este backfill faz: insere os dois codigos padrao apenas para tenants que
-- nao tem NENHUMA linha na tabela. Tenant que ja configurou os proprios codigos
-- (inclusive quem desativou algum de proposito) nao e tocado.

insert into public.measurement_project_activity_indicators (tenant_id, activity_code, sort_order, is_active)
select t.id, item.activity_code, item.sort_order, true
from public.tenants t
cross join (
  values
    ('AHO717'::text, 10),
    ('AHO720'::text, 20)
) as item(activity_code, sort_order)
where not exists (
  select 1
  from public.measurement_project_activity_indicators existing
  where existing.tenant_id = t.id
)
on conflict (tenant_id, activity_code) do nothing;

do $$
begin
  if exists (
    select 1
    from public.tenants t
    left join public.measurement_project_activity_indicators indicator
      on indicator.tenant_id = t.id
    where indicator.tenant_id is null
  ) then
    raise exception '423: existe tenant sem codigo indicador da Medicao apos o backfill';
  end if;
end;
$$;
