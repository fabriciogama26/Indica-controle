# CRC — Pessoas

> CRC = Componente / Responsabilidade / Colaboradores
> Este arquivo descreve o que o módulo faz, quem são seus arquivos principais e como eles se relacionam.
> Atualizar sempre que houver mudança estrutural no módulo.

---

## Visão Geral

**Tela:** `Pessoas`
**Rota:** `/pessoas`
**Page Key (permissão):** `pessoas`
**Arquivo de documentação:** não existe `docs/Pessoas.txt` ainda.

**O que esta tela faz (em 1-3 frases):**
> Cadastro de pessoas (colaboradores) do tenant, com cargo/tipo/nível, CPF e telefone opcionais, listagem
> paginada no servidor, histórico de alterações, cancelamento/ativação e importação/exportação em massa.

---

## Arquivos do Módulo

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/dashboard/pessoas/PeoplePageView.tsx` | Componente principal da tela (form, filtros, tabela, import/export) |
| `src/app/api/people/route.ts` | Route Handler — GET (lista/histórico), POST (criar/import em lote), PUT, PATCH |
| `src/app/api/people/export/route.ts` | Route Handler — exportação CSV em uma única resposta (`loadAllRows`) |
| `src/app/api/people/meta/route.ts` | Route Handler — catálogos ativos do tenant (cargos, tipos, níveis) |
| `src/server/modules/people/list.ts` | Query de listagem (`listPeopleRows`) e enriquecimento de nomes (`enrichPeopleRows`), compartilhados por GET e export |
| `src/server/modules/people/import.ts` | Importação em massa: pré-carrega catálogos/duplicidade em lote e chama a RPC de insert em lote |
| `src/server/modules/people/errors.ts` | Mapeamento de erro de banco para `{ status, reason, message }` |

---

## API Routes Utilizadas

| Método | Endpoint | O que faz | Queries (Supabase) |
|---|---|---|---|
| GET | `/api/people` | Lista paginada (20/página) com filtros, ou histórico quando `historyPersonId` é passado | 1 query de listagem (`count: exact`) + `enrichPeopleRows` (até 3 queries em lote) |
| GET | `/api/people/export` | Exporta a lista filtrada inteira, sem paginação | `loadAllRows` (N blocos de até 1.000) + `enrichPeopleRows` (até 3 queries em lote) |
| GET | `/api/people/meta` | Catálogos ativos do tenant (cargos, tipos, níveis) | 3 queries |
| POST | `/api/people` | Criação unitária, ou `action=BATCH_IMPORT` para lote (até 500 linhas) | Unitária: até ~5 queries + 1 RPC. Lote: 3 queries de catálogo + até 2 queries `.in()` de duplicidade + 1 RPC (`save_person_records_batch`) para o arquivo inteiro |
| PUT | `/api/people` | Edição unitária com controle de concorrência (`expectedUpdatedAt`) | ~5 queries + 1 RPC (`save_person_record`) |
| PATCH | `/api/people` | Cancelar/ativar com motivo obrigatório | 1 query + 1 RPC (`set_person_record_status`) |

---

## Tabelas Supabase Acessadas

| Tabela | Operação | Filtros principais | Índice necessário |
|---|---|---|---|
| `people` | SELECT/INSERT/UPDATE | `tenant_id`, `ativo`, `nome` (ilike), `matriculation` (ilike/eq), `cpf` (ilike), `phone` (ilike) | ✅ `idx_people_tenant_active(tenant_id, ativo, nome)`; ✅ `idx_people_tenant_nome_trgm` (GIN trigram, migration 436) para busca por nome; ❌ falta trigram em `matriculation`/`cpf`/`phone` (fora de escopo, decisão registrada) |
| `job_titles` | SELECT | `tenant_id`, `ativo` | ✅ `idx_job_titles_tenant_active` |
| `job_title_types` | SELECT | `tenant_id`, `ativo`, `job_title_id` | ✅ `idx_people_tenant_job_title_type` (na tabela `people`, FK composta) |
| `job_levels` | SELECT | `tenant_id`, `ativo` | ✅ `idx_people_tenant_job_level` (FK composta) |
| `app_users` | SELECT | `tenant_id`, `id` (`.in()`) | ✅ |
| `app_entity_history` | SELECT/INSERT | `tenant_id`, `module_key = pessoas`, `entity_table = people`, `entity_id` | ✅ |

---

## Regras de Negócio Principais

1. **Matrícula única por tenant:** `people.matriculation` tem índice único por tenant (migration 197). Duplicidade é checada em lote na importação (`.in()`) e por constraint no insert/update unitário.
2. **CPF único por tenant, quando informado:** índice único parcial (`where cpf is not null`, migration 199); combinação CPF+matrícula também é única.
3. **Tipo de cargo obrigatório para cargos específicos:** `ENCARREGADO DE TURMA`, `AJUDANTE DE ELETRICISTA`, `ELETRICISTA DE CONSTRUCAO` exigem `jobTitleTypeId` (`isJobTitleTypeRequired`, duplicada em `route.ts` para o fluxo unitário e em `server/modules/people/import.ts` para o lote — mesma regra, dois arquivos).
4. **Importação em massa é tudo-ou-nada por linha, não por arquivo:** uma linha inválida não impede as demais de serem salvas; o resultado é parcial (`savedCount` + `results` por linha).
5. **Concorrência otimista:** edição e cancelamento exigem `expectedUpdatedAt` batendo com o `updated_at` atual (`hasUpdatedAtConflict`).

---

## Pontos de Atenção (Riscos)

- [x] Há concorrência? Sim — edição/cancelamento usam `expectedUpdatedAt` + `select ... for update` nas RPCs.
- [ ] Há gravação parcial possível? Na importação em massa, sim, por definição (regra 4 acima) — não é um bug, é o comportamento esperado e documentado.
- [x] Há queries acima de 1.000 registros? A exportação (`loadAllRows`) pode passar de 1.000 e pagina internamente em blocos, com teto de segurança `maxRows = 20000` e flag `truncated` na resposta.
- [x] Há dependências com outros módulos? `job_titles`, `job_title_types`, `job_levels` (Cadastro Base > Cargo) e `app_users` (auditoria).
- [ ] `isJobTitleTypeRequired` está duplicada entre `route.ts` (fluxo unitário) e `server/modules/people/import.ts` (lote) — mesma lista de nomes hardcoded nos dois lugares; se a regra mudar, precisa mudar nos dois.

---

## Colaboradores (dependências externas)

| Módulo / Arquivo | Como usa |
|---|---|
| `src/lib/server/appUsersAdmin.ts` | Auth e tenant em todas as rotas |
| `src/lib/server/routeAuthorization.ts` | `authorizePageAction` para `create`/`update`/`cancel`/`import` |
| `src/lib/server/concurrency.ts` | Controle de conflito de edição (`expectedUpdatedAt`) |
| `src/lib/server/apiHelpers.ts` | `parsePagination`, `loadAllRows`, `fetchTenantLinkedAppUsers`, mapas de nome de usuário |
