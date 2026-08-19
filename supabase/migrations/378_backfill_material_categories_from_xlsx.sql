-- 378_backfill_material_categories_from_xlsx.sql
-- Cria catalogos multi-tenant de categoria/subcategoria de materiais e aplica
-- backfill gerado de C:/Users/operador/Downloads/Materiais/materiais_2026-08-11_categorizados.xlsx.

begin;

create table if not exists public.material_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint material_categories_name_not_blank_check
    check (nullif(btrim(coalesce(name, '')), '') is not null),
  constraint material_categories_sort_order_check
    check (sort_order >= 0),
  constraint material_categories_tenant_name_key
    unique (tenant_id, name),
  constraint material_categories_id_tenant_key
    unique (id, tenant_id)
);

create index if not exists idx_material_categories_tenant_active_order
  on public.material_categories (tenant_id, is_active, sort_order, name);

alter table if exists public.material_categories enable row level security;

drop policy if exists material_categories_tenant_select on public.material_categories;
create policy material_categories_tenant_select on public.material_categories
for select
to authenticated
using (public.user_can_access_tenant(material_categories.tenant_id));

grant select on public.material_categories to authenticated;

drop trigger if exists trg_material_categories_audit on public.material_categories;
create trigger trg_material_categories_audit
before insert or update on public.material_categories
for each row execute function public.apply_audit_fields();

create table if not exists public.material_subcategories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid not null,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint material_subcategories_name_not_blank_check
    check (nullif(btrim(coalesce(name, '')), '') is not null),
  constraint material_subcategories_sort_order_check
    check (sort_order >= 0),
  constraint material_subcategories_category_tenant_fk
    foreign key (category_id, tenant_id)
    references public.material_categories(id, tenant_id)
    on delete cascade,
  constraint material_subcategories_tenant_category_name_key
    unique (tenant_id, category_id, name),
  constraint material_subcategories_id_tenant_key
    unique (id, tenant_id),
  constraint material_subcategories_id_tenant_category_key
    unique (id, tenant_id, category_id)
);

create index if not exists idx_material_subcategories_tenant_category_active_order
  on public.material_subcategories (tenant_id, category_id, is_active, sort_order, name);

alter table if exists public.material_subcategories enable row level security;

drop policy if exists material_subcategories_tenant_select on public.material_subcategories;
create policy material_subcategories_tenant_select on public.material_subcategories
for select
to authenticated
using (public.user_can_access_tenant(material_subcategories.tenant_id));

grant select on public.material_subcategories to authenticated;

drop trigger if exists trg_material_subcategories_audit on public.material_subcategories;
create trigger trg_material_subcategories_audit
before insert or update on public.material_subcategories
for each row execute function public.apply_audit_fields();

alter table if exists public.materials
  add column if not exists category_id uuid,
  add column if not exists subcategory_id uuid;

alter table if exists public.materials
  drop constraint if exists materials_subcategory_requires_category_check,
  add constraint materials_subcategory_requires_category_check
    check (subcategory_id is null or category_id is not null) not valid;

alter table if exists public.materials
  drop constraint if exists materials_category_tenant_fk,
  drop constraint if exists materials_subcategory_tenant_category_fk;

alter table if exists public.materials
  add constraint materials_category_tenant_fk
    foreign key (category_id, tenant_id)
    references public.material_categories(id, tenant_id) not valid,
  add constraint materials_subcategory_tenant_category_fk
    foreign key (subcategory_id, tenant_id, category_id)
    references public.material_subcategories(id, tenant_id, category_id) not valid;

create index if not exists idx_materials_tenant_category
  on public.materials (tenant_id, category_id)
  where category_id is not null;

create index if not exists idx_materials_tenant_subcategory
  on public.materials (tenant_id, subcategory_id)
  where subcategory_id is not null;

create temp table material_category_backfill (
  codigo text not null,
  category_name text not null,
  subcategory_name text not null
) on commit drop;

