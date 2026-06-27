-- 275_harden_programming_stage_state_integrity.sql
-- Fecha a integridade de ETAPA para programacoes ativas.
--
-- Regra final para status PROGRAMADA/REPROGRAMADA:
-- 1) etapa_number > 0, etapa_unica = false, etapa_final = false
-- 2) etapa_number is null, etapa_unica = true, etapa_final = false
-- 3) etapa_number is null, etapa_unica = false, etapa_final = true
--
-- A regra fica em constraint trigger diferida porque as RPCs full podem criar a
-- linha base e preencher ETAPA/flags antes do commit da mesma transacao.

do $$
declare
  v_invalid_count integer;
  v_details text;
begin
  select count(*)
  into v_invalid_count
  from public.project_programming pp
  where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
    and not (
      (
        pp.etapa_number is not null
        and pp.etapa_number > 0
        and coalesce(pp.etapa_unica, false) = false
        and coalesce(pp.etapa_final, false) = false
      )
      or (
        pp.etapa_number is null
        and coalesce(pp.etapa_unica, false) = true
        and coalesce(pp.etapa_final, false) = false
      )
      or (
        pp.etapa_number is null
        and coalesce(pp.etapa_unica, false) = false
        and coalesce(pp.etapa_final, false) = true
      )
    );

  if v_invalid_count > 0 then
    select string_agg(
      format(
        'id=%s tenant_id=%s project_id=%s team_id=%s status=%s execution_date=%s etapa_number=%s etapa_unica=%s etapa_final=%s',
        invalid.id,
        invalid.tenant_id,
        invalid.project_id,
        invalid.team_id,
        invalid.status,
        invalid.execution_date,
        coalesce(invalid.etapa_number::text, 'null'),
        coalesce(invalid.etapa_unica, false)::text,
        coalesce(invalid.etapa_final, false)::text
      ),
      E'; '
      order by invalid.tenant_id, invalid.execution_date, invalid.id
    )
    into v_details
    from (
      select
        pp.id,
        pp.tenant_id,
        pp.project_id,
        pp.team_id,
        pp.status,
        pp.execution_date,
        pp.etapa_number,
        pp.etapa_unica,
        pp.etapa_final
      from public.project_programming pp
      where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
        and not (
          (
            pp.etapa_number is not null
            and pp.etapa_number > 0
            and coalesce(pp.etapa_unica, false) = false
            and coalesce(pp.etapa_final, false) = false
          )
          or (
            pp.etapa_number is null
            and coalesce(pp.etapa_unica, false) = true
            and coalesce(pp.etapa_final, false) = false
          )
          or (
            pp.etapa_number is null
            and coalesce(pp.etapa_unica, false) = false
            and coalesce(pp.etapa_final, false) = true
          )
        )
      order by pp.tenant_id, pp.execution_date, pp.id
      limit 20
    ) invalid;

    raise exception
      'Existem % programacoes ativas com combinacao invalida de ETAPA. Corrija os dados antes de aplicar a migration 275. Detalhes: %',
      v_invalid_count,
      v_details
      using errcode = 'P0001';
  end if;
end;
$$;

alter table public.project_programming
  drop constraint if exists project_programming_active_stage_required_check;

create or replace function public.enforce_project_programming_active_stage_required()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_etapa_number integer;
  v_etapa_unica boolean;
  v_etapa_final boolean;
begin
  select
    pp.status,
    pp.etapa_number,
    coalesce(pp.etapa_unica, false),
    coalesce(pp.etapa_final, false)
  into
    v_status,
    v_etapa_number,
    v_etapa_unica,
    v_etapa_final
  from public.project_programming pp
  where pp.tenant_id = new.tenant_id
    and pp.id = new.id;

  if not found then
    return new;
  end if;

  if v_status in ('PROGRAMADA', 'REPROGRAMADA')
    and not (
      (
        v_etapa_number is not null
        and v_etapa_number > 0
        and v_etapa_unica = false
        and v_etapa_final = false
      )
      or (
        v_etapa_number is null
        and v_etapa_unica = true
        and v_etapa_final = false
      )
      or (
        v_etapa_number is null
        and v_etapa_unica = false
        and v_etapa_final = true
      )
    ) then
    raise exception
      'Programacao ativa exige exatamente uma classificacao de ETAPA: numerica maior que zero, ETAPA UNICA ou ETAPA FINAL.'
      using
        errcode = '23514',
        constraint = 'project_programming_active_stage_valid_check',
        detail = format(
          'id=%s status=%s etapa_number=%s etapa_unica=%s etapa_final=%s',
          new.id,
          v_status,
          coalesce(v_etapa_number::text, 'null'),
          v_etapa_unica::text,
          v_etapa_final::text
        );
  end if;

  return new;
end;
$$;

drop trigger if exists zz_trg_project_programming_active_stage_required
  on public.project_programming;

drop trigger if exists project_programming_active_stage_valid_check
  on public.project_programming;

create constraint trigger project_programming_active_stage_valid_check
after insert or update of status, etapa_number, etapa_unica, etapa_final
on public.project_programming
deferrable initially deferred
for each row
execute function public.enforce_project_programming_active_stage_required();

comment on trigger project_programming_active_stage_valid_check on public.project_programming is
  'Valida no commit que programacoes ativas estejam em exatamente um estado de ETAPA: numerica > 0, ETAPA UNICA ou ETAPA FINAL.';

revoke all on function public.enforce_project_programming_active_stage_required()
  from public, anon, authenticated;

grant execute on function public.enforce_project_programming_active_stage_required()
  to service_role;
