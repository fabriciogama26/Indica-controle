-- 148_update_service_activities_voice_fields_ja10183409.sql
-- Atualiza unit, voice_point e unit_value em service_activities
-- para os codigos informados (origem: anexos_JA10183409_as_total.xlsx e VOZES_JA10183409.xlsx).
-- Regra unit_value por group_name:
-- SOT AEREA = 225.92 | SOC = 151.83 | PODA = 215.26 | LLEE/LINHA VIVA = 413.32 | SEGURANCA = 62.31

begin;

do $$
declare
  v_missing_codes text;
  v_unknown_groups text;
begin
  create temp table tmp_voice_updates (
    code text not null,
    unit text not null,
    voice_point numeric(14, 6) not null
  ) on commit drop;

  insert into tmp_voice_updates (code, unit, voice_point)
  values
    ('CHO504', 'UNID.', 4.00::numeric(14, 6)),
    ('FBR106', 'UNID.', 0.80::numeric(14, 6)),
    ('ABR517', 'UNID.', 3.36::numeric(14, 6)),
    ('ABR516', 'UNID.', 4.20::numeric(14, 6)),
    ('CHO501', 'UNID.', 2.80::numeric(14, 6)),
    ('AHO239', 'UNID.', 1.60::numeric(14, 6)),
    ('AHO820', 'UNID.', 2.00::numeric(14, 6)),
    ('AHO722', 'UNID.', 0.06::numeric(14, 6)),
    ('GHO101', 'UNID.', 25.00::numeric(14, 6)),
    ('AHO256', 'ml de rede', 0.11::numeric(14, 6)),
    ('ABR236', 'UNID.', 0.50::numeric(14, 6)),
    ('ABR224', 'UNID.', 3.34::numeric(14, 6)),
    ('ABR223', 'UNID.', 3.34::numeric(14, 6)),
    ('AHO826', 'UNID.', 9.60::numeric(14, 6)),
    ('AHO207', 'ml de rede', 0.22::numeric(14, 6)),
    ('AHO215', 'UNID.', 2.00::numeric(14, 6)),
    ('AHO828', 'UNID.', 15.20::numeric(14, 6)),
    ('FBR104', 'UNID.', 1.60::numeric(14, 6)),
    ('AHO815', 'UNID.', 2.20::numeric(14, 6)),
    ('AHO226', 'UNID.', 2.30::numeric(14, 6)),
    ('AHO819', 'UNID.', 3.50::numeric(14, 6)),
    ('AHO102', 'UNID.', 15.70::numeric(14, 6)),
    ('CHO508', 'UNID.', 1.50::numeric(14, 6));

  -- Valida se todos os codigos da carga existem ao menos uma vez na base.
  select string_agg(src.code, ', ' order by src.code)
  into v_missing_codes
  from tmp_voice_updates src
  where not exists (
    select 1
    from public.service_activities sa
    where upper(btrim(sa.code)) = upper(btrim(src.code))
  );

  if v_missing_codes is not null then
    raise exception 'Codigos nao encontrados em service_activities: %', v_missing_codes;
  end if;

  -- Valida se os group_name dos registros-alvo estao mapeados para valor do ponto.
  with target_rows as (
    select
      sa.code,
      regexp_replace(
        translate(
          upper(btrim(coalesce(sa.group_name, ''))),
          U&'\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7',
          'AAAAAEEEEIIIIOOOOOUUUUC'
        ),
        '[^A-Z0-9]+',
        '',
        'g'
      ) as normalized_group
    from public.service_activities sa
    join tmp_voice_updates src
      on upper(btrim(src.code)) = upper(btrim(sa.code))
  ),
  unknown_groups as (
    select distinct
      tr.code,
      tr.normalized_group
    from target_rows tr
    where tr.normalized_group not in ('SOTAEREA', 'SOC', 'PODA', 'LLEE', 'LINHAVIVA', 'SEGURANCA')
  )
  select string_agg(ug.code || '->' || ug.normalized_group, ', ' order by ug.code)
  into v_unknown_groups
  from unknown_groups ug;

  if v_unknown_groups is not null then
    raise exception 'Existe group_name sem regra de VALOR DO PONTO para os codigos: %', v_unknown_groups;
  end if;

  update public.service_activities sa
  set
    unit = src.unit,
    voice_point = src.voice_point,
    unit_value = case
      when src.normalized_group in ('SOTAEREA') then 225.92::numeric(14, 2)
      when src.normalized_group in ('SOC') then 151.83::numeric(14, 2)
      when src.normalized_group in ('PODA') then 215.26::numeric(14, 2)
      when src.normalized_group in ('LLEE', 'LINHAVIVA') then 413.32::numeric(14, 2)
      when src.normalized_group in ('SEGURANCA') then 62.31::numeric(14, 2)
      else sa.unit_value
    end,
    updated_at = now()
  from (
    select
      src.code,
      src.unit,
      src.voice_point,
      regexp_replace(
        translate(
          upper(btrim(coalesce(sa2.group_name, ''))),
          U&'\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7',
          'AAAAAEEEEIIIIOOOOOUUUUC'
        ),
        '[^A-Z0-9]+',
        '',
        'g'
      ) as normalized_group,
      sa2.tenant_id
    from tmp_voice_updates src
    join public.service_activities sa2
      on upper(btrim(sa2.code)) = upper(btrim(src.code))
  ) src
  where sa.tenant_id = src.tenant_id
    and upper(btrim(sa.code)) = upper(btrim(src.code));
end;
$$;

commit;
