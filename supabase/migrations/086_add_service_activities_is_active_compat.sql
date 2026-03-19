-- 086_add_service_activities_is_active_compat.sql
-- Compatibilidade entre `ativo` e `is_active` em service_activities para RPCs legadas.

alter table if exists public.service_activities
  add column if not exists is_active boolean;

update public.service_activities
set is_active = coalesce(is_active, ativo, true)
where is_active is null;

alter table if exists public.service_activities
  alter column is_active set default true;

alter table if exists public.service_activities
  alter column is_active set not null;

drop function if exists public.sync_service_activities_active_flags();

create or replace function public.sync_service_activities_active_flags()
returns trigger
language plpgsql
as $$
begin
  if new.ativo is null and new.is_active is null then
    new.ativo := true;
    new.is_active := true;
    return new;
  end if;

  if new.ativo is null then
    new.ativo := coalesce(new.is_active, true);
  end if;

  if new.is_active is null then
    new.is_active := coalesce(new.ativo, true);
  end if;

  if coalesce(new.ativo, true) is distinct from coalesce(new.is_active, true) then
    new.is_active := coalesce(new.ativo, true);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_service_activities_sync_active_flags on public.service_activities;

create trigger trg_service_activities_sync_active_flags
before insert or update on public.service_activities
for each row
execute function public.sync_service_activities_active_flags();

update public.service_activities
set
  ativo = coalesce(ativo, is_active, true),
  is_active = coalesce(ativo, is_active, true)
where ativo is distinct from is_active
   or ativo is null
   or is_active is null;

alter table if exists public.service_activities
  drop constraint if exists service_activities_active_flags_consistency_check;

alter table if exists public.service_activities
  add constraint service_activities_active_flags_consistency_check
  check (ativo = is_active);
