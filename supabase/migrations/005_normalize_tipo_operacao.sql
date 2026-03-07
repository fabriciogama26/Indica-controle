-- 005_normalize_tipo_operacao.sql
-- Padroniza tipo_operacao para REQ/DEV.
update public.requisicoes
set tipo_operacao = 'DEV'
where upper(tipo_operacao) like 'DEV%';

update public.requisicoes
set tipo_operacao = 'REQ'
where upper(tipo_operacao) like 'REQ%';

update public.stock_conflicts
set tipo_operacao = 'DEV'
where upper(tipo_operacao) like 'DEV%';

update public.stock_conflicts
set tipo_operacao = 'REQ'
where upper(tipo_operacao) like 'REQ%';
