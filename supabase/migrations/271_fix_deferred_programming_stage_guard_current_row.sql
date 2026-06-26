-- 271_fix_deferred_programming_stage_guard_current_row.sql
-- Corrige a guarda diferida criada na 270 para validar a linha final persistida.
-- Em constraint trigger diferida, NEW representa o estado do evento enfileirado;
-- a RPC full pode inserir a linha sem ETAPA e preencher ETAPA/flags depois, no mesmo commit.

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
    and v_etapa_number is null
    and v_etapa_unica = false
    and v_etapa_final = false then
    raise exception 'Programacao ativa exige ETAPA numerica, ETAPA UNICA ou ETAPA FINAL.'
      using
        errcode = '23514',
        constraint = 'project_programming_active_stage_required_check';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_project_programming_active_stage_required()
  from public, anon, authenticated;

grant execute on function public.enforce_project_programming_active_stage_required()
  to service_role;
