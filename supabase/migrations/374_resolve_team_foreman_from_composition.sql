-- 374_resolve_team_foreman_from_composition.sql
-- Faz a Composicao de Equipe virar o nivel 1 da resolucao de encarregado por data.
-- Cadeia nova: composicao do dia -> team_foreman_history (161) -> teams.foreman_person_id.
-- A Medicao herda automaticamente pelo trigger trg_apply_measurement_team_snapshot (161);
-- o Controle de APR passa a usar o mesmo padrao por trigger, em vez do join direto em teams.

begin;

-- Determinismo da resolucao: uma equipe tem UM encarregado por data. Duas composicoes
-- ativas da mesma equipe na mesma data continuam permitidas (projeto principal distinto),
-- mas nao podem apontar para encarregados diferentes — senao "encarregado da equipe X em
-- D" teria duas respostas e o snapshot gravado seria arbitrario.
-- Complementa team_compositions_foreman_single_team_per_date (373), que fecha o sentido
-- inverso: um encarregado nao responde por equipes diferentes na mesma data.
alter table public.team_compositions
  drop constraint if exists team_compositions_team_single_foreman_per_date;

alter table public.team_compositions
  add constraint team_compositions_team_single_foreman_per_date
  exclude using gist (
    tenant_id with =,
    composition_date with =,
    team_id with =,
    foreman_person_id with <>
  ) where (is_active = true and foreman_person_id is not null);

create or replace function public.resolve_team_foreman_snapshot(
  p_tenant_id uuid,
  p_team_id uuid,
  p_execution_date date
)
returns table (
  team_name text,
  foreman_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(btrim(coalesce(t.name, '')), ''), 'Nao informado') as team_name,
    coalesce(
      nullif(btrim(coalesce(c.foreman_name_snapshot, '')), ''),
      nullif(btrim(coalesce(h.foreman_name_snapshot, '')), ''),
      nullif(btrim(coalesce(p.nome, '')), ''),
      'Nao identificado'
    ) as foreman_name
  from public.teams t
  left join public.people p
    on p.id = t.foreman_person_id
   and p.tenant_id = t.tenant_id
  left join lateral (
    select tc.foreman_name_snapshot
    from public.team_compositions tc
    where tc.tenant_id = t.tenant_id
      and tc.team_id = t.id
      and tc.composition_date = p_execution_date
      and tc.is_active = true
      and tc.foreman_person_id is not null
    limit 1
  ) c on true
  left join lateral (
    select fh.foreman_name_snapshot
    from public.team_foreman_history fh
    where fh.tenant_id = t.tenant_id
      and fh.team_id = t.id
      and fh.valid_from <= p_execution_date
      and (fh.valid_to is null or fh.valid_to >= p_execution_date)
    order by fh.valid_from desc, fh.created_at desc
    limit 1
  ) h on true
  where t.tenant_id = p_tenant_id
    and t.id = p_team_id
  limit 1;
$$;

-- Indice que sustenta o nivel 1 da cadeia: a resolucao busca por tenant + equipe + data.
create index if not exists idx_team_compositions_tenant_team_date_active
  on public.team_compositions (tenant_id, team_id, composition_date)
  where is_active = true and foreman_person_id is not null;

create or replace function public.apply_apr_team_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot record;
begin
  -- Decisao de negocio: o snapshot e resolvido na ESCRITA. Update que nao mexe em
  -- equipe nem em data preserva o que ja estava gravado, para editar observacao
  -- nao reescrever historico.
  if tg_op = 'UPDATE'
    and new.team_id is not distinct from old.team_id
    and new.service_date is not distinct from old.service_date
  then
    new.team_name_snapshot := coalesce(nullif(btrim(coalesce(old.team_name_snapshot, '')), ''), new.team_name_snapshot);
    new.foreman_name_snapshot := old.foreman_name_snapshot;
    return new;
  end if;

  select *
    into v_snapshot
  from public.resolve_team_foreman_snapshot(new.tenant_id, new.team_id, new.service_date);

  if v_snapshot.team_name is not null then
    new.team_name_snapshot := v_snapshot.team_name;
  end if;

  -- O Controle de APR grava NULL quando nao ha encarregado; a funcao de resolucao
  -- devolve 'Nao identificado'. Converter mantem o contrato atual da tela, onde
  -- ausencia vira 'Sem encarregado' na leitura.
  new.foreman_name_snapshot := nullif(v_snapshot.foreman_name, 'Nao identificado');

  return new;
end;
$$;

drop trigger if exists trg_apply_apr_team_snapshot on public.project_apr_controls;
create trigger trg_apply_apr_team_snapshot
before insert or update of team_id, service_date, team_name_snapshot, foreman_name_snapshot
on public.project_apr_controls
for each row execute function public.apply_apr_team_snapshot();

revoke all on function public.apply_apr_team_snapshot() from public;
revoke all on function public.apply_apr_team_snapshot() from anon;
revoke all on function public.apply_apr_team_snapshot() from authenticated;

revoke all on function public.resolve_team_foreman_snapshot(uuid, uuid, date) from public;
revoke all on function public.resolve_team_foreman_snapshot(uuid, uuid, date) from anon;
revoke all on function public.resolve_team_foreman_snapshot(uuid, uuid, date) from authenticated;
grant execute on function public.resolve_team_foreman_snapshot(uuid, uuid, date) to service_role;

notify pgrst, 'reload schema';

commit;
