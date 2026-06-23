-- 258_guard_interrupted_programming_completed_work_status.sql
-- Impede novas divergencias entre status operacional interrompido e Estado Trabalho concluido.
--
-- Regras:
-- - Programacao ADIADA/CANCELADA nao pode receber Estado Trabalho CONCLUIDO.
-- - Projeto com qualquer programacao CONCLUIDO nao pode ter nova transicao para ADIADA/CANCELADA.
-- - Nao altera dados legados; inconsistencias existentes devem ser revisadas por auditoria/backfill dedicado.

create or replace function public.enforce_interrupted_programming_completed_work_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_status text := upper(btrim(coalesce(new.status, '')));
  v_new_work_status text := public.normalize_programming_work_completion_code(new.work_completion_status);
  v_has_completed_project_programming boolean := false;
begin
  if tg_op not in ('INSERT', 'UPDATE') then
    return new;
  end if;

  if v_new_status not in ('ADIADA', 'CANCELADA') then
    return new;
  end if;

  if v_new_work_status in ('CONCLUIDO', 'COMPLETO')
    or coalesce(v_new_work_status, '') like 'CONCLUIDO%' then
    raise exception using
      errcode = '23514',
      message = 'Programacao ADIADA ou CANCELADA nao pode ter Estado Trabalho CONCLUIDO.',
      detail = format('programming_id=%s status=%s work_completion_status=%s', new.id, v_new_status, v_new_work_status);
  end if;

  if new.project_id is null then
    return new;
  end if;

  if tg_op = 'INSERT'
    or old.status is distinct from new.status then
    select exists (
      select 1
      from public.project_programming pp
      where pp.tenant_id = new.tenant_id
        and pp.project_id = new.project_id
        and pp.id <> new.id
        and (
          public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
          or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
        )
    )
    into v_has_completed_project_programming;

    if v_has_completed_project_programming then
      raise exception using
        errcode = '23514',
        message = 'Projeto com Estado Trabalho CONCLUIDO nao pode ser adiado ou cancelado.',
        detail = format('programming_id=%s project_id=%s target_status=%s', new.id, new.project_id, v_new_status);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists zz_trg_project_programming_block_interrupted_completed on public.project_programming;

create trigger zz_trg_project_programming_block_interrupted_completed
before insert or update of status, work_completion_status, work_completion_status_id
on public.project_programming
for each row
execute function public.enforce_interrupted_programming_completed_work_status();

revoke all on function public.enforce_interrupted_programming_completed_work_status() from public;
revoke all on function public.enforce_interrupted_programming_completed_work_status() from anon;
revoke all on function public.enforce_interrupted_programming_completed_work_status() from authenticated;
grant execute on function public.enforce_interrupted_programming_completed_work_status() to service_role;
