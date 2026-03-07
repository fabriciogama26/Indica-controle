-- 015_add_audit_columns.sql
-- Padrao de auditoria: created_by, updated_by, created_at e updated_at.

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
as $$
  select au.id
  from public.app_users au
  where au.auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.apply_audit_fields()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is null then
      new.created_at := now();
    end if;
    if new.updated_at is null then
      new.updated_at := coalesce(new.created_at, now());
    end if;
    if new.created_by is null then
      new.created_by := public.current_app_user_id();
    end if;
    if new.updated_by is null then
      new.updated_by := coalesce(new.created_by, public.current_app_user_id());
    end if;
  else
    new.updated_at := now();
    if new.updated_by is null then
      new.updated_by := coalesce(public.current_app_user_id(), old.updated_by, old.created_by);
    end if;
  end if;
  return new;
end;
$$;

alter table if exists public.app_users
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id);

alter table if exists public.imei_whitelist
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.login_audit
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.app_error_logs
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.materials
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id);

alter table if exists public.inventory_balance
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id);

alter table if exists public.requisicoes
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id);

alter table if exists public.requisicao_itens
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id);

alter table if exists public.stock_movements
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id);

alter table if exists public.stock_conflicts
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id);

alter table if exists public.stock_conflict_items
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id);

alter table if exists public.sync_runs
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.sync_run_steps
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id);

alter table if exists public.sync_run_alerts
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id);

alter table if exists public.project_material_balance
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id);

alter table if exists public.job_titles
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id);

alter table if exists public.people
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.app_users(id),
  add column if not exists updated_by uuid references public.app_users(id);

drop trigger if exists trg_app_users_audit on public.app_users;
create trigger trg_app_users_audit before insert or update on public.app_users
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_imei_whitelist_audit on public.imei_whitelist;
create trigger trg_imei_whitelist_audit before insert or update on public.imei_whitelist
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_login_audit_audit on public.login_audit;
create trigger trg_login_audit_audit before insert or update on public.login_audit
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_app_error_logs_audit on public.app_error_logs;
create trigger trg_app_error_logs_audit before insert or update on public.app_error_logs
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_materials_audit on public.materials;
create trigger trg_materials_audit before insert or update on public.materials
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_inventory_balance_audit on public.inventory_balance;
create trigger trg_inventory_balance_audit before insert or update on public.inventory_balance
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_requisicoes_audit on public.requisicoes;
create trigger trg_requisicoes_audit before insert or update on public.requisicoes
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_requisicao_itens_audit on public.requisicao_itens;
create trigger trg_requisicao_itens_audit before insert or update on public.requisicao_itens
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_stock_movements_audit on public.stock_movements;
create trigger trg_stock_movements_audit before insert or update on public.stock_movements
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_stock_conflicts_audit on public.stock_conflicts;
create trigger trg_stock_conflicts_audit before insert or update on public.stock_conflicts
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_stock_conflict_items_audit on public.stock_conflict_items;
create trigger trg_stock_conflict_items_audit before insert or update on public.stock_conflict_items
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_sync_runs_audit on public.sync_runs;
create trigger trg_sync_runs_audit before insert or update on public.sync_runs
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_sync_run_steps_audit on public.sync_run_steps;
create trigger trg_sync_run_steps_audit before insert or update on public.sync_run_steps
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_sync_run_alerts_audit on public.sync_run_alerts;
create trigger trg_sync_run_alerts_audit before insert or update on public.sync_run_alerts
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_project_material_balance_audit on public.project_material_balance;
create trigger trg_project_material_balance_audit before insert or update on public.project_material_balance
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_job_titles_audit on public.job_titles;
create trigger trg_job_titles_audit before insert or update on public.job_titles
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_people_audit on public.people;
create trigger trg_people_audit before insert or update on public.people
for each row execute function public.apply_audit_fields();
