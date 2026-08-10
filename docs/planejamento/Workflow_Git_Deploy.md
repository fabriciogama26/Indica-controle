# Workflow de Git e Deploy — diagnóstico e desenho-alvo

Levantamento feito em **2026-08-10** por leitura direta do repositório (`.github/workflows/`,
`package.json`, `vercel.json`, `supabase/`, guias), por medição do estado do Git, por varredura do
histórico completo e por consulta à API pública do GitHub.

Escopo: o caminho do código do commit até a publicação — CI no GitHub, deploy do frontend no
Vercel, aplicação de migrations no Supabase e deploy de Edge Functions.

Fora de escopo: o encadeamento operacional entre as telas, tratado em
`docs/planejamento/Workflow_Fluxo_Telas.md`.

> **Correção da primeira versão deste documento.** A revisão anterior afirmava que existiam
> 19 commits e 7 migrations não publicados desde 31/07. **Isso estava errado**: a medição usou um
> ref local `origin/main` desatualizado (parado no PR #523). O `main` real no GitHub está em
> `e0017e7`, de 2026-08-10 16:28 UTC, contendo os PRs **#524 a #539** — inclusive a migration 359.
> Não há código retido. Lição registrada: **nunca medir distância para produção por
> remote-tracking ref local sem `git fetch`**; usar o remoto como fonte.

---

## 1. Estado atual medido

| Item | Situação em 2026-08-10 |
|---|---|
| Visibilidade do repositório | **Público** (`"private": false` na API) |
| Workflows no GitHub | 1 arquivo, 1 job: `.github/workflows/ci.yml` → job `verify` |
| Passos do CI | ESLint (`npm run lint:eslint`), ratchet de tamanho (`npm run lint:size`), typecheck (`npx tsc --noEmit`) |
| Build no CI | **Não roda** — excluído por comentário no próprio `ci.yml` |
| Validação de `supabase/` no CI | **Nenhuma** — migrations e Edge Functions passam sem verificação |
| Saúde do CI | Verde em PR e em `main` nas execuções recentes |
| Bloqueio de merge | `verify` **não** está confirmado como required na branch protection |
| Gatilhos | `push` na `main` + `pull_request`; sem `concurrency`; sem filtro de path |
| Disciplina de PR | Alta — 539 PRs; os PRs #524–#539 mergeados entre 03/08 e 10/08 |
| Deploy do frontend | Integração Git do Vercel. `vercel.json` declara apenas `framework: nextjs` |
| Deploy do banco | **Manual**, pela CLI na máquina do dev. Não existe script `db:push` |
| Deploy de Edge Functions | **Manual**: `npm run fn:deploy*`, conforme `guias/runbook_deploy_edge_functions.md` |
| Ambientes | **Um único projeto Supabase** (`lcusxnhhrjosxqgiphgp`). Não existe staging |
| Migrations | **368 arquivos `.sql`**; **248 deles** referenciam `auth.*`, `service_role`, `authenticated` ou `anon` |
| Prefixos duplicados | **8 versões colidem**: 093, 120, 122, 127, 134, 161, 162, 235 |
| Edge Functions | 18 funções, imports por URL remota, sem `deno.json` nem import map |
| Versionamento | Nenhuma tag, nenhuma release |
| Pin de versão | Nenhum. CI fixa Node `20`; `engines` exige `>=20.9.0`; Vercel escolhe a própria; Supabase CLI e Deno não entram no CI hoje |
| Governança do repo | Sem Dependabot, sem CODEOWNERS, sem template de PR |
| Branches | **429 locais / 554 remotas**; **377 já mergeadas** e nunca deletadas |

### 1.1 O que o diagnóstico corrigido mostra

O **caminho do código** funciona: branch → PR → CI verde → merge → Vercel. São 539 PRs de cultura
estabelecida. Não é ali que está o problema, e o processo de desenvolvimento não precisa ser
reinventado.

O que não é governado é o **caminho do estado**: migrations e Edge Functions saem da máquina do
desenvolvedor, sem verificação no PR e sem registro no Git de quando foram aplicadas. A tese deste
documento é uma só:

> **O banco e as Edge Functions precisam alcançar o nível de governança que o frontend já tem.**

### 1.2 Visibilidade pública — o que é e o que não é risco

Repositório público **não é, por si só, vulnerabilidade**. Ter schema, RLS e estrutura SQL legíveis
não deve ser tratado como falha: a segurança do sistema não pode depender de terceiros
desconhecerem o schema. Se depende, o problema é o modelo de acesso, não a visibilidade.

O que a visibilidade torna obrigatório auditar:

**a) Funções `SECURITY DEFINER`**, neste funil:

