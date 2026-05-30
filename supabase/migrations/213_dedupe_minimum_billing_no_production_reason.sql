-- 213_dedupe_minimum_billing_no_production_reason.sql
-- Remove duplicidade visual/operacional do motivo Garantia de faturamento minimo por tenant.

do $$
declare
  v_tenant record;
  v_keeper_id uuid;
begin
  for v_tenant in
    select distinct tenant_id
    from public.measurement_no_production_reasons
    where public.normalize_minimum_billing_token(code) in ('GARANTIAFATURAMENTOMINIMO', 'GARANTIADEFATURAMENTOMINIMO')
       or public.normalize_minimum_billing_token(name) in ('GARANTIAFATURAMENTOMINIMO', 'GARANTIADEFATURAMENTOMINIMO')
       or (
        public.normalize_minimum_billing_token(name) like '%GARANTIA%'
        and public.normalize_minimum_billing_token(name) like '%FATURAMENTO%'
        and public.normalize_minimum_billing_token(name) like '%MINIMO%'
       )
  loop
    select id
    into v_keeper_id
    from public.measurement_no_production_reasons
    where tenant_id = v_tenant.tenant_id
      and (
        public.normalize_minimum_billing_token(code) in ('GARANTIAFATURAMENTOMINIMO', 'GARANTIADEFATURAMENTOMINIMO')
        or public.normalize_minimum_billing_token(name) in ('GARANTIAFATURAMENTOMINIMO', 'GARANTIADEFATURAMENTOMINIMO')
        or (
          public.normalize_minimum_billing_token(name) like '%GARANTIA%'
          and public.normalize_minimum_billing_token(name) like '%FATURAMENTO%'
          and public.normalize_minimum_billing_token(name) like '%MINIMO%'
        )
      )
    order by
      case when code = 'GARANTIA_FATURAMENTO_MINIMO' then 0 else 1 end,
      sort_order nulls last,
      created_at,
      id
    limit 1;

    update public.project_measurement_orders
    set no_production_reason_id = v_keeper_id
    where tenant_id = v_tenant.tenant_id
      and no_production_reason_id in (
        select id
        from public.measurement_no_production_reasons
        where tenant_id = v_tenant.tenant_id
          and id <> v_keeper_id
          and (
            public.normalize_minimum_billing_token(code) in ('GARANTIAFATURAMENTOMINIMO', 'GARANTIADEFATURAMENTOMINIMO')
            or public.normalize_minimum_billing_token(name) in ('GARANTIAFATURAMENTOMINIMO', 'GARANTIADEFATURAMENTOMINIMO')
            or (
              public.normalize_minimum_billing_token(name) like '%GARANTIA%'
              and public.normalize_minimum_billing_token(name) like '%FATURAMENTO%'
              and public.normalize_minimum_billing_token(name) like '%MINIMO%'
            )
          )
      );

    update public.project_billing_orders
    set no_production_reason_id = v_keeper_id
    where tenant_id = v_tenant.tenant_id
      and no_production_reason_id in (
        select id
        from public.measurement_no_production_reasons
        where tenant_id = v_tenant.tenant_id
          and id <> v_keeper_id
          and (
            public.normalize_minimum_billing_token(code) in ('GARANTIAFATURAMENTOMINIMO', 'GARANTIADEFATURAMENTOMINIMO')
            or public.normalize_minimum_billing_token(name) in ('GARANTIAFATURAMENTOMINIMO', 'GARANTIADEFATURAMENTOMINIMO')
            or (
              public.normalize_minimum_billing_token(name) like '%GARANTIA%'
              and public.normalize_minimum_billing_token(name) like '%FATURAMENTO%'
              and public.normalize_minimum_billing_token(name) like '%MINIMO%'
            )
          )
      );

    update public.project_asbuilt_measurement_orders
    set no_production_reason_id = v_keeper_id
    where tenant_id = v_tenant.tenant_id
      and no_production_reason_id in (
        select id
        from public.measurement_no_production_reasons
        where tenant_id = v_tenant.tenant_id
          and id <> v_keeper_id
          and (
            public.normalize_minimum_billing_token(code) in ('GARANTIAFATURAMENTOMINIMO', 'GARANTIADEFATURAMENTOMINIMO')
            or public.normalize_minimum_billing_token(name) in ('GARANTIAFATURAMENTOMINIMO', 'GARANTIADEFATURAMENTOMINIMO')
            or (
              public.normalize_minimum_billing_token(name) like '%GARANTIA%'
              and public.normalize_minimum_billing_token(name) like '%FATURAMENTO%'
              and public.normalize_minimum_billing_token(name) like '%MINIMO%'
            )
          )
      );

    update public.measurement_no_production_reasons
    set
      code = case
        when id = v_keeper_id then code
        when code like '%_DUP_%' then code
        else code || '_DUP_' || substr(replace(id::text, '-', ''), 1, 8)
      end,
      name = case
        when id = v_keeper_id then 'Garantia de faturamento minimo'
        else 'Motivo duplicado inativo ' || substr(replace(id::text, '-', ''), 1, 8)
      end,
      is_active = id = v_keeper_id,
      sort_order = case when id = v_keeper_id then 50 else sort_order end,
      updated_at = now()
    where tenant_id = v_tenant.tenant_id
      and (
        public.normalize_minimum_billing_token(code) in ('GARANTIAFATURAMENTOMINIMO', 'GARANTIADEFATURAMENTOMINIMO')
        or public.normalize_minimum_billing_token(name) in ('GARANTIAFATURAMENTOMINIMO', 'GARANTIADEFATURAMENTOMINIMO')
        or (
          public.normalize_minimum_billing_token(name) like '%GARANTIA%'
          and public.normalize_minimum_billing_token(name) like '%FATURAMENTO%'
          and public.normalize_minimum_billing_token(name) like '%MINIMO%'
        )
      );
  end loop;
end;
$$;
