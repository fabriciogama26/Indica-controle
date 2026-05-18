-- 187_update_stock_dashboard_labels.sql
-- Ajusta rotulos das paginas Home e Dashboard Estoque.

update public.app_pages
set
  name = 'Home',
  description = 'Painel inicial do tenant com resumo operacional.',
  updated_at = now()
where page_key = 'home';

update public.app_pages
set
  name = 'Dashboard Estoque',
  description = 'Indicadores de saldo, giro, criticidade e operacoes de estoque.',
  updated_at = now()
where page_key = 'dash-estoque';
