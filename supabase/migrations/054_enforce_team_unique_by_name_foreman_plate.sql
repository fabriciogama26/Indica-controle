-- 054_enforce_team_unique_by_name_foreman_plate.sql
-- Ajusta regra de duplicidade em equipes para considerar combinacao:
-- tenant + encarregado + nome da equipe + placa do veiculo.

alter table if exists public.teams
  drop constraint if exists teams_tenant_id_name_key;

alter table if exists public.teams
  drop constraint if exists teams_tenant_id_vehicle_plate_key;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'teams'
      and tc.constraint_name = 'teams_tenant_foreman_name_plate_key'
  ) then
    alter table public.teams
      add constraint teams_tenant_foreman_name_plate_key
      unique (tenant_id, foreman_person_id, name, vehicle_plate);
  end if;
end;
$$;
