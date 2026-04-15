-- 157_add_programming_work_completion_status_uuid_sync.sql
-- Adiciona suporte por UUID para Estado Trabalho mantendo compatibilidade com o codigo legado.

alter table if exists public.project_programming
  add column if not exists work_completion_status_id uuid;

create unique index if not exists uq_programming_work_completion_catalog_tenant_id_id
  on public.programming_work_completion_catalog (tenant_id, id);

alter table if exists public.project_programming
  drop constraint if exists project_programming_work_completion_status_id_fkey;

alter table if exists public.project_programming
  add constraint project_programming_work_completion_status_id_fkey
  foreign key (tenant_id, work_completion_status_id)
  references public.programming_work_completion_catalog(tenant_id, id)
  on update cascade
  on delete restrict;

create index if not exists idx_project_programming_tenant_work_completion_status_id
  on public.project_programming (tenant_id, work_completion_status_id);

update public.project_programming
set work_completion_status = nullif(upper(btrim(coalesce(work_completion_status, ''))), '')
where work_completion_status is not null;

update public.project_programming pp
set work_completion_status_id = c.id
from public.programming_work_completion_catalog c
where c.tenant_id = pp.tenant_id
  and upper(btrim(c.code)) = upper(btrim(coalesce(pp.work_completion_status, '')))
  and pp.work_completion_status is not null
  and pp.work_completion_status_id is distinct from c.id;

update public.project_programming pp
set work_completion_status = c.code
from public.programming_work_completion_catalog c
where c.tenant_id = pp.tenant_id
  and c.id = pp.work_completion_status_id
  and (pp.work_completion_status is null or upper(btrim(pp.work_completion_status)) <> upper(btrim(c.code)));

drop function if exists public.sync_project_programming_work_completion_status_fields();

create or replace function public.sync_project_programming_work_completion_status_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_catalog record;
begin
  new.work_completion_status := nullif(upper(btrim(coalesce(new.work_completion_status, ''))), '');

  if new.work_completion_status is null and new.work_completion_status_id is null then
    return new;
  end if;

  if new.work_completion_status_id is not null then
    select c.id, c.code
    into v_catalog
    from public.programming_work_completion_catalog c
    where c.tenant_id = new.tenant_id
      and c.id = new.work_completion_status_id
    limit 1;

    if v_catalog.id is null then
      raise exception 'Estado Trabalho (UUID) invalido para o tenant atual.'
        using errcode = '23503';
    end if;

    new.work_completion_status_id := v_catalog.id;
    new.work_completion_status := v_catalog.code;
    return new;
  end if;

  select c.id, c.code
  into v_catalog
  from public.programming_work_completion_catalog c
  where c.tenant_id = new.tenant_id
    and upper(btrim(c.code)) = upper(btrim(coalesce(new.work_completion_status, '')))
  limit 1;

  if v_catalog.id is null then
    raise exception 'Estado Trabalho (codigo) invalido para o tenant atual.'
      using errcode = '23503';
  end if;

  new.work_completion_status_id := v_catalog.id;
  new.work_completion_status := v_catalog.code;
  return new;
end;
$$;

drop trigger if exists trg_project_programming_sync_work_completion_status_fields on public.project_programming;

create trigger trg_project_programming_sync_work_completion_status_fields
before insert or update of tenant_id, work_completion_status, work_completion_status_id
on public.project_programming
for each row
execute function public.sync_project_programming_work_completion_status_fields();
