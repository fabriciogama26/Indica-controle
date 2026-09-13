-- 436_add_people_nome_trigram_index.sql
-- Indice trigram para acelerar o filtro de busca por texto (ilike '%termo%') em
-- people.nome, hoje sem indice compativel com wildcard nas duas pontas.

create extension if not exists pg_trgm;

create index if not exists idx_people_tenant_nome_trgm
  on public.people using gin (nome gin_trgm_ops);
