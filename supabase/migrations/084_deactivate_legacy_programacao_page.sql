-- 084_deactivate_legacy_programacao_page.sql
-- Desativa a tela legada de Programacao sem excluir registros.

update public.app_pages
set
  ativo = false,
  name = 'Programacao (Legado)',
  description = 'Tela legada desativada. Use a nova Programacao em /programacao-simples.',
  updated_at = now()
where page_key = 'programacao';

update public.role_page_permissions
set
  can_access = false,
  updated_at = now()
where page_key = 'programacao';

update public.app_user_page_permissions
set
  can_access = false,
  updated_at = now()
where page_key = 'programacao';
