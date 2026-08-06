-- 354_prevent_present_member_multiple_team_compositions.sql
-- Impede que a mesma pessoa presente fique em duas composicoes ativas na mesma data.

begin;

create or replace function public.assert_team_composition_present_member_date_unique(
  p_member_id uuid,
  p_tenant_id uuid
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_subject record;
  v_conflict record;
begin
  select
    m.id as member_id,
    m.tenant_id,
    m.composition_id,
    m.person_id,
    m.person_name_snapshot,
    m.is_present,
    c.composition_date,
    c.is_active
    into v_subject
  from public.team_composition_members m
  join public.team_compositions c
    on c.tenant_id = m.tenant_id
   and c.id = m.composition_id
  where m.tenant_id = p_tenant_id
    and m.id = p_member_id;

  if not found
    or not coalesce(v_subject.is_present, false)
    or not coalesce(v_subject.is_active, false)
    or v_subject.composition_date is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'team_composition_member_date:'
      || v_subject.tenant_id::text || ':'
      || v_subject.composition_date::text || ':'
      || v_subject.person_id::text,
    0
  ));

  select
    m.person_name_snapshot,
    c.team_name_snapshot
    into v_conflict
  from public.team_composition_members m
  join public.team_compositions c
    on c.tenant_id = m.tenant_id
   and c.id = m.composition_id
  where m.tenant_id = v_subject.tenant_id
    and m.person_id = v_subject.person_id
    and m.is_present = true
    and c.is_active = true
    and c.composition_date = v_subject.composition_date
    and c.id <> v_subject.composition_id
  order by c.team_name_snapshot nulls last, m.person_name_snapshot nulls last
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'TEAM_COMPOSITION_MEMBER_DATE_CONFLICT',
      detail = format(
        '%s ja esta na composicao da equipe %s nesta data.',
        coalesce(nullif(btrim(v_subject.person_name_snapshot), ''), nullif(btrim(v_conflict.person_name_snapshot), ''), 'Integrante'),
        coalesce(nullif(btrim(v_conflict.team_name_snapshot), ''), 'outra equipe')
      );
  end if;
end;
$$;

create or replace function public.enforce_team_composition_present_member_date_unique()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.assert_team_composition_present_member_date_unique(new.id, new.tenant_id);

  return null;
end;
$$;

create or replace function public.enforce_team_composition_present_members_after_composition_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_member record;
begin
  if not coalesce(new.is_active, false) or new.composition_date is null then
    return null;
  end if;

  for v_member in
    select id, tenant_id
    from public.team_composition_members
    where tenant_id = new.tenant_id
      and composition_id = new.id
      and is_present = true
    order by person_id
  loop
    perform public.assert_team_composition_present_member_date_unique(v_member.id, v_member.tenant_id);
  end loop;

  return null;
end;
$$;

drop trigger if exists trg_team_composition_members_present_date_conflict
  on public.team_composition_members;

create constraint trigger trg_team_composition_members_present_date_conflict
after insert or update on public.team_composition_members
deferrable initially deferred
for each row
execute function public.enforce_team_composition_present_member_date_unique();

drop trigger if exists trg_team_compositions_present_member_date_conflict
  on public.team_compositions;

create constraint trigger trg_team_compositions_present_member_date_conflict
after update on public.team_compositions
deferrable initially deferred
for each row
execute function public.enforce_team_composition_present_members_after_composition_change();

notify pgrst, 'reload schema';

commit;
