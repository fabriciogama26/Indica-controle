-- 056_prevent_people_duplicate_identity.sql
-- Bloqueia cadastro/edicao duplicada em people por:
-- tenant + nome + matricula + cargo + tipo + nivel.

create or replace function public.prevent_people_duplicate_identity()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.people p
    where p.tenant_id = new.tenant_id
      and p.id <> new.id
      and lower(btrim(p.nome)) = lower(btrim(new.nome))
      and coalesce(upper(btrim(p.matriculation::text)), '') = coalesce(upper(btrim(new.matriculation::text)), '')
      and p.job_title_id = new.job_title_id
      and coalesce(p.job_title_type_id::text, '') = coalesce(new.job_title_type_id::text, '')
      and coalesce(upper(btrim(p.job_level::text)), '') = coalesce(upper(btrim(new.job_level::text)), '')
  ) then
    raise exception 'Pessoa duplicada para nome + matricula + cargo + tipo + nivel no tenant.'
      using errcode = '23505', constraint = 'people_duplicate_identity_key';
  end if;

  return new;
end;
$$;

create index if not exists idx_people_duplicate_identity_lookup
  on public.people (
    tenant_id,
    lower(btrim(nome)),
    coalesce(upper(btrim(matriculation::text)), ''),
    job_title_id,
    coalesce(job_title_type_id::text, ''),
    coalesce(upper(btrim(job_level::text)), '')
  );

drop trigger if exists trg_people_prevent_duplicate_identity on public.people;
create trigger trg_people_prevent_duplicate_identity
before insert or update on public.people
for each row execute function public.prevent_people_duplicate_identity();
