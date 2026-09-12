-- 406_fix_service_activities_code_idd_text.sql
-- Corrige drift de schema em public.service_activities.code_idd.
--
-- A migration 353 sincronizou a coluna como `text`, mas usou
-- `add column if not exists`. Em ambiente onde a coluna ja existia como
-- `bigint` por alteracao manual anterior, a migration virou no-op e a RPC
-- atual `save_service_activity_record` passou a quebrar com 42804 ao gravar o
-- texto recebido do cadastro/importacao de Atividades.

do $$
declare
  v_data_type text;
  v_udt_name text;
begin
  select columns.data_type, columns.udt_name
  into v_data_type, v_udt_name
  from information_schema.columns
  where columns.table_schema = 'public'
    and columns.table_name = 'service_activities'
    and columns.column_name = 'code_idd';

  if v_data_type is null then
    alter table public.service_activities
      add column code_idd text;
  elsif v_udt_name <> 'text' then
    alter table public.service_activities
      alter column code_idd type text
      using nullif(btrim(code_idd::text), '');
  end if;
end;
$$;

comment on column public.service_activities.code_idd is
  'Codigo IDD/SAP da atividade (identificador externo textual). Exibido em Atividades e Medicao.';

do $$
declare
  v_udt_name text;
begin
  select columns.udt_name
  into v_udt_name
  from information_schema.columns
  where columns.table_schema = 'public'
    and columns.table_name = 'service_activities'
    and columns.column_name = 'code_idd';

  if v_udt_name <> 'text' then
    raise exception '406: service_activities.code_idd deveria ser text, mas esta como %', coalesce(v_udt_name, 'ausente');
  end if;
end;
$$;
