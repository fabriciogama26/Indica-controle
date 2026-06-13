-- Etapa 4: impede execucao direta da copia de Programacao por clientes autenticados.
-- A RPC recebe tenant e ator por parametro e, portanto, deve ser chamada somente pela
-- API server-side depois da autenticacao e da autorizacao de pagina/acao.

alter function public.copy_project_programming_to_dates(
  uuid,
  uuid,
  uuid,
  timestamptz,
  jsonb
)
set search_path = public, pg_temp;

revoke all on function public.copy_project_programming_to_dates(
  uuid,
  uuid,
  uuid,
  timestamptz,
  jsonb
) from public, anon, authenticated;

grant execute on function public.copy_project_programming_to_dates(
  uuid,
  uuid,
  uuid,
  timestamptz,
  jsonb
) to service_role;

do $$
declare
  v_function_oid oid :=
    'public.copy_project_programming_to_dates(uuid,uuid,uuid,timestamp with time zone,jsonb)'
      ::regprocedure::oid;
begin
  if has_function_privilege('anon', v_function_oid, 'EXECUTE')
    or has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
    raise exception
      'copy_project_programming_to_dates nao pode ser executada por anon/authenticated';
  end if;

  if not has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    raise exception
      'copy_project_programming_to_dates deve permanecer executavel por service_role';
  end if;
end;
$$;
