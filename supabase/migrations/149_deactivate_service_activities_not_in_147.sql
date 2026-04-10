-- 149_deactivate_service_activities_not_in_147.sql
-- Desativa atividades do tenant alvo que nao estao na carga de codigos da migration 147.

begin;

do $$
declare
  v_tenant_id uuid;
  v_distinct_tenants integer;
  v_missing_147_codes integer;
  v_deactivated_count integer;
  v_reason text := 'INATIVADO PELA MIGRATION 149 (CODIGO FORA DA CARGA 147)';
begin
  create temp table tmp_147_codes (
    code text primary key
  ) on commit drop;

  insert into tmp_147_codes (code)
  values
    ('ABR103'),
    ('ABR115'),
    ('ABR116'),
    ('ABR117'),
    ('ABR118'),
    ('ABR119'),
    ('ABR120'),
    ('ABR204'),
    ('ABR205'),
    ('ABR206'),
    ('ABR207'),
    ('ABR217'),
    ('ABR223'),
    ('ABR224'),
    ('ABR236'),
    ('ABR241'),
    ('ABR243'),
    ('ABR244'),
    ('ABR316'),
    ('ABR508'),
    ('ABR509'),
    ('ABR510'),
    ('ABR511'),
    ('ABR512'),
    ('ABR513'),
    ('ABR514'),
    ('ABR515'),
    ('ABR516'),
    ('ABR517'),
    ('ABR801'),
    ('ABR802'),
    ('ABR805'),
    ('ABR806'),
    ('ABR809'),
    ('AHO102'),
    ('AHO103'),
    ('AHO108'),
    ('AHO110'),
    ('AHO111'),
    ('AHO112'),
    ('AHO113'),
    ('AHO121'),
    ('AHO122'),
    ('AHO123'),
    ('AHO124'),
    ('AHO125'),
    ('AHO126'),
    ('AHO127'),
    ('AHO128'),
    ('AHO132'),
    ('AHO133'),
    ('AHO137'),
    ('AHO138'),
    ('AHO139'),
    ('AHO201'),
    ('AHO202'),
    ('AHO203'),
    ('AHO204'),
    ('AHO205'),
    ('AHO207'),
    ('AHO208'),
    ('AHO210'),
    ('AHO211'),
    ('AHO212'),
    ('AHO215'),
    ('AHO217'),
    ('AHO218'),
    ('AHO219'),
    ('AHO220'),
    ('AHO221'),
    ('AHO222'),
    ('AHO223'),
    ('AHO226'),
    ('AHO239'),
    ('AHO240'),
    ('AHO243'),
    ('AHO244'),
    ('AHO256'),
    ('AHO327'),
    ('AHO336'),
    ('AHO717'),
    ('AHO720'),
    ('AHO722'),
    ('AHO730'),
    ('AHO804'),
    ('AHO805'),
    ('AHO806'),
    ('AHO807'),
    ('AHO812'),
    ('AHO813'),
    ('AHO814'),
    ('AHO815'),
    ('AHO816'),
    ('AHO818'),
    ('AHO819'),
    ('AHO820'),
    ('AHO821'),
    ('AHO823'),
    ('AHO824'),
    ('AHO826'),
    ('AHO828'),
    ('CHO501'),
    ('CHO504'),
    ('CHO508'),
    ('FBR102'),
    ('FBR104'),
    ('FBR106'),
    ('FBR118'),
    ('FBR119'),
    ('FHO103'),
    ('FHO107'),
    ('FHO110'),
    ('FHO112'),
    ('FHO115'),
    ('GHO101'),
    ('GHO105'),
    ('GHO106'),
    ('TBR117'),
    ('TBR128'),
    ('TBR129'),
    ('TBR132'),
    ('THO102'),
    ('THO103'),
    ('THO105'),
    ('THO107'),
    ('THO108'),
    ('THO110'),
    ('THO112'),
    ('THO115');

  with tenant_candidates as (
    select distinct sa.tenant_id
    from public.service_activities sa
    join tmp_147_codes c
      on upper(btrim(sa.code)) = c.code
  )
  select
    count(*)::integer,
    (array_agg(tc.tenant_id order by tc.tenant_id))[1]
  into v_distinct_tenants, v_tenant_id
  from tenant_candidates tc;

  if v_distinct_tenants <> 1 then
    raise exception 'Nao foi possivel inferir tenant unico para desativacao. Tenants encontrados: %', v_distinct_tenants;
  end if;

  select count(*)
  into v_missing_147_codes
  from tmp_147_codes c
  left join public.service_activities sa
    on sa.tenant_id = v_tenant_id
   and upper(btrim(sa.code)) = c.code
  where sa.id is null;

  if v_missing_147_codes > 0 then
    raise notice 'Existem % codigos da lista 147 ainda ausentes no tenant alvo %.', v_missing_147_codes, v_tenant_id;
  end if;

  with deactivated as (
    update public.service_activities sa
    set
      ativo = false,
      cancellation_reason = v_reason,
      canceled_at = now(),
      canceled_by = null,
      updated_at = now()
    where sa.tenant_id = v_tenant_id
      and sa.ativo = true
      and upper(btrim(sa.code)) not in (
        select code
        from tmp_147_codes
      )
    returning sa.id, sa.tenant_id, sa.code
  )
  insert into public.app_entity_history (
    tenant_id,
    module_key,
    entity_table,
    entity_id,
    entity_code,
    change_type,
    reason,
    changes,
    metadata
  )
  select
    d.tenant_id,
    'atividades'::text,
    'service_activities'::text,
    d.id,
    d.code,
    'CANCEL'::text,
    v_reason,
    jsonb_build_object(
      'ativo', jsonb_build_object('from', true, 'to', false)
    ),
    jsonb_build_object(
      'source', 'migration_149_deactivate_service_activities_not_in_147'
    )
  from deactivated d;

  get diagnostics v_deactivated_count = row_count;
  raise notice 'Atividades desativadas (fora da 147): %', v_deactivated_count;
end;
$$;

commit;
