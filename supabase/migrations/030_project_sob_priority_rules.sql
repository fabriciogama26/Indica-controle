-- 030_project_sob_priority_rules.sql
-- Regras de formato do SOB por prioridade e unicidade case-insensitive por tenant.

update public.project
set
  sob = upper(btrim(sob)),
  priority = upper(btrim(priority))
where true;

create unique index if not exists ux_project_tenant_sob_upper
  on public.project (tenant_id, upper(sob));

alter table if exists public.project
  drop constraint if exists chk_project_sob_priority_format;

alter table if exists public.project
  add constraint chk_project_sob_priority_format check (
    case
      when upper(priority) in ('GRUPO B - FLUXO', 'DRP / DRC', 'GRUPO A - FLUXO') then upper(sob) ~ '^A[0-9]{9}$'
      when upper(priority) = 'FUSESAVER' then upper(sob) ~ '^(ZX|FS)[0-9]{8}$'
      else true
    end
  );
