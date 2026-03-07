-- 007_views_conflicts.sql
-- Views para facilitar a tela de conflitos no SaaS.

create or replace view public.v_stock_conflicts as
select
  c.*,
  count(i.id) as total_items,
  sum(case when i.status = 'REMOVE' then 1 else 0 end) as removed_items,
  sum(case when i.status = 'REDUCE' then 1 else 0 end) as reduced_items
from public.stock_conflicts c
left join public.stock_conflict_items i on i.conflict_id = c.id
group by c.id;

create or replace view public.v_stock_conflict_items as
select
  i.*, m.descricao as material_descricao
from public.stock_conflict_items i
left join public.materials m on m.id = i.material_id;
