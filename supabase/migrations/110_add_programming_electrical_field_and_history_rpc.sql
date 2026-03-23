-- 110_add_programming_electrical_field_and_history_rpc.sql
-- Adiciona Campo eletrico na Programacao e RPC para persistencia com historico.

alter table if exists public.project_programming
  add column if not exists campo_eletrico text;

alter table if exists public.project_programming
  drop constraint if exists project_programming_campo_eletrico_not_blank;

alter table if exists public.project_programming
  add constraint project_programming_campo_eletrico_not_blank
  check (campo_eletrico is null or btrim(campo_eletrico) <> '');

drop function if exists public.set_project_programming_campo_eletrico(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
);

create or replace function public.set_project_programming_campo_eletrico(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_campo_eletrico text,
  p_history_action text default null,
  p_history_reason text default null,
  p_history_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campo_eletrico text := nullif(btrim(coalesce(p_campo_eletrico, '')), '');
  v_action text := coalesce(upper(nullif(btrim(coalesce(p_history_action, '')), '')), 'UPDATE');
  v_history_metadata jsonb := case
    when jsonb_typeof(coalesce(p_history_metadata, '{}'::jsonb)) = 'object' then coalesce(p_history_metadata, '{}'::jsonb)
    else '{}'::jsonb
  end;
  v_previous_campo_eletrico text;
  v_project_id uuid;
  v_team_id uuid;
  v_updated_at timestamptz;
  v_history_id uuid;
  v_changes jsonb;
  v_history_result jsonb;
begin
  if p_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROGRAMMING_ID_REQUIRED',
      'message', 'Programacao invalida para salvar Campo eletrico.'
    );
  end if;

  if v_campo_eletrico is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ELECTRICAL_FIELD_REQUIRED',
      'message', 'Campo eletrico e obrigatorio para salvar a programacao.'
    );
  end if;

  select
    nullif(btrim(coalesce(pp.campo_eletrico, '')), ''),
    pp.project_id,
    pp.team_id,
    pp.updated_at
  into
    v_previous_campo_eletrico,
    v_project_id,
    v_team_id,
    v_updated_at
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.id = p_programming_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada para o tenant atual.'
    );
  end if;

  update public.project_programming
  set
    campo_eletrico = v_campo_eletrico,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_programming_id
  returning updated_at
  into v_updated_at;

  if coalesce(v_previous_campo_eletrico, '') is distinct from coalesce(v_campo_eletrico, '') then
    v_changes := jsonb_build_object(
      'electricalField',
      jsonb_build_object(
        'from', v_previous_campo_eletrico,
        'to', v_campo_eletrico
      )
    );

    select ph.id
    into v_history_id
    from public.project_programming_history ph
    where ph.tenant_id = p_tenant_id
      and ph.programming_id = p_programming_id
    order by ph.created_at desc
    limit 1;

    if v_history_id is not null then
      update public.project_programming_history
      set
        changes = coalesce(changes, '{}'::jsonb) || v_changes,
        metadata = coalesce(metadata, '{}'::jsonb) || v_history_metadata
      where id = v_history_id;
    else
      v_history_result := public.append_project_programming_history_record(
        p_tenant_id,
        p_actor_user_id,
        p_programming_id,
        v_project_id,
        v_team_id,
        null,
        v_action,
        nullif(btrim(coalesce(p_history_reason, '')), ''),
        v_changes,
        v_history_metadata,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      );

      if coalesce((v_history_result ->> 'success')::boolean, false) = false then
        return jsonb_build_object(
          'success', false,
          'status', coalesce((v_history_result ->> 'status')::integer, 400),
          'reason', coalesce(v_history_result ->> 'reason', 'PROGRAMMING_HISTORY_SAVE_FAILED'),
          'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico do Campo eletrico.')
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'message', 'Campo eletrico salvo com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_programming_campo_eletrico(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) from public;

grant execute on function public.set_project_programming_campo_eletrico(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) to authenticated;

grant execute on function public.set_project_programming_campo_eletrico(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) to service_role;
