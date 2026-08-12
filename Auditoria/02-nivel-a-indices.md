# Nível A — Auditoria de índices

Extraído de `supabase/migrations/*.sql` (371 arquivos), aplicando `CREATE INDEX` e `DROP INDEX` em ordem de migration para obter o **estado vivo**, não o acumulado histórico.

> **Ressalva:** este é o estado *segundo as migrations*. Se o banco de produção divergir (índice criado à mão, índice do Supabase Advisor), o Nível B corrige — o script `pg_indexes` em [`03`](03-nivel-b-pg-stat-statements.md#5-inventário-real-de-índices) reconcilia.

---

## 1. Números

| Métrica | Valor |
|---|---|
| Índices vivos | **258** em 104 tabelas |
| Índices criados no histórico | 271 |
| Índices dropados em migrations posteriores | 15 |
| Começam por `tenant_id` | **232** (90%) |
| `UNIQUE` | 29 |
| Parciais (`WHERE …`) | 39 |
| Sobre expressão (`lower()`, `upper()`, `->>`) | 7 |

### Tabelas com mais índices

| Índices | Tabela | Leitura |
|---|---|---|
| **19** | `project_programming` | write amplification — ver §4 |
| **17** | `project` | write amplification + 2 duplicatas exatas — ver §2 e §4 |
| 9 | `people` | 3 uniques parciais sobrepostos — aceitável (garantem regra de negócio) |
| 8 | `teams` | ver §3 |
| 7 | `project_measurement_orders` | nenhum cobre o filtro dominante — ver [`01` §5.1](01-nivel-a-mapa-consultas.md#51-minimumfactoranalysispage--risco-alto) |
| 7 | `stock_transfers` | adequado |
| 7 | `programming` | falta `(tenant_id, project_id, status, …)` — ver [`01` §5.5](01-nivel-a-mapa-consultas.md#55-programming-programação-normalizada--risco-médio-alto) |

---

## 2. Duplicatas exatas — **remover**

Dois pares com colunas e predicado idênticos. Um dos dois de cada par é 100% morto: o planner nunca escolhe os dois, e ambos são mantidos a cada `INSERT`/`UPDATE`/`DELETE`.

| Tabela | Índice A | Índice B | Colunas | Origem |
|---|---|---|---|---|
| `project` | `idx_project_tenant_priority` | `idx_project_tenant_priority_uuid` | `(tenant_id, priority)` | `029` e `038` |
| `project` | `idx_project_tenant_city` | `idx_project_tenant_city_uuid` | `(tenant_id, city)` | `029` e `038` |
| `project` | constraint `unique (tenant_id, sob)` | `idx_project_tenant_sob` | `(tenant_id, sob)` | ambos na `029` |

**Causa:** a migration `038_project_lookup_uuid_columns.sql` converteu `priority` e `city` de texto para UUID e recriou os índices com sufixo `_uuid`, mas só dropou `idx_project_priority_id` e `idx_project_municipality_id` — deixou os originais `029` de pé.

**Correção:**

```sql
-- migration 365
-- Dropa `_uuid` somente quando o par sem sufixo tambem existe e a assinatura em
-- pg_index e identica. Se so o `_uuid` existe, ele e o indice valido e fica.
```

Correcao apos teste real da 365: nao assumir que os nomes sem `_uuid` existem. Em replay limpo ou ambiente ja saneado, a 038 pode ter removido os indices originais ao renomear/dropar as colunas texto; nesse caso `idx_project_tenant_priority_uuid` e `idx_project_tenant_city_uuid` sao os unicos indices validos e devem ser preservados.

Segunda correcao apos teste real da 365: a propria 029 cria `unique (tenant_id, sob)` e tambem `idx_project_tenant_sob`. O indice da constraint UNIQUE cobre a busca por `(tenant_id, sob)` e preserva a regra de unicidade; o indice nao-unique e redundante e pode ser removido quando o UNIQUE equivalente existir.

> **Severidade: MÉDIO / Confiança: Alta.** Ganho é de escrita e espaço, não de leitura. Seguro: um índice duplicado exato nunca é o único caminho de nenhuma consulta. **É o único item desta auditoria que pode ir para produção sem passar pelo Nível B.**

---

## 3. Prefixos redundantes — **avaliar**

Índice A cujas colunas são prefixo exato de B, com o mesmo predicado. B atende tudo que A atende.

| Tabela | Redundante (A) | Contido em (B) |
|---|---|---|
| `project_programming` | `idx_project_programming_tenant_date_team` `(tenant_id, execution_date, team_id)` | `idx_project_programming_tenant_date_team_active` `(tenant_id, execution_date, team_id, is_active)` |
| `programming` | `idx_programming_tenant_work_completion_status` `(tenant_id, work_completion_status)` | `programming_tenant_work_completion_idx` `(tenant_id, work_completion_status, execution_date)` |

Em ambos os casos o índice mais curto é ligeiramente menor (menos páginas para varrer), então não é remoção automática — mas a diferença é marginal e o custo de manter dois é permanente.

Caso adicional, de natureza diferente:

| Tabela | Observação |
|---|---|
| `teams` | `idx_teams_tenant_stock_center (tenant_id, stock_center_id) WHERE stock_center_id is not null` coexiste com `idx_teams_unique_stock_center (stock_center_id) WHERE stock_center_id is not null` **UNIQUE**. Como o unique é global e `stock_center_id` é único no sistema inteiro, ele já resolve qualquer busca por centro. O índice com `tenant_id` é redundante na prática. |

> **Severidade: BAIXO / Confiança: Média.** Verificar `idx_scan` real no Nível B (§5 de [`03`](03-nivel-b-pg-stat-statements.md)) antes de dropar. Um índice com `idx_scan = 0` após semanas de tráfego é candidato — nunca com base só na forma.

---

## 4. Write amplification

`project_programming` (19 índices) e `project` (17) pagam, em **todo** `INSERT` e em todo `UPDATE` que toque uma coluna indexada, a atualização de todos os índices afetados. É gravação extra de WAL — e WAL vai para disco. Numa tabela com escrita frequente, isso **é** Disk I/O.

### `project` — 8 índices sobre coluna booleana

```
idx_project_tenant_has_locacao      (tenant_id, has_locacao)
idx_project_tenant_fob              (tenant_id, fob)
idx_project_tenant_is_test          (tenant_id, is_test)
idx_project_tenant_is_withdrawn     (tenant_id, is_withdrawn)
idx_project_tenant_is_third_party   (tenant_id, is_third_party)
idx_project_tenant_is_active        (tenant_id, is_active, updated_at desc)
idx_project_tenant_priority(_uuid)  (tenant_id, priority)      ← duplicado
idx_project_tenant_city(_uuid)      (tenant_id, city)          ← duplicado
```

Um booleano tem cardinalidade 2. Um índice `(tenant_id, bool)` só é útil quando o valor filtrado é **raro** dentro do tenant. Para `is_active = true` — que é a maioria das linhas — o planner tende a preferir `Seq Scan`. Os índices `is_test`, `is_withdrawn`, `is_third_party` provavelmente se justificam (o valor `true` é minoria), mas seriam mais eficazes como **índices parciais**:

```sql
-- em vez de (tenant_id, is_test)
create index idx_project_tenant_is_test_partial
  on public.project (tenant_id) where is_test = true;
```

Índice parcial só contém as linhas que interessam: menor, mais rápido, e — o ponto principal aqui — **não é atualizado** quando uma linha com `is_test = false` sofre `UPDATE`.

E, como as consultas reais combinam esses booleanos (`is_active + is_test + is_third_party`, ver [`01` §9](01-nivel-a-mapa-consultas.md#9-view-project_with_labels)), o caminho melhor é **um composto que cubra o conjunto** em vez de cinco índices isolados.

> **Severidade: MÉDIO / Confiança: Média.** Depende de estatística real de distribuição. Script para medir em [`03` §6](03-nivel-b-pg-stat-statements.md#6-seletividade-real-das-colunas-booleanas).

### `project_programming` — 19 índices, incluindo 2 sobre chamada de função

```sql
idx_project_programming_one_active_completed_per_project     -- DROPADO em migration posterior
idx_project_programming_active_completed_project_group
  (tenant_id, project_id, programming_group_id)
  where status in ('PROGRAMADA','REPROGRAMADA')
    and work_completion_status is not null
    and ( public.normalize_programming_work_completion_code(work_completion_status)
            in ('CONCLUIDO','COMPLETO')
          or public.normalize_programming_work_completion_code(work_completion_status)
            like 'CONCLUIDO%' )
```

O predicado chama `public.normalize_programming_work_completion_code()` **duas vezes por linha** na avaliação do índice. Para o índice funcionar como constraint, a função precisa ser `IMMUTABLE` — se for, o Postgres pode cachear; se for `STABLE`, o `CREATE INDEX` teria falhado. Confirmar no Nível C se o custo aparece em `INSERT`/`UPDATE`.

> Isto é o item 21 da checklist ("migrations que criam estruturas que pioram performance"): a estrutura resolve corretamente uma regra de unicidade de negócio, mas cobra em toda escrita. **Não remover** — é constraint, não otimização. Registrar como custo conhecido.

---

## 5. Índices que **não** começam por `tenant_id` — todos justificados

26 casos, revisados um a um. Nenhum é achado:

| Categoria | Índices | Por quê está certo |
|---|---|---|
| Tabelas sem `tenant_id` | `tenants`, `app_pages`, `app_roles`, `stock_transfer_reversal_reason_catalog` | catálogos globais |
| Lookup por identidade de auth | `idx_app_users_auth_user_id`, `idx_app_users_login_name_unique`, `idx_app_users_role_id`, `app_user_tenants` (2) | o login acontece **antes** de saber o tenant |
| Unicidade global proposital | `ux_project_apr_controls_apr_id_global`, `idx_teams_unique_stock_center`, `uq_programming_team_active_per_stage`, `uq_programming_activity_active_per_stage` | a regra de negócio é global, não por tenant |
| Auditoria / infra | `login_audit` (4), `app_error_logs`, `rate_limit_events`, `idempotency_requests`, `sync_run*` (3), `app_user_permission_history` | consultadas por operador, não por tenant |
| Rastreio de migração legada | `idx_programming_history_legacy_history_id`, `idx_project_programming_history_source_history` | chave externa de importação |

✅ **A cobertura de `tenant_id` neste schema está correta.** Item 12 da checklist: aprovado.

---

## 6. Foreign keys sem índice

Não é determinável só pelas migrations — exige `pg_constraint` real. O PostgreSQL **não** cria índice automaticamente para a coluna que referencia (só para a referenciada, via PK/unique). Sem índice na FK, todo `DELETE` ou `UPDATE` da tabela pai dispara `Seq Scan` na filha para validar a constraint.

Script em [`03` §7](03-nivel-b-pg-stat-statements.md#7-foreign-keys-sem-índice). **Obrigatório rodar** — este projeto tem 105 tabelas com relacionamento denso.

Pelo que as migrations mostram, o padrão de nomear `idx_<tabela>_tenant_<fk>` foi seguido de forma consistente (`idx_project_service_center_id`, `idx_project_location_activities_tenant_activity`, `idx_stock_requisition_request_items_material`…), o que sugere boa cobertura. Confirmar, não assumir.

---

## 7. RLS — por que não é o gargalo aqui

**308 policies** criadas nas migrations. O padrão dominante:

```sql
create policy materials_tenant_select on public.materials
for select using (
  exists (
    select 1 from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = materials.tenant_id
  )
);
```

Esse padrão é o anti-padrão clássico de RLS: `auth.uid()` sem `(select …)` é reavaliado **por linha**, e a subquery em `app_users` roda por linha. **65 ocorrências** de `auth.uid()` fora de `(select auth.uid())` nas migrations.

A migration `300_fix_supabase_advisor_performance_warnings.sql` corrigiu esse padrão — mas **apenas** em `app_users` e `app_user_tenants`, fechando os warnings `auth_rls_initplan` e `multiple_permissive_policies` que o Advisor apontou. As demais tabelas mantêm `auth.uid()` direto.

**Por que isso não é ALTO neste projeto:** conforme [`01` §2](01-nivel-a-mapa-consultas.md#2-modelo-de-acesso--descoberta-que-reordena-a-auditoria), **100% das consultas da aplicação usam `service_role`**, que faz bypass de RLS. Nenhuma policy é avaliada no caminho quente. O frontend não fala com o PostgREST.

**Portanto:**

- Como **performance**: INFORMATIVO. Corrigir não muda o Disk I/O de nenhuma tela.
- Como **defesa em profundidade**: as policies continuam corretas e necessárias — se um dia uma rota passar a usar o token do usuário, ou se alguém expuser a anon key, elas são a única barreira.
- **Se e quando** o projeto migrar rotas para o cliente autenticado do usuário, este item vira **ALTO imediatamente** e a correção é mecânica:

```sql
-- antes                          -- depois
where au.auth_user_id = auth.uid()
where au.auth_user_id = (select auth.uid())
```

O `(select …)` transforma a chamada em InitPlan — avaliada **uma vez** por query, não por linha.

> **Severidade: INFORMATIVO hoje / ALTO condicional.** Registrar em `TASKS.md` como pré-requisito de qualquer migração para cliente autenticado.

---

## 8. Índices — **CANDIDATOS**, não faltantes

> ### `CANDIDATE — awaiting pg_stat_statements / EXPLAIN`
>
> Nenhum item desta seção é um "índice faltante a criar". São **candidatos** levantados por análise estática, aguardando medição. A distinção não é semântica: cada índice adicional cobra custo permanente em `INSERT`, `UPDATE`, `VACUUM`, cache e armazenamento. Análise estática gera candidato; **produção decide se vale o índice**.
>
> Só promover de `CANDIDATE` para `APPLY` quando as duas condições forem satisfeitas:
> 1. **Nível B** confirmar que a consulta tem custo acumulado (`total_exec_time`) relevante — não basta o padrão de filtro se repetir no código;
> 2. **Nível C** confirmar, com `EXPLAIN (ANALYZE, BUFFERS)` antes/depois, que o plano muda e os blocos lidos do disco caem.

| # | Tabela | Índice candidato | Evidência estática | Status |
|---|---|---|---|---|
| 1 | `project_measurement_orders` | `(tenant_id, measurement_kind, is_active, status, execution_date)` | 6 consultas em 4 rotas — o padrão de filtro mais repetido do repositório; os índices atuais ou não têm `execution_date` ou o colocam na 2ª posição, cortando tudo depois | `CANDIDATE` — aguarda B + C-1 |
| 2 | `programming` | `(tenant_id, project_id, status, execution_date)` | 4 consultas em `medicao` + `programacao-normalizada`; nenhum índice não-parcial começa por `(tenant_id, project_id)` | `CANDIDATE` — aguarda B + C-4 |
| 3 | `project` | `(tenant_id, is_active, is_test, is_third_party, sob)` | 11 usos de `project_with_labels` com `ORDER BY sob`, sem índice que atenda a ordenação | `CANDIDATE` — aguarda B + C-2 |
| 4 | `project_billing_orders` | `(tenant_id, updated_at desc)` | 1 listagem sem filtro de status | `CANDIDATE` — evidência fraca; só investigar se o Nível B destacar |

**A justificativa do candidato 1 é a mais forte das quatro** — 6 consultas em 4 rotas, e o desalinhamento com os índices existentes é demonstrável sem medir. Ainda assim permanece `CANDIDATE`: força de justificativa estática não substitui frequência real. Se o Nível B mostrar que essas 6 consultas somam 2% do `total_exec_time`, o índice não se paga.

**Resultado possível e legítimo:** o Nível B derrubar todos os quatro. Registrar isso é tão valioso quanto aprová-los — evita que a mesma proposta volte em seis meses.

E as remoções:

| # | Ação | Risco |
|---|---|---|
| 5 | `drop index idx_project_tenant_priority_uuid` | nenhum — duplicata exata |
| 6 | `drop index idx_project_tenant_city_uuid` | nenhum — duplicata exata |
| 7 | avaliar `idx_project_programming_tenant_date_team` | baixo — coberto por `..._active` |
| 8 | avaliar `idx_programming_tenant_work_completion_status` | baixo — coberto por `..._idx` |
| 9 | avaliar `idx_teams_tenant_stock_center` | baixo — coberto pelo unique global |

### ⚠️ `CONCURRENTLY` não funciona nas migrations deste projeto

Erro real ao aplicar a migration `365`:

```
ERROR: 25001: DROP INDEX CONCURRENTLY cannot run inside a transaction block
```

**O Supabase CLI executa o arquivo de migration inteiro dentro de uma transação**, não statement a statement. Como `CREATE INDEX CONCURRENTLY` e `DROP INDEX CONCURRENTLY` são proibidos em bloco transacional pelo PostgreSQL, eles **não podem** aparecer num arquivo de migration aqui.

> Correção de rumo: a primeira versão deste documento mandava usar `create index concurrently if not exists` *"conforme `guias/guia_sql.md`"*. **Aquele guia não contém essa regra** — a citação estava errada, e a receita também. Todas as receitas de índice desta auditoria foram corrigidas para `create index if not exists`.

**O que fazer em cada caso:**

| Situação | Caminho |
|---|---|
| Tabela pequena (o caso deste projeto — banco de 90 MB) | `create index if not exists` / `drop index if exists` direto na migration. O `ACCESS EXCLUSIVE` dura milissegundos: é mudança de catálogo, não reescrita de dados. É o padrão já usado em 15 dos 18 `drop index` do repositório, incluindo a migration `300`. |
| Tabela grande o bastante para o lock incomodar | Rodar o `CONCURRENTLY` **fora** da migration (SQL editor ou `psql`), e registrar no `README.txt` das migrations que o índice foi criado manualmente — senão o schema versionado passa a divergir do banco. |

Medir `EXPLAIN` antes/depois no PR continua valendo em qualquer um dos dois caminhos.
