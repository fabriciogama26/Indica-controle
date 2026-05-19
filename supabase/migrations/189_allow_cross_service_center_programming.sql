-- 189_allow_cross_service_center_programming.sql
-- Libera a Programacao para usar equipes ativas de qualquer centro de servico.
-- A equipe ainda precisa existir, estar ativa e pertencer ao tenant atual.

do $$
declare
  v_signature regprocedure := 'public.save_project_programming(uuid, uuid, uuid, uuid, date, text, time, time, integer, text, text, text, jsonb, jsonb, uuid, timestamptz, uuid)'::regprocedure;
  v_copy_signature regprocedure := 'public.copy_team_programming_period(uuid, uuid, uuid, uuid[], date, date)'::regprocedure;
  v_definition text;
  v_next_definition text;
  v_copy_definition text;
  v_next_copy_definition text;
  v_block_start integer;
  v_block_end integer;
  v_copy_block_start integer;
  v_copy_block_end integer;
begin
  select pg_get_functiondef(v_signature)
  into v_definition;

  v_block_start := strpos(v_definition, 'if v_team.service_center_id <> v_project.service_center then');
  if v_block_start = 0 then
    raise exception 'Nao foi possivel localizar o inicio do bloco TEAM_SERVICE_CENTER_MISMATCH em save_project_programming.';
  end if;

  v_block_end := strpos(substr(v_definition, v_block_start), 'if v_support_item_id is not null then');
  if v_block_end = 0 then
    raise exception 'Nao foi possivel localizar o fim do bloco TEAM_SERVICE_CENTER_MISMATCH em save_project_programming.';
  end if;

  v_next_definition :=
    substr(v_definition, 1, v_block_start - 1)
    || $replacement$
  if v_team.service_center_id <> v_project.service_center then
    null;
  end if;
$replacement$
    || substr(v_definition, v_block_start + v_block_end - 1);

  execute v_next_definition;

  select pg_get_functiondef(v_copy_signature)
  into v_copy_definition;

  v_copy_block_start := strpos(v_copy_definition, 'if v_target_team.service_center_id <> v_source_project.service_center then');
  if v_copy_block_start = 0 then
    raise exception 'Nao foi possivel localizar o inicio do bloco TEAM_SERVICE_CENTER_MISMATCH em copy_team_programming_period.';
  end if;

  v_copy_block_end := strpos(substr(v_copy_definition, v_copy_block_start), 'select pp.id');
  if v_copy_block_end = 0 then
    raise exception 'Nao foi possivel localizar o fim do bloco TEAM_SERVICE_CENTER_MISMATCH em copy_team_programming_period.';
  end if;

  v_next_copy_definition :=
    substr(v_copy_definition, 1, v_copy_block_start - 1)
    || $replacement$
      if v_target_team.service_center_id <> v_source_project.service_center then
        null;
      end if;
$replacement$
    || substr(v_copy_definition, v_copy_block_start + v_copy_block_end - 1);

  execute v_next_copy_definition;
end;
$$;
