-- 163_move_meta_and_activities_to_cadastros.sql
-- Move as telas Meta e Atividades para a secao Cadastros no catalogo de paginas.

update public.app_pages
set
  section = 'Cadastros',
  updated_at = now()
where page_key in ('meta', 'atividades')
  and section is distinct from 'Cadastros';