```
SECURITY DEFINER
      ↓ search_path controlado?
      ↓ EXECUTE concedido somente a quem precisa?
      ↓ validação explícita de tenant/usuário no corpo?
      ↓ a função é alcançável diretamente via PostgREST?
      ↓ a RLS está sendo contornada intencionalmente?
```

Ferramentas já existentes: `npm run db:security-check` (estático sobre as migrations) e
`npm run db:security-check-live` (grants reais; exige link confirmado). O live vale mais — grant
declarado em migration não é grant vigente.

**b) O histórico completo do Git**, não só a árvore atual: remover um segredo hoje não o remove dos
commits anteriores.

**Varredura executada em 2026-08-10 — resultado limpo:**

| Padrão | Resultado |
|---|---|
| Arquivo `.env` / `.env.*` adicionado em qualquer commit | Apenas `.env.example` (b2332fc, 2026-03-07), sem valores |
| String JWT (`eyJ…`) introduzida em qualquer commit | Nenhuma ocorrência, em nenhuma revisão |
| Access token da CLI (`sbp_…`) | Nenhuma ocorrência |
| `SUPABASE_SERVICE_ROLE_KEY` | 21 commits, todos referenciando o **nome** da variável em código |

Nenhum segredo vazou. A varredura deve ser repetida se a visibilidade mudar ou antes de qualquer
divulgação do repositório.

---

## 2. Riscos, em ordem de severidade

### R1 — O estado do banco em produção não é conhecido a partir do Git
Migrations são aplicadas manualmente e fora do controle do repositório. Não existe registro de qual
é a última migration realmente aplicada, nem quais das 18 Edge Functions estão publicadas e de qual
commit vieram. Não é hipótese sobre atraso de código — é ausência de registro.

**Agravante medido:** os 8 prefixos duplicados (ver Ordem 0) tornam possível que o estado real do
schema divirja do que o repositório descreve, sem que nada tenha falhado visivelmente.

### R2 — Produção não é reproduzível como uma revisão Git única
Dado um incidente, não é possível responder "qual revisão corresponde ao que está no ar" — frontend,
schema e Edge Functions são publicados por caminhos independentes e só o primeiro deixa rastro.

### R3 — O primeiro lugar onde um erro aparece é a produção
O CI não roda `npm run build` nem valida `supabase/`. O Vercel constrói direto da `main`, e o banco
é aplicado à mão.

A justificativa registrada no `ci.yml` e no README **não se sustenta**. Verificado em 2026-08-10:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://dummy.supabase.co" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-anon" \
SUPABASE_URL="https://dummy.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="dummy-service" \
npm run build
```

O build concluiu e gerou todas as rotas. Os `throw` por variável ausente estão dentro de funções
(`src/services/auth/auth.service.ts`, `src/lib/server/appUsersAdmin.ts`), não em escopo de módulo.
**O build pode entrar no CI hoje, sem cadastrar nenhum secret.**

### R4 — Migration é ensaiada direto em produção
Não existe segundo projeto Supabase. A proteção é a atenção do operador.

### R5 — Não existe registro do que compõe uma versão em produção
554 branches, nenhuma tag, nenhuma release. Não há artefato que amarre código, schema e funções.

---

## 3. Definição de produção

> **Produção não é definida pela `main`. Produção é definida pela última release concluída com
> sucesso.**

A `main` diz o que *deveria* estar publicado. Só a release diz o que *está*. A distinção não é
formal: uma tag criada no merge afirmaria "este commit contém até a migration 359", que não é a
mesma afirmação que "a migration 359 está aplicada em produção" — e as duas divergem no primeiro
`db push` que falhar depois de um deploy bem-sucedido do Vercel.

Por isso a release é criada **depois** que todas as etapas terminaram e o smoke check passou:

```
Release           prod-2026.08.10.03
Git SHA           a82e91...
Vercel            deployment dpl_xxx
Database          migration 368
Edge Functions    import_project_forecast        @ <deploy sha>
                  import_project_activity_forecast @ <deploy sha>
                  ... (18)
