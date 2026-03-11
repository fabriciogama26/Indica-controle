-- 034_use_people_for_project_contractor_responsible.sql
-- Remove o lookup de responsavel contratada e passa a usar people (apenas SUPERVISOR).

alter table if exists public.project
  add column if not exists contractor_supervisor_id uuid references public.people(id);

update public.project p
set contractor_supervisor_id = pe.id
from public.people pe
join public.job_titles jt
  on jt.id = pe.job_title_id
 and jt.tenant_id = pe.tenant_id
where p.contractor_supervisor_id is null
  and p.tenant_id = pe.tenant_id
  and pe.ativo = true
  and jt.ativo = true
  and upper(btrim(jt.code)) = 'SUPERVISOR'
  and upper(btrim(p.contractor_responsible)) = upper(btrim(pe.nome));

do $$
declare
  has_legacy_column boolean;
  has_new_column boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'project'
      and column_name = 'contractor_responsible_id'
  )
  into has_legacy_column;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'project'
      and column_name = 'contractor_supervisor_id'
  )
  into has_new_column;

  if has_legacy_column and has_new_column then
    execute 'alter table public.project drop column contractor_responsible_id';
    has_legacy_column := false;
  end if;

  if has_new_column and not has_legacy_column then
    execute 'alter table public.project rename column contractor_supervisor_id to contractor_responsible_id';
  end if;
end $$;

create index if not exists idx_project_contractor_responsible_id
  on public.project (tenant_id, contractor_responsible_id);

drop table if exists public.project_contractor_responsibles cascade;
