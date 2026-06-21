-- list-security-definer-exposed.sql
-- Lista funcoes SECURITY DEFINER acessiveis por anon ou authenticated.
-- Versao SELECT (sem exception) para diagnostico.

select
  n.nspname || '.' || p.proname ||
    '(' || pg_get_function_identity_arguments(p.oid) || ')' as func_sig,
  has_function_privilege('anon',          p.oid, 'execute') as anon_exec,
  has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef = true
  and (
    has_function_privilege('anon',          p.oid, 'execute')
    or has_function_privilege('authenticated', p.oid, 'execute')
  )
order by p.proname;