insert into material_category_backfill (codigo, category_name, subcategory_name)
values
  ('99901', 'Transformadores', 'Transformador monofásico'),
  ('110569', 'Transformadores', 'Transformador monofásico'),
  ('111246', 'Transformadores', 'Transformador trifásico'),
  ('111271', 'Transformadores', 'Transformador trifásico'),
  ('111272', 'Transformadores', 'Transformador bifásico'),
  ('111274', 'Transformadores', 'Transformador trifásico'),
  ('111305', 'Transformadores', 'Transformador trifásico'),
  ('111306', 'Transformadores', 'Transformador trifásico'),
  ('111307', 'Transformadores', 'Transformador trifásico'),
  ('111308', 'Transformadores', 'Transformador trifásico'),
  ('111311', 'Transformadores', 'Transformador bifásico'),
  ('111312', 'Transformadores', 'Transformador bifásico'),
  ('111313', 'Transformadores', 'Transformador bifásico'),
  ('111314', 'Transformadores', 'Transformador - outros'),
  ('111319', 'Transformadores', 'Transformador trifásico'),
  ('111321', 'Transformadores', 'Transformador trifásico'),
  ('111322', 'Transformadores', 'Transformador monofásico'),
  ('111323', 'Transformadores', 'Transformador monofásico'),
  ('111350', 'Transformadores', 'Transformador trifásico'),
  ('111351', 'Transformadores', 'Transformador trifásico'),
  ('111352', 'Transformadores', 'Transformador trifásico'),
  ('111353', 'Transformadores', 'Transformador trifásico'),
  ('111354', 'Transformadores', 'Transformador trifásico'),
  ('111355', 'Transformadores', 'Transformador bifásico'),
  ('111356', 'Transformadores', 'Transformador bifásico'),
  ('111357', 'Transformadores', 'Transformador bifásico'),
  ('111358', 'Transformadores', 'Transformador - outros'),
  ('111359', 'Transformadores', 'Transformador - outros'),
  ('111360', 'Transformadores', 'Transformador - outros'),
  ('111361', 'Transformadores', 'Transformador monofásico'),
  ('111362', 'Transformadores', 'Transformador monofásico'),
  ('111363', 'Transformadores', 'Transformador monofásico'),
  ('111365', 'Transformadores', 'Transformador monofásico'),
  ('111366', 'Transformadores', 'Transformador bifásico'),
  ('111368', 'Transformadores', 'Transformador trifásico'),
  ('111369', 'Transformadores', 'Transformador trifásico'),
  ('111370', 'Transformadores', 'Transformador trifásico'),
  ('111371', 'Transformadores', 'Transformador trifásico'),
  ('111372', 'Transformadores', 'Transformador trifásico'),
  ('111373', 'Transformadores', 'Transformador bifásico'),
  ('111374', 'Transformadores', 'Transformador bifásico'),
  ('111375', 'Transformadores', 'Transformador bifásico'),
  ('111378', 'Transformadores', 'Transformador - outros'),
  ('111379', 'Transformadores', 'Transformador - outros'),
  ('111380', 'Transformadores', 'Transformador - outros'),
  ('111381', 'Transformadores', 'Transformador monofásico'),
  ('111382', 'Transformadores', 'Transformador monofásico'),
  ('111383', 'Transformadores', 'Transformador monofásico'),
  ('111384', 'Transformadores', 'Transformador - outros'),
  ('111385', 'Transformadores', 'Transformador monofásico'),
  ('111386', 'Transformadores', 'Transformador bifásico'),
  ('111606', 'Transformadores', 'Transformador trifásico'),
  ('111663', 'Transformadores', 'Transformador trifásico'),
  ('111705', 'Transformadores', 'Transformador bifásico'),
  ('111706', 'Transformadores', 'Transformador bifásico'),
  ('111708', 'Transformadores', 'Transformador bifásico'),
  ('111709', 'Transformadores', 'Transformador trifásico'),
  ('111710', 'Transformadores', 'Transformador trifásico'),
  ('111711', 'Transformadores', 'Transformador bifásico'),
  ('111736', 'Transformadores', 'Transformador trifásico'),
  ('111738', 'Transformadores', 'Transformador trifásico'),
  ('111740', 'Transformadores', 'Transformador trifásico'),
  ('111742', 'Transformadores', 'Transformador trifásico'),
  ('111744', 'Transformadores', 'Transformador trifásico'),
  ('111746', 'Transformadores', 'Transformador trifásico'),
  ('111755', 'Transformadores', 'Transformador monofásico'),
  ('111756', 'Transformadores', 'Transformador monofásico'),
  ('111757', 'Transformadores', 'Transformador bifásico'),
  ('111758', 'Transformadores', 'Transformador monofásico'),
  ('111759', 'Transformadores', 'Transformador monofásico'),
  ('111762', 'Medição', 'Transformador de potencial (TP)'),
  ('111933', 'Transformadores', 'Transformador trifásico'),
  ('111940', 'Transformadores', 'Transformador trifásico'),
  ('112201', 'Transformadores', 'Transformador trifásico'),
  ('130579', 'Proteção e manobra', 'Chave fusível'),
  ('130726', 'Proteção e manobra', 'Disjuntor'),
  ('130727', 'Proteção e manobra', 'Disjuntor'),
  ('130728', 'Proteção e manobra', 'Disjuntor'),
  ('130729', 'Proteção e manobra', 'Disjuntor'),
  ('130730', 'Proteção e manobra', 'Disjuntor'),
  ('130732', 'Proteção e manobra', 'Disjuntor'),
  ('130733', 'Proteção e manobra', 'Disjuntor'),
  ('130734', 'Proteção e manobra', 'Disjuntor'),
  ('130736', 'Proteção e manobra', 'Disjuntor'),
  ('130738', 'Proteção e manobra', 'Disjuntor'),
  ('130740', 'Proteção e manobra', 'Disjuntor'),
  ('130743', 'Proteção e manobra', 'Disjuntor'),
  ('130744', 'Proteção e manobra', 'Disjuntor'),
  ('130746', 'Proteção e manobra', 'Disjuntor'),
  ('130761', 'Proteção e manobra', 'Disjuntor'),
  ('130866', 'Proteção e manobra', 'Fusível'),
  ('141233', 'Proteção e manobra', 'Religador'),
  ('141234', 'Proteção e manobra', 'Seccionador'),
  ('141240', 'Proteção e manobra', 'Religador'),
  ('141264', 'Proteção e manobra', 'Seccionador'),
  ('141283', 'Proteção e manobra', 'Proteção/manobra - outros'),
  ('141285', 'Proteção e manobra', 'Chave seccionadora/by-pass'),
  ('141286', 'Medição', 'Caixa/padrão de medição'),
  ('141296', 'Proteção e manobra', 'Chave faca'),
  ('141297', 'Proteção e manobra', 'Chave faca'),
  ('141298', 'Caixas, painéis e barramentos', 'Caixa/gabinete - outros'),
  ('141299', 'Caixas, painéis e barramentos', 'Caixa/gabinete - outros'),
  ('141307', 'Proteção e manobra', 'Seccionador'),
  ('141308', 'Proteção e manobra', 'Seccionador'),
  ('141309', 'Proteção e manobra', 'Seccionador'),
  ('141310', 'Proteção e manobra', 'Religador'),
  ('141359', 'Proteção e manobra', 'Disjuntor'),
  ('141381', 'Proteção e manobra', 'Religador'),
  ('141389', 'Proteção e manobra', 'Religador'),
  ('141408', 'Proteção e manobra', 'Chave seccionadora/by-pass'),
  ('141409', 'Proteção e manobra', 'Controle de religador'),
  ('141422', 'Proteção e manobra', 'Religador'),
  ('141434', 'Proteção e manobra', 'Seccionador'),
  ('141436', 'Proteção e manobra', 'Chave - outros'),
  ('141437', 'Proteção e manobra', 'Religador'),
  ('141439', 'Proteção e manobra', 'Chave seccionadora/by-pass'),
  ('141440', 'Proteção e manobra', 'Chave - outros'),
  ('141441', 'Proteção e manobra', 'Chave - outros'),
  ('141442', 'Proteção e manobra', 'Chave faca'),
  ('141443', 'Proteção e manobra', 'Chave faca'),
  ('141668', 'Medição', 'Painel de medição/faturamento'),
  ('141867', 'Proteção e manobra', 'Chave fusível'),
  ('141959', 'Proteção e manobra', 'Seccionador'),
  ('141980', 'Proteção e manobra', 'Religador'),
  ('142047', 'Proteção e manobra', 'Religador'),
  ('150751', 'Proteção e manobra', 'Chave faca'),
  ('150763', 'Proteção e manobra', 'Chave faca'),
  ('150777', 'Proteção e manobra', 'Chave faca'),
  ('150778', 'Proteção e manobra', 'Chave faca'),
  ('150779', 'Proteção e manobra', 'Seccionador'),
  ('150780', 'Proteção e manobra', 'Disjuntor'),
  ('163866', 'Equipamentos de rede', 'Capacitor/banco de capacitores'),
  ('163868', 'Equipamentos de rede', 'Capacitor/banco de capacitores'),
  ('163872', 'Caixas, painéis e barramentos', 'Caixa/gabinete - outros'),
  ('163885', 'Proteção e manobra', 'Disjuntor'),
  ('163893', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('164219', 'Automação e telecomando', 'Bateria/alimentação auxiliar'),
  ('164325', 'Caixas, painéis e barramentos', 'Caixa/gabinete - outros'),
  ('164435', 'Equipamentos de rede', 'Capacitor/banco de capacitores'),
  ('164464', 'Ferragens e estruturas', 'Suportes'),
  ('164470', 'Conectores, emendas e terminações', 'Conector de compressão'),
  ('164471', 'Conectores, emendas e terminações', 'Conector de compressão'),
  ('164472', 'Conectores, emendas e terminações', 'Conector de compressão'),
  ('164475', 'Proteção e manobra', 'Para-raios'),
  ('164479', 'Caixas, painéis e barramentos', 'Caixa/gabinete - outros'),
  ('164481', 'Caixas, painéis e barramentos', 'Caixa de derivação'),
  ('164485', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('164486', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('164492', 'Caixas, painéis e barramentos', 'Caixa de derivação'),
  ('164513', 'Caixas, painéis e barramentos', 'Caixa para disjuntor'),
  ('164516', 'Medição', 'Caixa/padrão de medição'),
  ('164524', 'Medição', 'Caixa/padrão de medição'),
  ('164525', 'Medição', 'Caixa/padrão de medição'),
  ('164532', 'Isoladores e acessórios', 'Cobertura/protetor isolante'),
  ('164549', 'Medição', 'Transformador de potencial (TP)'),
  ('164550', 'Medição', 'Caixa/padrão de medição'),
  ('164562', 'Automação e telecomando', 'Telecontrole/comunicação'),
  ('164584', 'Medição', 'Caixa/padrão de medição'),
  ('164598', 'Medição', 'Caixa/padrão de medição'),
  ('164620', 'Caixas, painéis e barramentos', 'Caixa/painel de proteção'),
  ('164621', 'Automação e telecomando', 'Bateria/alimentação auxiliar'),
  ('164638', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('164648', 'Proteção e manobra', 'Para-raios'),
  ('164671', 'Proteção e manobra', 'Controle de religador'),
  ('164678', 'Equipamentos de rede', 'Capacitor/banco de capacitores'),
  ('164679', 'Medição', 'Conjunto de medição'),
  ('164680', 'Automação e telecomando', 'Telecontrole/comunicação'),
  ('164681', 'Proteção e manobra', 'Chave - outros'),
  ('164682', 'Cabos e condutores', 'Condutor nu'),
  ('164683', 'Cabos e condutores', 'Condutor nu'),
  ('164684', 'Cabos e condutores', 'Condutor nu'),
  ('164685', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('164686', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('164699', 'Automação e telecomando', 'Bateria/alimentação auxiliar'),
  ('164706', 'Caixas, painéis e barramentos', 'Caixa de derivação'),
  ('164943', 'Ferragens e estruturas', 'Cruzeta'),
  ('165015', 'Automação e telecomando', 'Telecontrole/comunicação'),
  ('165017', 'Automação e telecomando', 'Telecontrole/comunicação'),
  ('165146', 'Automação e telecomando', 'Telecontrole/comunicação'),
  ('165147', 'Medição', 'Telemedição/acessório de medição'),
  ('165191', 'Aterramento', 'Caixa de aterramento'),
  ('165253', 'Equipamentos de rede', 'Capacitor/banco de capacitores'),
  ('166559', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('170041', 'Proteção e manobra', 'Elo fusível'),
  ('170042', 'Proteção e manobra', 'Elo fusível'),
  ('170043', 'Proteção e manobra', 'Elo fusível'),
  ('170044', 'Proteção e manobra', 'Elo fusível'),
  ('170064', 'Proteção e manobra', 'Elo fusível'),
  ('170066', 'Proteção e manobra', 'Elo fusível'),
  ('170068', 'Proteção e manobra', 'Elo fusível'),
  ('170069', 'Proteção e manobra', 'Elo fusível'),
  ('170074', 'Proteção e manobra', 'Chave fusível'),
  ('170075', 'Proteção e manobra', 'Chave fusível'),
  ('170159', 'Proteção e manobra', 'Chave fusível'),
  ('170973', 'Proteção e manobra', 'Para-raios'),
  ('170976', 'Proteção e manobra', 'Para-raios'),
  ('170977', 'Proteção e manobra', 'Para-raios'),
  ('170979', 'Proteção e manobra', 'Para-raios'),
  ('171060', 'Proteção e manobra', 'Religador'),
  ('171088', 'Proteção e manobra', 'Para-raios'),
  ('171089', 'Proteção e manobra', 'Elo fusível'),
  ('171090', 'Proteção e manobra', 'Elo fusível'),
  ('171091', 'Proteção e manobra', 'Elo fusível'),
  ('171092', 'Proteção e manobra', 'Elo fusível'),
  ('171093', 'Proteção e manobra', 'Elo fusível'),
  ('171094', 'Proteção e manobra', 'Elo fusível'),
  ('171095', 'Proteção e manobra', 'Elo fusível'),
  ('171096', 'Proteção e manobra', 'Elo fusível'),
  ('171097', 'Proteção e manobra', 'Elo fusível'),
  ('171110', 'Proteção e manobra', 'Elo fusível'),
  ('171111', 'Proteção e manobra', 'Elo fusível'),
  ('171112', 'Proteção e manobra', 'Elo fusível'),
  ('171113', 'Proteção e manobra', 'Elo fusível'),
  ('171114', 'Proteção e manobra', 'Elo fusível'),
  ('171115', 'Proteção e manobra', 'Elo fusível'),
  ('171116', 'Proteção e manobra', 'Elo fusível'),
  ('171117', 'Proteção e manobra', 'Elo fusível'),
  ('171118', 'Proteção e manobra', 'Elo fusível'),
  ('171119', 'Proteção e manobra', 'Elo fusível'),
  ('171120', 'Proteção e manobra', 'Elo fusível'),
  ('171121', 'Proteção e manobra', 'Elo fusível'),
  ('171122', 'Proteção e manobra', 'Chave fusível'),
  ('171125', 'Proteção e manobra', 'Para-raios'),
  ('171140', 'Proteção e manobra', 'Fusível'),
  ('171164', 'Proteção e manobra', 'Chave fusível'),
  ('171168', 'Proteção e manobra', 'Chave fusível'),
  ('171170', 'Proteção e manobra', 'Elo fusível'),
  ('171183', 'Ferragens e estruturas', 'Suportes'),
  ('171193', 'Proteção e manobra', 'Para-raios'),
  ('171217', 'Proteção e manobra', 'Para-raios'),
  ('171218', 'Proteção e manobra', 'Chave fusível'),
  ('171221', 'Proteção e manobra', 'Para-raios'),
  ('171409', 'Proteção e manobra', 'Chave fusível'),
  ('171559', 'Proteção e manobra', 'Elo fusível'),
  ('180730', 'Proteção e manobra', 'Relé/detector de proteção'),
  ('200186', 'Ferragens e estruturas', 'Suportes'),
  ('200207', 'Ferragens e estruturas', 'Grampos/conjuntos de ancoragem'),
  ('200250', 'Ferragens e estruturas', 'Suportes'),
  ('201313', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('201317', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('201318', 'Conectores, emendas e terminações', 'Terminação/terminal'),
  ('201376', 'Conectores, emendas e terminações', 'Conector de aterramento'),
  ('201381', 'Ferragens e estruturas', 'Suportes'),
  ('201383', 'Conectores, emendas e terminações', 'Terminação/terminal'),
  ('201384', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('201385', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('201386', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('201387', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('201388', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('201389', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('201390', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('201392', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('201397', 'Conectores, emendas e terminações', 'Terminação/terminal'),
  ('201398', 'Conectores, emendas e terminações', 'Conector de compressão'),
  ('201402', 'Ferragens e estruturas', 'Suportes'),
  ('201406', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('201407', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('201408', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('201439', 'Conectores, emendas e terminações', 'Conector de aterramento'),
  ('201440', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('201501', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('201534', 'Aterramento', 'Haste de aterramento'),
  ('201626', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('230055', 'Postes', 'Poste de concreto'),
  ('230056', 'Postes', 'Poste de concreto'),
  ('230057', 'Postes', 'Poste de concreto'),
  ('230059', 'Postes', 'Poste de concreto'),
  ('230060', 'Postes', 'Poste de concreto'),
  ('230061', 'Postes', 'Poste de concreto'),
  ('230062', 'Postes', 'Poste de concreto'),
  ('230064', 'Postes', 'Poste de concreto'),
  ('230065', 'Postes', 'Poste de concreto'),
  ('230125', 'Postes', 'Poste de fibra'),
  ('230207', 'Postes', 'Poste de fibra'),
  ('230210', 'Postes', 'Poste de fibra'),
  ('230211', 'Postes', 'Poste de fibra'),
  ('230213', 'Postes', 'Poste de fibra'),
  ('230356', 'Postes', 'Poste - outros'),
  ('230367', 'Ferragens e estruturas', 'Cruzeta'),
  ('231141', 'Postes', 'Poste de aço'),
  ('231142', 'Postes', 'Poste de aço'),
  ('231162', 'Postes', 'Poste de madeira/eucalipto'),
  ('231163', 'Ferragens e estruturas', 'Cruzeta'),
  ('231164', 'Postes', 'Poste de concreto'),
  ('231168', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('231182', 'Postes', 'Poste de concreto'),
  ('231183', 'Postes', 'Poste de concreto'),
  ('231189', 'Postes', 'Poste de concreto'),
  ('231190', 'Postes', 'Poste de concreto'),
  ('231191', 'Postes', 'Poste de concreto'),
  ('231192', 'Postes', 'Poste de concreto'),
  ('231193', 'Postes', 'Poste de concreto'),
  ('231194', 'Postes', 'Poste de concreto'),
  ('231195', 'Postes', 'Poste de concreto'),
  ('231197', 'Postes', 'Poste de concreto'),
  ('231215', 'Postes', 'Poste de madeira/eucalipto'),
  ('231216', 'Postes', 'Poste de madeira/eucalipto'),
  ('231217', 'Postes', 'Poste de concreto'),
  ('231218', 'Postes', 'Poste de concreto'),
  ('231219', 'Postes', 'Poste de concreto'),
  ('231280', 'Postes', 'Poste de concreto'),
  ('231281', 'Postes', 'Poste de concreto'),
  ('231282', 'Postes', 'Poste de concreto'),
  ('231285', 'Postes', 'Poste de concreto'),
  ('231286', 'Postes', 'Poste de concreto'),
  ('231287', 'Postes', 'Poste de concreto'),
  ('231288', 'Postes', 'Poste de concreto'),
  ('231289', 'Postes', 'Poste de concreto'),
  ('231290', 'Postes', 'Poste de madeira/eucalipto'),
  ('231291', 'Postes', 'Poste de madeira/eucalipto'),
  ('231292', 'Postes', 'Poste de madeira/eucalipto'),
  ('231293', 'Postes', 'Poste de madeira/eucalipto'),
  ('231294', 'Postes', 'Poste de concreto'),
  ('231295', 'Postes', 'Poste de concreto'),
  ('231296', 'Postes', 'Poste de concreto'),
  ('231299', 'Postes', 'Poste de concreto'),
  ('231300', 'Postes', 'Poste de concreto'),
  ('231301', 'Postes', 'Poste de concreto'),
  ('231302', 'Postes', 'Poste de concreto'),
  ('231303', 'Postes', 'Poste de concreto'),
  ('231304', 'Postes', 'Poste de concreto'),
  ('231305', 'Postes', 'Poste de concreto'),
  ('231307', 'Ferragens e estruturas', 'Cruzeta'),
  ('231308', 'Ferragens e estruturas', 'Cruzeta'),
  ('231309', 'Aterramento', 'Acessório de aterramento'),
  ('231316', 'Ferragens e estruturas', 'Cruzeta'),
  ('231320', 'Ferragens e estruturas', 'Suportes'),
  ('231329', 'Postes', 'Poste bipartido'),
  ('231330', 'Postes', 'Poste bipartido'),
  ('231332', 'Ferragens e estruturas', 'Cruzeta'),
  ('231334', 'Ferragens e estruturas', 'Cruzeta'),
  ('231343', 'Ferragens e estruturas', 'Cruzeta'),
  ('231351', 'Postes', 'Poste de fibra'),
  ('231352', 'Postes', 'Poste de concreto'),
  ('231360', 'Postes', 'Poste de fibra'),
  ('231361', 'Postes', 'Poste de fibra'),
  ('231362', 'Postes', 'Poste de concreto'),
  ('231382', 'Postes', 'Poste de concreto'),
  ('231413', 'Postes', 'Poste de fibra'),
  ('231432', 'Ferragens e estruturas', 'Cruzeta'),
  ('231441', 'Ferragens e estruturas', 'Cruzeta'),
  ('231452', 'Postes', 'Poste de concreto'),
  ('231455', 'Postes', 'Poste de concreto'),
  ('231470', 'Postes', 'Poste de concreto'),
  ('231472', 'Postes', 'Poste de concreto'),
  ('231474', 'Postes', 'Poste de concreto'),
  ('231494', 'Postes', 'Poste de concreto'),
  ('231497', 'Postes', 'Poste de concreto'),
  ('231540', 'Postes', 'Poste de concreto'),
  ('231541', 'Postes', 'Poste de concreto'),
  ('231542', 'Postes', 'Poste de concreto'),
  ('231543', 'Postes', 'Poste de concreto'),
  ('231546', 'Postes', 'Poste de concreto'),
  ('231547', 'Postes', 'Poste de concreto'),
  ('231548', 'Postes', 'Poste de concreto'),
  ('231549', 'Postes', 'Poste de concreto'),
  ('231550', 'Postes', 'Poste de concreto'),
  ('231551', 'Postes', 'Poste de madeira/eucalipto'),
  ('231552', 'Postes', 'Poste de madeira/eucalipto'),
  ('231553', 'Postes', 'Poste de concreto'),
  ('231554', 'Postes', 'Poste de madeira/eucalipto'),
  ('231555', 'Postes', 'Poste de madeira/eucalipto'),
  ('231556', 'Postes', 'Poste de madeira/eucalipto'),
  ('231557', 'Postes', 'Poste de concreto'),
  ('231558', 'Postes', 'Poste de concreto'),
  ('231559', 'Postes', 'Poste de concreto'),
  ('231560', 'Postes', 'Poste de concreto'),
  ('231562', 'Postes', 'Poste de fibra'),
  ('231565', 'Postes', 'Poste de fibra'),
  ('231569', 'Postes', 'Poste de fibra'),
  ('231570', 'Postes', 'Poste de fibra'),
  ('231572', 'Postes', 'Poste de fibra'),
  ('231576', 'Postes', 'Poste de concreto'),
  ('231578', 'Postes', 'Poste de concreto'),
  ('231580', 'Postes', 'Poste de concreto'),
  ('231581', 'Postes', 'Poste de concreto'),
  ('231584', 'Postes', 'Poste de concreto'),
  ('231586', 'Postes', 'Poste de concreto'),
  ('231601', 'Postes', 'Poste de concreto'),
  ('231606', 'Postes', 'Poste de concreto'),
  ('231612', 'Postes', 'Poste de aço'),
  ('231615', 'Postes', 'Poste de concreto'),
  ('231616', 'Postes', 'Poste de concreto'),
  ('231617', 'Postes', 'Poste de concreto'),
  ('231618', 'Postes', 'Poste de concreto'),
  ('231619', 'Postes', 'Poste de concreto'),
  ('231620', 'Postes', 'Poste de concreto'),
  ('231621', 'Postes', 'Poste de concreto'),
  ('231622', 'Postes', 'Poste de madeira/eucalipto'),
  ('231623', 'Postes', 'Poste de madeira/eucalipto'),
  ('231624', 'Postes', 'Poste de concreto'),
  ('231625', 'Postes', 'Poste de concreto'),
  ('231626', 'Postes', 'Poste de madeira/eucalipto'),
  ('231627', 'Postes', 'Poste de fibra'),
  ('231629', 'Postes', 'Poste de concreto'),
  ('231630', 'Postes', 'Poste de concreto'),
  ('231656', 'Postes', 'Torres/estruturas metálicas'),
  ('231666', 'Postes', 'Poste de aço'),
  ('231669', 'Postes', 'Poste de aço'),
  ('231691', 'Postes', 'Poste de concreto'),
  ('231848', 'Postes', 'Poste de concreto'),
  ('232339', 'Postes', 'Poste de concreto'),
  ('232340', 'Postes', 'Poste de concreto'),
  ('232341', 'Postes', 'Poste de concreto'),
  ('232342', 'Postes', 'Poste de concreto'),
  ('232343', 'Postes', 'Poste de concreto'),
  ('232344', 'Postes', 'Poste de concreto'),
  ('232345', 'Postes', 'Poste de concreto'),
  ('232348', 'Postes', 'Poste bipartido'),
  ('240009', 'Ferragens e estruturas', 'Cruzeta'),
  ('240092', 'Ferragens e estruturas', 'Suportes'),
  ('240093', 'Ferragens e estruturas', 'Suportes'),
  ('240094', 'Ferragens e estruturas', 'Suportes'),
  ('240095', 'Ferragens e estruturas', 'Suportes'),
  ('240096', 'Ferragens e estruturas', 'Suportes'),
  ('240097', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('240099', 'Ferragens e estruturas', 'Armação secundária'),
  ('240100', 'Ferragens e estruturas', 'Armação secundária'),
  ('240107', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('240116', 'Ferragens e estruturas', 'Armação secundária'),
  ('240117', 'Ferragens e estruturas', 'Armação secundária'),
  ('240118', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('240119', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('240120', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('240121', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('240130', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('240131', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('240133', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('240139', 'Identificação e lacres', 'Placas/identificação'),
  ('240140', 'Identificação e lacres', 'Placas/identificação'),
  ('240172', 'Ferragens e estruturas', 'Suportes'),
  ('250032', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('250042', 'Ferragens e estruturas', 'Suportes'),
  ('250043', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('251651', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251659', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251692', 'Ferragens e estruturas', 'Suportes'),
  ('251697', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251698', 'Proteção e manobra', 'Para-raios'),
  ('251709', 'Isoladores e acessórios', 'Espaçador de rede compacta'),
  ('251712', 'Ferragens e estruturas', 'Grampos/conjuntos de ancoragem'),
  ('251713', 'Ferragens e estruturas', 'Grampos/conjuntos de ancoragem'),
  ('251714', 'Ferragens e estruturas', 'Suportes'),
  ('251715', 'Ferragens e estruturas', 'Suportes'),
  ('251755', 'Ferragens e estruturas', 'Grampos/conjuntos de ancoragem'),
  ('251765', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251771', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251775', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251777', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251783', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251786', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251797', 'Ferragens e estruturas', 'Olhais, manilhas e sapatilhas'),
  ('251814', 'Ferragens e estruturas', 'Olhais, manilhas e sapatilhas'),
  ('251817', 'Ferragens e estruturas', 'Olhais, manilhas e sapatilhas'),
  ('251831', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('251832', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251833', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251834', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251835', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251836', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251837', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251838', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('251839', 'Ferragens e estruturas', 'Suportes'),
  ('251841', 'Proteção e manobra', 'Para-raios'),
  ('251842', 'Ferragens e estruturas', 'Suportes'),
  ('251843', 'Ferragens e estruturas', 'Suportes'),
  ('251844', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251845', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251846', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251847', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251849', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251850', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251851', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('251852', 'Proteção e manobra', 'Para-raios'),
  ('251853', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251854', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251855', 'Ferragens e estruturas', 'Suportes'),
  ('251856', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251857', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251858', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251859', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251860', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251861', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251862', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251863', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251864', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251865', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251866', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251867', 'Ferragens e estruturas', 'Armação secundária'),
  ('251870', 'Ferragens e estruturas', 'Grampos/conjuntos de ancoragem'),
  ('251871', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('251872', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('251873', 'Ferragens e estruturas', 'Armação secundária'),
  ('251874', 'Ferragens e estruturas', 'Armação secundária'),
  ('251875', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('251876', 'Consumíveis de instalação', 'Fitas e isolação'),
  ('251877', 'Ferragens e estruturas', 'Olhais, manilhas e sapatilhas'),
  ('251878', 'Ferragens e estruturas', 'Grampos/conjuntos de ancoragem'),
  ('251880', 'Isoladores e acessórios', 'Isolador de pino'),
  ('251881', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251882', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251884', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('251885', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('251886', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('251887', 'Isoladores e acessórios', 'Espaçador de rede compacta'),
  ('251888', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251889', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('251890', 'Ferragens e estruturas', 'Olhais, manilhas e sapatilhas'),
  ('251891', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251892', 'Ferragens e estruturas', 'Olhais, manilhas e sapatilhas'),
  ('251893', 'Ferragens e estruturas', 'Olhais, manilhas e sapatilhas'),
  ('251894', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251898', 'Ferragens e estruturas', 'Olhais, manilhas e sapatilhas'),
  ('251899', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('251901', 'Proteção e manobra', 'Para-raios'),
  ('251902', 'Ferragens e estruturas', 'Suportes'),
  ('251903', 'Ferragens e estruturas', 'Suportes'),
  ('251904', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251905', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251906', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251907', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251908', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251909', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251912', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('251913', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251914', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251915', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251917', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251919', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251921', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251922', 'Proteção e manobra', 'Para-raios'),
  ('251927', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251928', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('251930', 'Ferragens e estruturas', 'Grampos/conjuntos de ancoragem'),
  ('251931', 'Proteção e manobra', 'Para-raios'),
  ('251941', 'Proteção e manobra', 'Para-raios'),
  ('251942', 'Ferragens e estruturas', 'Suportes'),
  ('251953', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('251954', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('251956', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('251965', 'Isoladores e acessórios', 'Espaçador de rede compacta'),
  ('251969', 'Ferragens e estruturas', 'Suportes'),
  ('251970', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251971', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251972', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251973', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('251974', 'Proteção e manobra', 'Para-raios'),
  ('251975', 'Isoladores e acessórios', 'Espaçador de rede compacta'),
  ('252009', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('252019', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('252020', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('252021', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('252022', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('252036', 'Isoladores e acessórios', 'Pino/distanciador para isolador'),
  ('252052', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('252137', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('252138', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('252145', 'Medição', 'Caixa/padrão de medição'),
  ('252192', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('252262', 'Ferragens e estruturas', 'Grampos/conjuntos de ancoragem'),
  ('252347', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('252364', 'Ferragens e estruturas', 'Suportes'),
  ('252615', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('252867', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('252868', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('270171', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('270421', 'Isoladores e acessórios', 'Cobertura/protetor isolante'),
  ('274903', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('274919', 'Conectores, emendas e terminações', 'Conector cunha'),
  ('274921', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('274973', 'Conectores, emendas e terminações', 'Luva de emenda/compressão'),
  ('274985', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('274987', 'Conectores, emendas e terminações', 'Conector cunha'),
  ('274988', 'Conectores, emendas e terminações', 'Conector cunha'),
  ('274994', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('274996', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('274997', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275000', 'Conectores, emendas e terminações', 'Conector cunha'),
  ('275009', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('275010', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('275028', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275069', 'Conectores, emendas e terminações', 'Luva de emenda'),
  ('275070', 'Conectores, emendas e terminações', 'Luva de emenda'),
  ('275072', 'Conectores, emendas e terminações', 'Luva de emenda'),
  ('275076', 'Conectores, emendas e terminações', 'Conector cunha'),
  ('275077', 'Conectores, emendas e terminações', 'Conector cunha'),
  ('275078', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275082', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275083', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275084', 'Conectores, emendas e terminações', 'Conector cunha'),
  ('275090', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275091', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275097', 'Proteção e manobra', 'Fusível'),
  ('275100', 'Conectores, emendas e terminações', 'Terminação/terminal'),
  ('275101', 'Conectores, emendas e terminações', 'Conector/emenda - outros'),
  ('275104', 'Proteção e manobra', 'Para-raios'),
  ('275116', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275124', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275125', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275133', 'Isoladores e acessórios', 'Cobertura/protetor isolante'),
  ('275138', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275139', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275153', 'Conectores, emendas e terminações', 'Conector cunha'),
  ('275154', 'Conectores, emendas e terminações', 'Conector cunha'),
  ('275155', 'Conectores, emendas e terminações', 'Conector cunha'),
  ('275156', 'Isoladores e acessórios', 'Cobertura/protetor isolante'),
  ('275169', 'Conectores, emendas e terminações', 'Conector cunha'),
  ('275245', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275313', 'Conectores, emendas e terminações', 'Emenda'),
  ('275356', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('275629', 'Conectores, emendas e terminações', 'Conector de compressão'),
  ('275695', 'Conectores, emendas e terminações', 'Conector perfurante'),
  ('275721', 'Conectores, emendas e terminações', 'Luva de emenda'),
  ('275897', 'Isoladores e acessórios', 'Cobertura/protetor isolante'),
  ('276656', 'Conectores, emendas e terminações', 'Emenda'),
  ('276661', 'Conectores, emendas e terminações', 'Conector perfurante'),
  ('276662', 'Conectores, emendas e terminações', 'Conector perfurante'),
  ('276682', 'Conectores, emendas e terminações', 'Emenda'),
  ('280047', 'Caixas, painéis e barramentos', 'Caixa/gabinete - outros'),
  ('280048', 'Medição', 'Caixa/padrão de medição'),
  ('280051', 'Caixas, painéis e barramentos', 'Caixa para disjuntor'),
  ('280052', 'Medição', 'Caixa/padrão de medição'),
  ('280053', 'Medição', 'Caixa/padrão de medição'),
  ('280055', 'Medição', 'Caixa/padrão de medição'),
  ('280056', 'Medição', 'Caixa/padrão de medição'),
  ('280064', 'Caixas, painéis e barramentos', 'Caixa/gabinete - outros'),
  ('300030', 'Isoladores e acessórios', 'Isolador de pino'),
  ('300032', 'Isoladores e acessórios', 'Isolador de pino'),
  ('300583', 'Isoladores e acessórios', 'Isolador disco/vidro'),
  ('300589', 'Isoladores e acessórios', 'Isolador pilar'),
  ('300590', 'Isoladores e acessórios', 'Isolador pilar'),
  ('300597', 'Isoladores e acessórios', 'Isolador - outros'),
  ('300614', 'Isoladores e acessórios', 'Isolador pilar'),
  ('300644', 'Isoladores e acessórios', 'Isolador pilar'),
  ('300647', 'Isoladores e acessórios', 'Isolador roldana'),
  ('300653', 'Isoladores e acessórios', 'Isolador de pino'),
  ('300654', 'Isoladores e acessórios', 'Isolador disco/vidro'),
  ('300655', 'Isoladores e acessórios', 'Isolador roldana'),
  ('300657', 'Isoladores e acessórios', 'Isolador de pino'),
  ('300662', 'Isoladores e acessórios', 'Isolador - outros'),
  ('300667', 'Isoladores e acessórios', 'Isolador - outros'),
  ('300670', 'Isoladores e acessórios', 'Isolador de pino'),
  ('300682', 'Isoladores e acessórios', 'Isolador disco/vidro'),
  ('300692', 'Isoladores e acessórios', 'Isolador roldana'),
  ('300699', 'Isoladores e acessórios', 'Isolador - outros'),
  ('300853', 'Isoladores e acessórios', 'Isolador de ancoragem/suspensão'),
  ('300854', 'Isoladores e acessórios', 'Isolador de pino'),
  ('310434', 'Cabos e condutores', 'Condutor nu'),
  ('310513', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310515', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310539', 'Cabos e condutores', 'Condutor nu'),
  ('310551', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310552', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310558', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('310567', 'Cabos e condutores', 'Condutor nu'),
  ('310571', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310600', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310601', 'Cabos e condutores', 'Condutor nu'),
  ('310602', 'Cabos e condutores', 'Condutor nu'),
  ('310603', 'Cabos e condutores', 'Condutor nu'),
  ('310604', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310605', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310606', 'Cabos e condutores', 'Condutor nu'),
  ('310607', 'Cabos e condutores', 'Condutor nu'),
  ('310608', 'Cabos e condutores', 'Condutor nu'),
  ('310609', 'Cabos e condutores', 'Condutor nu'),
  ('310611', 'Cabos e condutores', 'Condutor nu'),
  ('310614', 'Cabos e condutores', 'Cordoalha'),
  ('310633', 'Cabos e condutores', 'Condutor nu'),
  ('310635', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310636', 'Cabos e condutores', 'Condutor nu'),
  ('310638', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310648', 'Conectores, emendas e terminações', 'Emenda'),
  ('310654', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310740', 'Cabos e condutores', 'Condutor nu'),
  ('310760', 'Cabos e condutores', 'Cordoalha'),
  ('310777', 'Cabos e condutores', 'Cordoalha'),
  ('310778', 'Cabos e condutores', 'Cordoalha'),
  ('310789', 'Cabos e condutores', 'Condutor nu'),
  ('310790', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310791', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310793', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310795', 'Cabos e condutores', 'Condutor nu'),
  ('310796', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310805', 'Cabos e condutores', 'Condutor nu'),
  ('310806', 'Cabos e condutores', 'Condutor nu'),
  ('310825', 'Cabos e condutores', 'Condutor nu'),
  ('310835', 'Cabos e condutores', 'Condutor nu'),
  ('310837', 'Cabos e condutores', 'Condutor nu'),
  ('310838', 'Cabos e condutores', 'Condutor nu'),
  ('310839', 'Cabos e condutores', 'Condutor nu'),
  ('310840', 'Cabos e condutores', 'Condutor nu'),
  ('310841', 'Cabos e condutores', 'Condutor nu'),
  ('310842', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310843', 'Cabos e condutores', 'Condutor nu'),
  ('310844', 'Cabos e condutores', 'Condutor nu'),
  ('310845', 'Cabos e condutores', 'Condutor nu'),
  ('310847', 'Cabos e condutores', 'Condutor nu'),
  ('310848', 'Cabos e condutores', 'Condutor nu'),
  ('310849', 'Cabos e condutores', 'Condutor nu'),
  ('310850', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310851', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310856', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('310868', 'Proteção e manobra', 'Seccionador'),
  ('310869', 'Proteção e manobra', 'Seccionador'),
  ('310906', 'Cabos e condutores', 'Cordoalha'),
  ('311001', 'Cabos e condutores', 'Condutor nu'),
  ('330287', 'Cabos e condutores', 'Cabo concêntrico'),
  ('330302', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330324', 'Cabos e condutores', 'Cabo concêntrico'),
  ('330325', 'Cabos e condutores', 'Cabo concêntrico'),
  ('330530', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330685', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330699', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330700', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330701', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330725', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330727', 'Cabos e condutores', 'Cabo/condutor isolado'),
  ('330738', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330746', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330767', 'Cabos e condutores', 'Fio/amarração'),
  ('330768', 'Cabos e condutores', 'Fio/amarração'),
  ('330770', 'Cabos e condutores', 'Fio/amarração'),
  ('330771', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330772', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330773', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330774', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330778', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330779', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330780', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330787', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330790', 'Cabos e condutores', 'Cabo concêntrico'),
  ('330795', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330797', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330798', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330802', 'Cabos e condutores', 'Cabo coberto'),
  ('330810', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330812', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330815', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330816', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330817', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330823', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330853', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330854', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330855', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330868', 'Cabos e condutores', 'Cabo coberto'),
  ('330869', 'Cabos e condutores', 'Cabo coberto'),
  ('330870', 'Cabos e condutores', 'Cabo coberto'),
  ('330871', 'Cabos e condutores', 'Cabo coberto'),
  ('330887', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330890', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330893', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330894', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330895', 'Cabos e condutores', 'Cabo concêntrico'),
  ('330896', 'Cabos e condutores', 'Cabo concêntrico'),
  ('330897', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330898', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330899', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330900', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330901', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330902', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330904', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330906', 'Cabos e condutores', 'Cabo concêntrico'),
  ('330909', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330918', 'Cabos e condutores', 'Cabo/condutor isolado'),
  ('330925', 'Cabos e condutores', 'Cabo/condutor isolado'),
  ('330937', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330942', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330943', 'Cabos e condutores', 'Condutor nu'),
  ('330952', 'Cabos e condutores', 'Cabo/condutor isolado'),
  ('330954', 'Cabos e condutores', 'Cabo/condutor isolado'),
  ('330955', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330957', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330960', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330961', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330964', 'Cabos e condutores', 'Cabo/condutor isolado'),
  ('330967', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330968', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330969', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330970', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330971', 'Cabos e condutores', 'Cabo/condutor isolado'),
  ('330972', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330975', 'Cabos e condutores', 'Cabo concêntrico'),
  ('330976', 'Cabos e condutores', 'Cabo concêntrico'),
  ('330977', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330978', 'Cabos e condutores', 'Cabo/condutor isolado'),
  ('330979', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('330980', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330984', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330990', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330991', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330992', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330993', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('330994', 'Cabos e condutores', 'Cabo pré-reunido'),
  ('331260', 'Cabos e condutores', 'Cabo/condutor isolado'),
  ('340411', 'Cabos e condutores', 'Cabo/condutor isolado'),
  ('350418', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('350420', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('350497', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('350498', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('350524', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('350529', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('350530', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('350537', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('350548', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('350610', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('400043', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('400045', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('400046', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('470084', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('480313', 'Automação e telecomando', 'Telecontrole/comunicação'),
  ('480399', 'Medição', 'Medidor de energia'),
  ('500107', 'Equipamentos de rede', 'Regulador de tensão'),
  ('500163', 'Equipamentos de rede', 'Regulador de tensão'),
  ('500164', 'Equipamentos de rede', 'Regulador de tensão'),
  ('500165', 'Equipamentos de rede', 'Regulador de tensão'),
  ('500167', 'Proteção e manobra', 'Religador'),
  ('500175', 'Equipamentos de rede', 'Regulador de tensão'),
  ('500186', 'Equipamentos de rede', 'Regulador de tensão'),
  ('500274', 'Equipamentos de rede', 'Regulador de tensão'),
  ('510131', 'Medição', 'Medidor de energia'),
  ('510133', 'Medição', 'Medidor de energia'),
  ('510136', 'Medição', 'Medidor de energia'),
  ('510440', 'Medição', 'Medidor de energia'),
  ('510441', 'Medição', 'Telemedição/acessório de medição'),
  ('510446', 'Medição', 'Medidor de energia'),
  ('510452', 'Medição', 'Medidor de energia'),
  ('510455', 'Medição', 'Medidor de energia'),
  ('510456', 'Medição', 'Medidor de energia'),
  ('510458', 'Medição', 'Telemedição/acessório de medição'),
  ('510459', 'Medição', 'Telemedição/acessório de medição'),
  ('510460', 'Medição', 'Medidor de energia'),
  ('510461', 'Medição', 'Medidor de energia'),
  ('510462', 'Medição', 'Medidor de energia'),
  ('510463', 'Medição', 'Medidor de energia'),
  ('510464', 'Medição', 'Medidor de energia'),
  ('510482', 'Medição', 'Medidor de energia'),
  ('510484', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('510486', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('510488', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('510490', 'Medição', 'Medidor de energia'),
  ('510502', 'Medição', 'Medidor de energia'),
  ('510511', 'Medição', 'Concentrador de medição'),
  ('510523', 'Medição', 'Conjunto de medição'),
  ('510524', 'Medição', 'Conjunto de medição'),
  ('510546', 'Medição', 'Medidor de energia'),
  ('510556', 'Automação e telecomando', 'Telecontrole/comunicação'),
  ('510570', 'Medição', 'Medidor de energia'),
  ('510571', 'Medição', 'Medidor de energia'),
  ('510574', 'Medição', 'Medidor de energia'),
  ('510587', 'Medição', 'Medidor de energia'),
  ('510598', 'Medição', 'Medidor de energia'),
  ('510599', 'Medição', 'Medidor de energia'),
  ('510695', 'Medição', 'Medidor de energia'),
  ('510696', 'Medição', 'Medidor de energia'),
  ('510697', 'Medição', 'Medidor de energia'),
  ('510698', 'Medição', 'Medidor de energia'),
  ('510699', 'Medição', 'Medidor de energia'),
  ('510700', 'Medição', 'Medidor de energia'),
  ('510701', 'Medição', 'Medidor de energia'),
  ('510704', 'Medição', 'Módulo de medição'),
  ('510705', 'Medição', 'Medição - outros'),
  ('510706', 'Medição', 'Medição - outros'),
  ('510707', 'Medição', 'Medição - outros'),
  ('510709', 'Medição', 'Medição - outros'),
  ('510710', 'Medição', 'Medição - outros'),
  ('510711', 'Medição', 'Medição - outros'),
  ('510712', 'Medição', 'Medição - outros'),
  ('510736', 'Medição', 'Medição - outros'),
  ('510738', 'Medição', 'Conjunto de medição'),
  ('510739', 'Medição', 'Medidor de energia'),
  ('510740', 'Medição', 'Medidor de energia'),
  ('510741', 'Medição', 'Medidor de energia'),
  ('510742', 'Medição', 'Módulo de medição'),
  ('510745', 'Medição', 'Medidor de energia'),
  ('510746', 'Medição', 'Medidor de energia'),
  ('510747', 'Medição', 'Medidor de energia'),
  ('510750', 'Medição', 'Medidor de energia'),
  ('510751', 'Medição', 'Medidor de energia'),
  ('510752', 'Medição', 'Medidor de energia'),
  ('510754', 'Medição', 'Medidor de energia'),
  ('510755', 'Medição', 'Medidor de energia'),
  ('510757', 'Medição', 'Conjunto de medição'),
  ('510758', 'Medição', 'Concentrador de medição'),
  ('510759', 'Medição', 'Concentrador de medição'),
  ('510760', 'Medição', 'Medidor de energia'),
  ('510761', 'Medição', 'Medidor de energia'),
  ('510762', 'Medição', 'Medidor de energia'),
  ('510763', 'Medição', 'Medidor de energia'),
  ('510764', 'Medição', 'Telemedição/acessório de medição'),
  ('510765', 'Medição', 'Medidor de energia'),
  ('510766', 'Medição', 'Concentrador de medição'),
  ('510768', 'Medição', 'Medidor de energia'),
  ('510769', 'Medição', 'Medidor de energia'),
  ('510771', 'Medição', 'Medidor de energia'),
  ('510780', 'Medição', 'Medidor de energia'),
  ('510781', 'Medição', 'Medidor de energia'),
  ('510783', 'Medição', 'Medidor de energia'),
  ('510784', 'Medição', 'Medidor de energia'),
  ('510789', 'Medição', 'Medidor de energia'),
  ('510837', 'Proteção e manobra', 'Relé/detector de proteção'),
  ('510852', 'Medição', 'Medidor de energia'),
  ('510870', 'Proteção e manobra', 'Para-raios'),
  ('510903', 'Medição', 'Medidor de energia'),
  ('510905', 'Medição', 'Medidor de energia'),
  ('510906', 'Medição', 'Medidor de energia'),
  ('510907', 'Medição', 'Medidor de energia'),
  ('510908', 'Medição', 'Medidor de energia'),
  ('510909', 'Medição', 'Medidor de energia'),
  ('510910', 'Medição', 'Medidor de energia'),
  ('510915', 'Medição', 'Medidor de energia'),
  ('510918', 'Medição', 'Medidor de energia'),
  ('511151', 'Medição', 'Medição - outros'),
  ('511152', 'Medição', 'Concentrador de medição'),
  ('511194', 'Medição', 'Medidor de energia'),
  ('511196', 'Medição', 'Medidor de energia'),
  ('511198', 'Medição', 'Medidor de energia'),
  ('511201', 'Medição', 'Medidor de energia'),
  ('511202', 'Medição', 'Telemedição/acessório de medição'),
  ('511205', 'Medição', 'Medidor de energia'),
  ('511206', 'Medição', 'Telemedição/acessório de medição'),
  ('511207', 'Medição', 'Medidor de energia'),
  ('511208', 'Medição', 'Concentrador de medição'),
  ('511220', 'Medição', 'Concentrador de medição'),
  ('511224', 'Medição', 'Medidor de energia'),
  ('520420', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('520421', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('520431', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('520432', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('520433', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('520434', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('520436', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('520438', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('530073', 'Medição', 'Conjunto de medição'),
  ('530076', 'Medição', 'Conjunto de medição'),
  ('530077', 'Medição', 'Conjunto de medição'),
  ('530078', 'Medição', 'Conjunto de medição'),
  ('530208', 'Medição', 'Conjunto de medição'),
  ('530209', 'Medição', 'Conjunto de medição'),
  ('530211', 'Medição', 'Conjunto de medição'),
  ('530213', 'Medição', 'Conjunto de medição'),
  ('530214', 'Medição', 'Conjunto de medição'),
  ('530215', 'Medição', 'Conjunto de medição'),
  ('531333', 'Medição', 'Transformador de corrente (TC)'),
  ('531388', 'Ferragens e estruturas', 'Suportes'),
  ('531389', 'Ferragens e estruturas', 'Suportes'),
  ('531395', 'Medição', 'Transformador de corrente (TC)'),
  ('531403', 'Medição', 'Transformador de corrente (TC)'),
  ('531408', 'Medição', 'Transformador de potencial (TP)'),
  ('531413', 'Medição', 'Transformador de corrente (TC)'),
  ('531414', 'Medição', 'Transformador de corrente (TC)'),
  ('531415', 'Medição', 'Transformador de corrente (TC)'),
  ('531417', 'Medição', 'Transformador de potencial (TP)'),
  ('531418', 'Medição', 'Transformador de potencial (TP)'),
  ('531419', 'Medição', 'Transformador de potencial (TP)'),
  ('531435', 'Medição', 'Transformador de corrente (TC)'),
  ('531437', 'Medição', 'Transformador de corrente (TC)'),
  ('531439', 'Medição', 'Transformador de potencial (TP)'),
  ('531448', 'Caixas, painéis e barramentos', 'Caixa/gabinete - outros'),
  ('531455', 'Medição', 'Transformador de corrente (TC)'),
  ('531507', 'Medição', 'Transformador de corrente (TC)'),
  ('531508', 'Medição', 'Transformador de corrente (TC)'),
  ('531509', 'Medição', 'Transformador de corrente (TC)'),
  ('531511', 'Medição', 'Transformador de corrente (TC)'),
  ('531553', 'Medição', 'Transformador de corrente (TC)'),
  ('531565', 'Medição', 'Transformador de potencial (TP)'),
  ('531577', 'Medição', 'Transformador de potencial (TP)'),
  ('531581', 'Ferragens e estruturas', 'Suportes'),
  ('531584', 'Transformadores', 'Transformador - outros'),
  ('531585', 'Transformadores', 'Transformador bifásico'),
  ('531740', 'Medição', 'Conjunto de medição'),
  ('531741', 'Medição', 'Conjunto de medição'),
  ('531743', 'Medição', 'Conjunto de medição'),
  ('531744', 'Medição', 'Conjunto de medição'),
  ('531745', 'Medição', 'Conjunto de medição'),
  ('531747', 'Medição', 'Conjunto de medição'),
  ('531748', 'Medição', 'Conjunto de medição'),
  ('580066', 'Automação e telecomando', 'Telecontrole/comunicação'),
  ('580092', 'Automação e telecomando', 'Monitoramento de rede'),
  ('600028', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('600099', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('600265', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('600788', 'Isoladores e acessórios', 'Espaçador de rede compacta'),
  ('601513', 'Postes', 'Poste de fibra'),
  ('602122', 'Automação e telecomando', 'Telecontrole/comunicação'),
  ('620054', 'Identificação e lacres', 'Selos e lacres'),
  ('620056', 'Identificação e lacres', 'Selos e lacres'),
  ('620098', 'Proteção e manobra', 'Chave - outros'),
  ('620099', 'Medição', 'Caixa/padrão de medição'),
  ('620100', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('620101', 'Ferragens e estruturas', 'Acessório de parafuso'),
  ('620105', 'Identificação e lacres', 'Selos e lacres'),
  ('640548', 'Dutos e infraestrutura', 'Eletrodutos/dutos e acessórios'),
  ('640612', 'Dutos e infraestrutura', 'Eletrodutos/dutos e acessórios'),
  ('640615', 'Dutos e infraestrutura', 'Eletrodutos/dutos e acessórios'),
  ('640619', 'Dutos e infraestrutura', 'Eletrodutos/dutos e acessórios'),
  ('640647', 'Dutos e infraestrutura', 'Eletrodutos/dutos e acessórios'),
  ('760199', 'Medição', 'Caixa/padrão de medição'),
  ('780566', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780570', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780571', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780572', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780573', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780580', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780581', 'Dutos e infraestrutura', 'Eletrodutos/dutos e acessórios'),
  ('780596', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('780597', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('780607', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780653', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780654', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780655', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780656', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780657', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780659', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780671', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780710', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780720', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780724', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('780730', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('780742', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('780743', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('780744', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('780745', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('780747', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('780748', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780749', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('780750', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780751', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780752', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780753', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780754', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780755', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780756', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780758', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780759', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780760', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780761', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780762', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780763', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780764', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780765', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780767', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780768', 'Isoladores e acessórios', 'Isolador de pino'),
  ('780769', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780770', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780771', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780772', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780773', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780774', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780775', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780777', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780778', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780779', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780780', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780781', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780782', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780783', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780784', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780785', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780786', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780787', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780788', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780820', 'Isoladores e acessórios', 'Pino/distanciador para isolador'),
  ('780859', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('780908', 'Identificação e lacres', 'Selos e lacres'),
  ('781084', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('800246', 'Conectores, emendas e terminações', 'Emenda'),
  ('800250', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('800258', 'Proteção e manobra', 'Lâmina/acessório de chave'),
  ('800268', 'Postes', 'Poste de concreto'),
  ('800482', 'Postes', 'Poste de concreto'),
  ('800483', 'Postes', 'Poste de concreto'),
  ('800484', 'Postes', 'Poste de concreto'),
  ('820088', 'Ferragens e estruturas', 'Cruzeta'),
  ('820091', 'Proteção e manobra', 'Chave - outros'),
  ('820093', 'Isoladores e acessórios', 'Isolador - outros'),
  ('820097', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('820098', 'Cabos e condutores', 'Cordoalha'),
  ('820099', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('820100', 'Postes', 'Poste - outros'),
  ('820106', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('820167', 'Identificação e lacres', 'Placas/identificação'),
  ('820526', 'Cabos e condutores', 'Fio/amarração'),
  ('850386', 'Aterramento', 'Haste de aterramento'),
  ('850387', 'Aterramento', 'Haste de aterramento'),
  ('850388', 'Identificação e lacres', 'Etiquetas/adesivos'),
  ('850389', 'Identificação e lacres', 'Etiquetas/adesivos'),
  ('850390', 'Identificação e lacres', 'Etiquetas/adesivos'),
  ('850391', 'Identificação e lacres', 'Etiquetas/adesivos'),
  ('850392', 'Identificação e lacres', 'Etiquetas/adesivos'),
  ('850393', 'Identificação e lacres', 'Etiquetas/adesivos'),
  ('850394', 'Identificação e lacres', 'Etiquetas/adesivos'),
  ('850395', 'Identificação e lacres', 'Etiquetas/adesivos'),
  ('850396', 'Identificação e lacres', 'Etiquetas/adesivos'),
  ('850397', 'Identificação e lacres', 'Etiquetas/adesivos'),
  ('850412', 'Identificação e lacres', 'Selos e lacres'),
  ('850600', 'Identificação e lacres', 'Etiquetas/adesivos'),
  ('850611', 'Aterramento', 'Haste de aterramento'),
  ('850634', 'Segurança - EPI/EPC', 'EPC/sinalização de segurança'),
  ('860211', 'Consumíveis de instalação', 'Fitas e isolação'),
  ('860311', 'Consumíveis de instalação', 'Vedação/selagem'),
  ('860333', 'Consumíveis de instalação', 'Fitas e isolação'),
  ('860339', 'Identificação e lacres', 'Selos e lacres'),
  ('860342', 'Consumíveis de instalação', 'Fitas e isolação'),
  ('860344', 'Consumíveis de instalação', 'Fitas e isolação'),
  ('910400', 'Materiais diversos', 'Expediente/embalagem'),
  ('970780', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('970789', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('970798', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('970799', 'Sucata genérica', 'Sucata sem família técnica clara'),
  ('970801', 'Automação e telecomando', 'Telecontrole/comunicação'),
  ('990243', 'Proteção e manobra', 'Para-raios'),
  ('990257', 'Conectores, emendas e terminações', 'Conector perfurante'),
  ('990292', 'Isoladores e acessórios', 'Isolador de pino'),
  ('990293', 'Isoladores e acessórios', 'Isolador de ancoragem/suspensão'),
  ('990342', 'Cabos e condutores', 'Cabo concêntrico'),
  ('990345', 'Cabos e condutores', 'Cabo concêntrico'),
  ('990346', 'Cabos e condutores', 'Cabo concêntrico'),
  ('990356', 'Medição', 'Transformador de potencial (TP)'),
  ('990362', 'Medição', 'Transformador de potencial (TP)'),
  ('4545523', 'Conectores, emendas e terminações', 'Conector - outros'),
  ('4679895', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('4682711', 'Ferragens e estruturas', 'Suportes'),
  ('4682712', 'Ferragens e estruturas', 'Suportes'),
  ('4682715', 'Ferragens e estruturas', 'Suportes'),
  ('4682827', 'Ferragens e estruturas', 'Grampos/conjuntos de ancoragem'),
  ('4682974', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('4683266', 'Conectores, emendas e terminações', 'Terminação/terminal'),
  ('6770186', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('6771968', 'Ferragens e estruturas', 'Cruzeta'),
  ('6772018', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('6772019', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('6772020', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('6772021', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('6772022', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('6772025', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('6772026', 'Ferragens e estruturas', 'Ferragem/estrutura - outros'),
  ('6772031', 'Proteção e manobra', 'Para-raios'),
  ('6772065', 'Ferragens e estruturas', 'Alças e laços preformados'),
  ('6772092', 'Ferragens e estruturas', 'Armação secundária'),
  ('6772094', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('6772143', 'Ferragens e estruturas', 'Braços, cantoneiras e mão francesa'),
  ('6772144', 'Ferragens e estruturas', 'Olhais, manilhas e sapatilhas'),
  ('6772149', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('6772151', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('6772155', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('6772160', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('6772161', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('6772162', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('6772178', 'Ferragens e estruturas', 'Olhais, manilhas e sapatilhas'),
  ('6772225', 'Conectores, emendas e terminações', 'Conector de compressão'),
  ('6772266', 'Isoladores e acessórios', 'Isolador roldana'),
  ('6772351', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('6773386', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('6773388', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('6773389', 'Ferragens e estruturas', 'Parafusos, porcas e arruelas'),
  ('6775801', 'Ferragens e estruturas', 'Cintas, abraçadeiras e colares'),
  ('6795954', 'Aterramento', 'Haste de aterramento'),
  ('6796315', 'Conectores, emendas e terminações', 'Conector de aterramento'),
  ('6813088', 'Cabos e condutores', 'Condutor nu'),
  ('9900005512', 'Segurança - EPI/EPC', 'EPC/sinalização de segurança'),
  ('9900011479', 'Cabos e condutores', 'Cabo/condutor - outros'),
  ('9900011910', 'Isoladores e acessórios', 'Isolador de pino'),
  ('9900012549', 'Segurança - EPI/EPC', 'EPI'),
  ('9900012551', 'Segurança - EPI/EPC', 'EPI');

do $$
declare
  v_conflicting_codes text;
begin
  select string_agg(codigo, ', ' order by codigo)
    into v_conflicting_codes
  from (
    select codigo
    from material_category_backfill
    group by codigo
    having count(distinct category_name || '|' || subcategory_name) > 1
  ) conflicts;

  if v_conflicting_codes is not null then
    raise exception 'Migration 378 bloqueada: codigos com categoria/subcategoria divergentes: %', v_conflicting_codes;
  end if;
end
$$;

with source_categories as (
  select distinct category_name
  from material_category_backfill
), ranked_categories as (
  select
    category_name,
    row_number() over (order by category_name) * 10 as sort_order
  from source_categories
)
insert into public.material_categories (tenant_id, name, is_active, sort_order)
select
  tenants.id,
  ranked_categories.category_name,
  true,
  ranked_categories.sort_order
from public.tenants tenants
cross join ranked_categories
on conflict (tenant_id, name) do update
set
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

with source_subcategories as (
  select distinct category_name, subcategory_name
  from material_category_backfill
), ranked_subcategories as (
  select
    category_name,
    subcategory_name,
    row_number() over (partition by category_name order by subcategory_name) * 10 as sort_order
  from source_subcategories
)
insert into public.material_subcategories (tenant_id, category_id, name, is_active, sort_order)
select
  categories.tenant_id,
  categories.id,
  ranked_subcategories.subcategory_name,
  true,
  ranked_subcategories.sort_order
from ranked_subcategories
join public.material_categories categories
  on categories.name = ranked_subcategories.category_name
on conflict (tenant_id, category_id, name) do update
set
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

with source_rows as (
  select
    upper(btrim(codigo)) as codigo,
    max(category_name) as category_name,
    max(subcategory_name) as subcategory_name
  from material_category_backfill
  group by upper(btrim(codigo))
), target_rows as (
  select
    materials.id,
    materials.tenant_id,
    previous_categories.name as previous_category_name,
    previous_subcategories.name as previous_subcategory_name,
    categories.id as category_id,
    categories.name as category_name,
    subcategories.id as subcategory_id,
    subcategories.name as subcategory_name
  from public.materials materials
  join source_rows
    on upper(btrim(materials.codigo)) = source_rows.codigo
  join public.material_categories categories
    on categories.tenant_id = materials.tenant_id
   and categories.name = source_rows.category_name
  join public.material_subcategories subcategories
    on subcategories.tenant_id = materials.tenant_id
   and subcategories.category_id = categories.id
   and subcategories.name = source_rows.subcategory_name
  left join public.material_categories previous_categories
    on previous_categories.id = materials.category_id
   and previous_categories.tenant_id = materials.tenant_id
  left join public.material_subcategories previous_subcategories
    on previous_subcategories.id = materials.subcategory_id
   and previous_subcategories.tenant_id = materials.tenant_id
  where materials.category_id is distinct from categories.id
     or materials.subcategory_id is distinct from subcategories.id
), updated_materials as (
  update public.materials materials
  set
    category_id = target_rows.category_id,
    subcategory_id = target_rows.subcategory_id
  from target_rows
  where materials.id = target_rows.id
    and materials.tenant_id = target_rows.tenant_id
  returning
    materials.id,
    materials.tenant_id,
    target_rows.previous_category_name,
    target_rows.previous_subcategory_name,
    target_rows.category_name,
    target_rows.subcategory_name
)
insert into public.material_history (
  tenant_id,
  material_id,
  change_type,
  changes
)
select
  tenant_id,
  id,
  'UPDATE',
  jsonb_build_object(
    'categoryId', jsonb_build_object('from', previous_category_name, 'to', category_name),
    'subcategoryId', jsonb_build_object('from', previous_subcategory_name, 'to', subcategory_name)
  )
from updated_materials;

alter table if exists public.materials validate constraint materials_subcategory_requires_category_check;
alter table if exists public.materials validate constraint materials_category_tenant_fk;
alter table if exists public.materials validate constraint materials_subcategory_tenant_category_fk;

drop function if exists public.save_material_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  numeric,
  text,
  jsonb,
  timestamptz,
  numeric,
  numeric
);

create or replace function public.save_material_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_material_id uuid default null,
  p_codigo text default null,
  p_descricao text default null,
  p_category_id uuid default null,
  p_subcategory_id uuid default null,
  p_umb text default null,
  p_tipo text default null,
  p_is_transformer boolean default false,
  p_unit_price numeric default null,
  p_serial_tracking_type text default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null,
  p_stock_minimum numeric default 0,
  p_stock_maximum numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.materials%rowtype;
  v_material_id uuid;
  v_updated_at timestamptz;
  v_tipo text := upper(btrim(coalesce(p_tipo, '')));
  v_umb text := upper(btrim(coalesce(p_umb, '')));
  v_unit_price numeric := coalesce(p_unit_price, 0);
  v_stock_minimum numeric := coalesce(p_stock_minimum, 0);
  v_stock_maximum numeric := p_stock_maximum;
  v_serial_tracking_type text := upper(btrim(coalesce(
    p_serial_tracking_type,
    case when coalesce(p_is_transformer, false) then 'TRAFO' else 'NONE' end
  )));
  v_current_serial_tracking_type text;
  v_is_transformer boolean;
  v_has_serial_tracking_usage boolean := false;
begin
  if p_category_id is null or p_subcategory_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'CATEGORY_REQUIRED', 'message', 'Categoria e subcategoria sao obrigatorias para cadastro de material.');
  end if;

  if not exists (
    select 1
    from public.material_subcategories subcategories
    join public.material_categories categories
      on categories.id = subcategories.category_id
     and categories.tenant_id = subcategories.tenant_id
    where categories.tenant_id = p_tenant_id
      and categories.id = p_category_id
      and categories.is_active = true
      and subcategories.id = p_subcategory_id
      and subcategories.is_active = true
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_CATEGORY', 'message', 'Categoria ou subcategoria invalida para o tenant atual.');
  end if;

  if v_umb = '' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'UMB_REQUIRED', 'message', 'UMB obrigatorio para cadastro de material.');
  end if;

  if not exists (
    select 1
    from public.material_umb_options options
    where options.tenant_id = p_tenant_id
      and options.code = v_umb
      and options.is_active = true
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_UMB', 'message', 'UMB invalida. Selecione M, KG ou UN.');
  end if;

  if v_tipo not in ('NOVO', 'SUCATA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_TYPE', 'message', 'Tipo invalido. Selecione NOVO ou SUCATA.');
  end if;

  if v_unit_price < 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_UNIT_PRICE', 'message', 'Preco invalido. Informe valor maior ou igual a zero.');
  end if;

  if v_stock_minimum < 0 or (v_stock_maximum is not null and v_stock_maximum < v_stock_minimum) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_STOCK_LIMITS', 'message', 'Limites de estoque invalidos. O maximo deve ser vazio ou maior/igual ao minimo.');
  end if;

  if v_serial_tracking_type not in ('NONE', 'TRAFO', 'RELIGADOR', 'CHAVE') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_SERIAL_TRACKING_TYPE', 'message', 'Tipo de rastreio por serial invalido.');
  end if;

  v_is_transformer := v_serial_tracking_type = 'TRAFO';

  if p_material_id is null then
    insert into public.materials (
      tenant_id,
      codigo,
      descricao,
      category_id,
      subcategory_id,
      umb,
      tipo,
      is_transformer,
      serial_tracking_type,
      unit_price,
      stock_minimum,
      stock_maximum,
      is_active,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_codigo,
      p_descricao,
      p_category_id,
      p_subcategory_id,
      v_umb,
      v_tipo,
      v_is_transformer,
      v_serial_tracking_type,
      v_unit_price,
      v_stock_minimum,
      v_stock_maximum,
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_material_id, v_updated_at;

    return jsonb_build_object('success', true, 'status', 200, 'material_id', v_material_id, 'updated_at', v_updated_at);
  end if;

  select *
  into v_current
  from public.materials
  where id = p_material_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MATERIAL_NOT_FOUND', 'message', 'Material nao encontrado para edicao.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de editar o material.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', format('O material %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.codigo));
  end if;

  if not v_current.is_active then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'RECORD_INACTIVE', 'message', 'Ative o material antes de editar.');
  end if;

  v_current_serial_tracking_type := upper(btrim(coalesce(
    v_current.serial_tracking_type,
    case when coalesce(v_current.is_transformer, false) then 'TRAFO' else 'NONE' end
  )));

  if v_current_serial_tracking_type in ('TRAFO', 'RELIGADOR', 'CHAVE')
    and v_current_serial_tracking_type <> v_serial_tracking_type
  then
    select (
      exists (
        select 1
        from public.trafo_instances ti
        where ti.tenant_id = p_tenant_id
          and ti.material_id = p_material_id
        limit 1
      )
      or exists (
        select 1
        from public.stock_transfer_items sti
        where sti.tenant_id = p_tenant_id
          and sti.material_id = p_material_id
          and nullif(btrim(coalesce(sti.serial_number, '')), '') is not null
        limit 1
      )
    )
    into v_has_serial_tracking_usage;

    if coalesce(v_has_serial_tracking_usage, false) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'SERIAL_TRACKING_IN_USE', 'message', 'Este material possui rastreio por serial em uso. Para alterar ou remover o rastreio, execute uma rotina de encerramento/reconciliacao.');
    end if;
  end if;

  update public.materials
  set
    codigo = p_codigo,
    descricao = p_descricao,
    category_id = p_category_id,
    subcategory_id = p_subcategory_id,
    umb = v_umb,
    tipo = v_tipo,
    is_transformer = v_is_transformer,
    serial_tracking_type = v_serial_tracking_type,
    unit_price = v_unit_price,
    stock_minimum = v_stock_minimum,
    stock_maximum = v_stock_maximum,
    updated_by = p_actor_user_id
  where id = p_material_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_material_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
    insert into public.material_history (
      tenant_id,
      material_id,
      change_type,
      changes,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_material_id,
      'UPDATE',
      coalesce(p_changes, '{}'::jsonb),
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object('success', true, 'status', 200, 'material_id', v_material_id, 'updated_at', v_updated_at);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_MATERIAL_CODE', 'message', 'Ja existe material com este codigo no tenant atual.');
end;
$$;

revoke all on function public.save_material_record(uuid, uuid, uuid, text, text, uuid, uuid, text, text, boolean, numeric, text, jsonb, timestamptz, numeric, numeric) from public;
revoke all on function public.save_material_record(uuid, uuid, uuid, text, text, uuid, uuid, text, text, boolean, numeric, text, jsonb, timestamptz, numeric, numeric) from anon;
revoke all on function public.save_material_record(uuid, uuid, uuid, text, text, uuid, uuid, text, text, boolean, numeric, text, jsonb, timestamptz, numeric, numeric) from authenticated;
grant execute on function public.save_material_record(uuid, uuid, uuid, text, text, uuid, uuid, text, text, boolean, numeric, text, jsonb, timestamptz, numeric, numeric) to service_role;

do $$
declare
  v_source_count integer;
  v_matched_count integer;
begin
  select count(*) into v_source_count from (
    select distinct upper(btrim(codigo)) as codigo
    from material_category_backfill
  ) source_codes;

  select count(distinct upper(btrim(materials.codigo)))
    into v_matched_count
  from public.materials materials
  join material_category_backfill source_rows
    on upper(btrim(materials.codigo)) = upper(btrim(source_rows.codigo));

  raise notice 'Migration 378: % codigos fonte; % codigos encontrados em public.materials.', v_source_count, v_matched_count;
end
$$;

commit;