Smoke check       PASS
Deployed at       2026-08-10 14:21
Actor             GitHub Actions / Fabrício
```

Com esse artefato, "qual versão está rodando?" passa a ter resposta em um identificador. É o que
fecha R2 e R5 — e o auto-delete de branch, embora recomendado, é higiene de repositório, não
versionamento de produção.

---

## 4. Fase 1 — o que entra agora

Deploy do Supabase continua **manual**. O que muda é que ele deixa de passar sem verificação.

> **Supabase fora do deploy automático: sim. Supabase fora do pipeline: não.**

Motivo medido: **248 das 368 migrations** tocam `auth.*`, `service_role`, `authenticated` ou `anon`.
Um PR pode ter frontend perfeito, `npm run build` verde e uma alteração de permissão quebrada. Sem
validação de `supabase/`, o CI dá verde para exatamente isso.

```
PR
│
├── FRONTEND / NEXT
│   ├── npm ci
│   ├── ESLint
│   ├── ratchet de tamanho
│   ├── tsc --noEmit
│   └── npm run build
│
├── MIGRATIONS            [somente se supabase/migrations/** mudou]
│   ├── migration-ratchet
│   │   ├── duplicação nova ............ BLOQUEIA
│   │   ├── legado conhecido ........... PERMITE (baseline)
│   │   └── migration publicada alterada  BLOQUEIA
│   └── supabase db reset
│       └── replay completo das 368 migrations
│
├── EDGE FUNCTIONS        [somente se supabase/functions/** mudou]
│   └── deno check
│
└── PROCESSO              [se migration mudou]
    └── PR declara: EXPAND / MIGRATE / CONTRACT
```

### 4.1 Migration ratchet — nasce com baseline, senão nasce vermelho

Um check de duplicidade **reprova a árvore atual no primeiro run**: já existem 8 versões colididas.
O contrato correto é o mesmo que o repositório já usa e entende em `scripts/check-file-size.mjs` —
legado registrado e congelado, novo bloqueado:

- duplicação **nova** → falha;
- duplicação **já no baseline** → passa;
- migration já publicada que foi **editada** → falha (regra hoje só textual em `guias/guia_sql.md`,
  e já violada uma vez — ver o realinhamento do 318 para 319).

### 4.2 `supabase db reset` — por que não basta um linter

"SQL está íntegro" não se valida sem banco: análise estática não vê referência a coluna
inexistente, assinatura de RPC trocada nem dependência fora de ordem.

Agravante específico deste repositório: **17 migrations reescrevem funções lendo o catálogo em
tempo de execução** via `pg_get_functiondef` + `replace` — 189, 193, 194, 202, 204, 211, 214, 216,
220, 221, 222, 223, 242, 276, 339, 351 e **359** (a mais recente). O resultado dessas migrations só
existe depois de aplicado; nenhum linter enxerga o que elas produzem.

`supabase db reset` recria o banco local e reaplica o diretório inteiro — que é exatamente o que
interessa para descobrir quebra de sequência e de dependência. **Postgres puro não serve**: 248
arquivos dependem de roles e schemas que só existem no stack do Supabase.

Duas ressalvas registradas: rodar **só quando o PR toca `supabase/**`** (filtro de path), e lembrar
que replay em banco vazio valida **schema, não backfill** — migration que passa vazia pode falhar
em produção com dados.

### 4.3 `deno check` — barato e adequado

As 18 funções importam por URL (`deno.land/std`, mais `../_shared/*.ts`), sem `deno.json` nem
import map. `deno check` faz type-check **sem executar** a função e pega quebra de `_shared` e erro
de tipo. É a melhor relação custo/benefício da lista.

### 4.4 Versões pinadas — parte da definição do ambiente

O CI **não** deve executar `npx supabase@latest` nem Deno "latest". Sem pin:

```
commit idêntico → segunda-feira: verde
                → quinta-feira: vermelho   (a ferramenta mudou)
```

Fixar **Node**, **Supabase CLI** e **Deno** em versões explícitas. Isso é especialmente relevante
para `supabase db reset`: houve regressões reportadas no próprio CLI envolvendo replay de
migrations, então a versão da ferramenta faz parte do que está sendo testado.

### 4.5 Teto declarado da Fase 1

> **A Fase 1 garante a integridade do artefato versionado. Não garante a sincronização do estado
> implantado em produção.**

Mesmo com migration ✅, código ✅ e Edge Function ✅, o GitHub não garante que produção esteja em
A+B+C, porque o deploy do Supabase segue manual. A declaração EXPAND/MIGRATE/CONTRACT no PR reduz o
risco operacional, mas não elimina a possibilidade de alguém mergear o código e esquecer o
`db push`. Essa lacuna só desaparece no Marco 2, quando o GitHub passa a controlar também o deploy
do Supabase.

### 4.6 Regra de ordem: EXPAND → MIGRATE → CONTRACT

"Banco primeiro, código depois" não é regra universal — sem compatibilidade, ela só troca o lado
que quebra. A regra correta é a mudança em três releases:

```
Release A — EXPAND     ADD COLUMN nova_coluna;      código antigo continua funcionando
Release B — MIGRATE    frontend passa a usar nova_coluna
Release C — CONTRACT   DROP COLUMN coluna_antiga;
```

Cada release é individualmente reversível e nenhuma exige janela de indisponibilidade. Formalizar
em `guias/guia_sql.md`.

---

## 5. Ordem 0 — reconciliação de produção

Antes de qualquer automação. Automatizar sobre estado desconhecido só propaga o desconhecimento.

### 5.1 Os quatro eixos

| Eixo | Pergunta | Como obter |
|---|---|---|
| Frontend | Qual commit SHA está publicado? | Painel do Vercel, deployment de produção |
| Banco | Qual a última migration aplicada? | `npm run db:check-link` + `npm run db:migration-list` |
| Edge Functions | Quais estão publicadas e de qual código? | `npx supabase functions list --project-ref lcusxnhhrjosxqgiphgp` |
| GitHub | Qual commit deveria corresponder a tudo isso? | `main` no remoto (hoje `e0017e7`) |

### 5.2 Os 8 prefixos duplicados — item mais urgente

```
093_add_programacao_visualizacao_page_permissions.sql
093_enforce_single_team_per_foreman_rpc.sql

120_allow_multiple_programming_sgd_types_per_export_column.sql
120_unify_measurement_with_service_activities.sql

122_protect_duplicate_measurement_items_in_rpc.sql
122_sync_work_completion_status_by_project_date_trigger.sql

127_add_mva_hour_composed_quantity_to_measurement_items.sql
127_sync_programming_documents_by_project_date_and_lv_window.sql

134_allow_foreman_change_during_team_activation.sql
134_standardize_stock_reversal_reasons.sql

161_create_measurement_meta_targets.sql
161_preserve_measurement_foreman_snapshots.sql

162_backfill_measurement_foreman_snapshots.sql
162_fix_measurement_meta_registration_rpc.sql

235_add_performance_indexes.sql
235_fix_programming_batch_decimal_rpc_name.sql
```

A colisão do 318 não foi exceção — foi a única percebida.

**Por que `migration list` não resolve sozinho.** O mecanismo de versionamento compara apenas a
**versão/prefixo** entre os arquivos locais e `supabase_migrations.schema_migrations`. Dois arquivos
`093_*` **não possuem duas identidades distintas** para esse mecanismo. Há casos documentados no
repositório do próprio CLI em que versões repetidas terminam em `schema_migrations_pkey` /
SQLSTATE 23505, em vez de serem simplesmente registradas duas vezes. Ou seja: a listagem não prova
que ambos os arquivos rodaram — **o estado real dos objetos criados/alterados por cada um é que
desempata**.

**Procedimento, por versão duplicada:**

1. Identificar os **dois** arquivos.
2. Identificar exatamente o **efeito SQL** de cada um (objeto criado, coluna, policy, RPC, trigger).
3. Consultar o **migration history** de produção.
4. Verificar o **schema real** de produção — os objetos existem?
5. Classificar:
   - ✅ ambos os efeitos existem;
   - ⚠️ somente A existe;
   - ⚠️ somente B existe;
   - ❌ nenhum existe.
6. **Só então** decidir a correção.

**Não usar `supabase migration repair` antes do passo 5.** A documentação é explícita: `repair`
altera o histórico, **não executa nem desfaz o SQL**. Usar repair sobre estado desconhecido apaga a
única evidência de que algo faltou.

---

## 6. Os três marcos

### Marco 1 — GitHub seguro
Ordem 0 (reconciliação + os 8 duplicados) → CI de frontend completo (build, ratchet, tsc, ESLint,
`concurrency`) → migration ratchet com baseline → `db reset` condicional a path → `deno check`
condicional a path → EXPAND/MIGRATE/CONTRACT obrigatório no PR → `verify` como required check →
`.nvmrc` e versões pinadas → auto-delete de branch + limpeza das 377 mergeadas.

Deploy do Supabase segue manual. Nada de infraestrutura nova.

### Marco 2 — Backend reproduzível
Projeto Supabase de staging → `db push` e deploy de Edge Functions executados pelo GitHub Actions,
eliminando o deploy rotineiro pela máquina do desenvolvedor.

**Ajuste de ordem dentro do marco:** o alvo produção já nasce exigindo o Environment `production`.
Caso contrário existe uma janela em que produção passa a ser alterável por workflow sem gate — o
que troca erro humano na CLI por erro humano no `workflow_dispatch`, com menos atrito para
acontecer.

### Marco 3 — Produção auditável
Environment `production` com aprovação → smoke check → release manifest (seção 3). É aqui que a
definição "produção = última release concluída" passa a valer de fato.

### Depois dos três — maturidade, não correção de risco
Supabase Branching por PR, Dependabot, CODEOWNERS, template de PR.

Sobre o Branching: um único staging já é uma melhoria grande, mas tem limite conhecido — PRs
simultâneos com migrations diferentes compartilham o mesmo banco e podem interferir.

```
PR #540 ─┐                          PR #540 ──┬── Vercel Preview #540
PR #541 ─┼→ mesmo Supabase STAGING            └── Supabase Preview #540
PR #542 ─┘                          main ─────┬── Vercel Production
                                              └── Supabase Production
```

O caminho é `LOCAL → STAGING → PRODUCTION` primeiro; preview DB por PR só quando o volume de PRs
com migration concorrente justificar.

---

## 7. Pré-requisitos concretos

**Secrets no GitHub** (a partir do Marco 2)
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD` (ou `SUPABASE_DB_URL`)
- `SUPABASE_PROJECT_REF_PROD`
- `SUPABASE_PROJECT_REF_STAGING`

O CI da Fase 1 **não precisa de secret** — nem o build (R3) nem o `db reset` (banco local efêmero).

**GitHub Environments** — `staging` (automático) e `production` (required reviewer). Disponíveis em
qualquer plano por ser repositório público; se a visibilidade mudar para privada, confirmar o plano
antes de depender do mecanismo. Fallback: `workflow_dispatch` + secrets exclusivos do environment +
restrição por branch + procedimento manual no runbook.

**Branch protection na `main`** — required status check `verify`; *Automatically delete head
branches*.

**Repositório** — `.nvmrc` alinhado ao CI, ao `engines` e ao Vercel; versões fixas de Supabase CLI e
Deno no workflow.

**Vercel** — manter a integração nativa (Preview por PR, produção pela production branch). Não
reimplementar deploy de Next.js via Actions.

---

## 8. Divergência entre documentação e código (CLAUDE.md seção 12)

O comentário final de `.github/workflows/ci.yml` e a seção **Testes** do `README.md` afirmam que
`npm run build` não entra no CI porque depende de variáveis do Supabase não cadastradas como
secrets. A medição de 2026-08-10 mostra o contrário: o build conclui com valores fictícios.

Ação: corrigir os dois textos na mesma tarefa em que o passo de build for adicionado.
