-- 035_add_matriculation_to_people.sql
-- Adiciona matriculation na tabela people.

alter table if exists public.people
  add column if not exists matriculation text;

alter table if exists public.people
  drop constraint if exists chk_people_matriculation_not_blank;

alter table if exists public.people
  add constraint chk_people_matriculation_not_blank
  check (matriculation is null or btrim(matriculation) <> '');

create index if not exists idx_people_tenant_matriculation
  on public.people (tenant_id, matriculation);
