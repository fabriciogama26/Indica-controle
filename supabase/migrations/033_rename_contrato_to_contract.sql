-- 033_rename_contrato_to_contract.sql
-- Renomeia a tabela public.contrato para public.contract.

do $$
begin
  if to_regclass('public.contrato') is not null
     and to_regclass('public.contract') is null then
    execute 'alter table public.contrato rename to contract';
  end if;
end $$;

alter table if exists public.contract enable row level security;

drop policy if exists contrato_tenant_select on public.contract;
drop policy if exists contrato_tenant_write on public.contract;
drop policy if exists contract_tenant_select on public.contract;
drop policy if exists contract_tenant_write on public.contract;

create policy contract_tenant_select on public.contract
for select
to authenticated
using (public.user_can_access_tenant(contract.tenant_id));

create policy contract_tenant_write on public.contract
for all
to authenticated
using (public.user_can_access_tenant(contract.tenant_id))
with check (public.user_can_access_tenant(contract.tenant_id));

drop trigger if exists trg_contrato_audit on public.contract;
drop trigger if exists trg_contract_audit on public.contract;

create trigger trg_contract_audit before insert or update on public.contract
for each row execute function public.apply_audit_fields();

drop index if exists public.idx_contrato_tenant_active;
create index if not exists idx_contract_tenant_active
  on public.contract (tenant_id, ativo);
