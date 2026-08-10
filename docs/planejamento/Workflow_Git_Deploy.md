# Workflow de Git e Deploy — diagnóstico e desenho-alvo

Levantamento feito em **2026-08-10** por leitura direta do repositório (`.github/workflows/`,
`package.json`, `vercel.json`, `supabase/`, guias), por medição do estado do Git e por consulta à
API pública do GitHub (estado real de `main`, execuções de CI e visibilidade do repositório).

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
| Saúde do CI | Verde em PR e em `main` nas execuções recentes |
| Bloqueio de merge | `verify` **não** está confirmado como required na branch protection (o próprio `ci.yml` registra isso; não verificável sem autenticação) |
| Gatilhos | `push` na `main` + `pull_request`; sem `concurrency` |
| Disciplina de PR | Alta — 539 PRs; os PRs #524–#539 foram mergeados entre 03/08 e 10/08 |
| Deploy do frontend | Integração Git do Vercel. `vercel.json` declara apenas `framework: nextjs`. Não existe workflow de deploy no repositório |
| Deploy do banco | **Manual**, pela CLI na máquina do dev. Não existe script `db:push` em `package.json` |
| Deploy de Edge Functions | **Manual**: `npm run fn:deploy`, `fn:deploy:forecast`, `fn:deploy:activity-forecast`, conforme `guias/runbook_deploy_edge_functions.md` |
| Ambientes | **Um único projeto Supabase** (`lcusxnhhrjosxqgiphgp`). Não existe staging |
| Versionamento | Nenhuma tag, nenhuma release |
| Pin de Node | Ausente. CI fixa `20`; `engines` exige `>=20.9.0`; Vercel escolhe a própria versão |
| Governança do repo | Sem Dependabot, sem CODEOWNERS, sem template de PR |
| Branches | **429 locais / 554 remotas**; **377 já mergeadas na `main`** e nunca deletadas |
| Segredos | `.env` nunca foi versionado (verificado em todo o histórico) |

### 1.1 O que o diagnóstico corrigido mostra

O **caminho do código** funciona: branch → PR → CI verde → merge → Vercel. Não é ali que está o
problema.

O que não é governado é o **caminho do estado**: migrations e Edge Functions saem da máquina do
desenvolvedor, sem registro no Git de quando foram aplicadas nem de qual versão está publicada.
Todo o risco restante deriva disso.

### 1.2 Nota sobre visibilidade pública

Sendo público, o repositório expõe `supabase/migrations` inteiro — 369 arquivos com schema,
policies RLS e funções `SECURITY DEFINER` — além do `project-ref`. Nenhum segredo vazou: o `.env`
nunca foi versionado e a `service_role` não aparece no código.

Consequências práticas: (a) as regras de proteção de Environment, incluindo required reviewers,
ficam disponíveis em qualquer plano — o que remove o obstáculo do estágio 4 abaixo; (b) o modelo
de segurança é auditável por terceiros, o que reforça a exigência do `guia_sql.md` de revogar
`public`/`anon`/`authenticated` em toda função `SECURITY DEFINER`. Vale confirmar que a
visibilidade pública é intencional.

---

## 2. Riscos, em ordem de severidade

### R1 — O estado do banco em produção não é conhecido a partir do Git
Migrations são aplicadas manualmente e fora do controle do repositório. Não existe registro de qual
é a última migration realmente aplicada em `lcusxnhhrjosxqgiphgp`, nem de quando. O mesmo vale para
as Edge Functions: `supabase/functions/` tem 18 funções e nada indica quais estão publicadas nem de
qual commit vieram.

Não é hipótese sobre atraso de código — é ausência de registro. Só a reconciliação da Fase 0
resolve.

### R2 — Produção não é reproduzível como uma revisão Git única
*(risco renomeado; a formulação anterior — "não existe caminho para hotfix isolado" — estava
incorreta, já que `main` representa a produção e um hotfix a partir dela funciona)*

Dado um incidente, não é possível responder "qual revisão do repositório corresponde exatamente ao
que está no ar" — porque frontend, schema e Edge Functions são publicados por caminhos
independentes e só o primeiro deixa rastro no Git. Um hotfix a partir de `main` só é seguro se o
schema em produção corresponder ao que `main` espera, e isso hoje não é verificável.

### R3 — O primeiro lugar onde um erro de build aparece é a produção
O CI não roda `npm run build`; o Vercel constrói direto da `main`.

A justificativa registrada no `ci.yml` e no README **não se sustenta**. Verificado em 2026-08-10:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://dummy.supabase.co" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-anon" \
SUPABASE_URL="https://dummy.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="dummy-service" \
npm run build
```

O build concluiu com sucesso e gerou todas as rotas. Os `throw` por variável ausente estão dentro
de funções (`src/services/auth/auth.service.ts`, `src/lib/server/appUsersAdmin.ts`), não em escopo
de módulo. **O build pode entrar no CI hoje, sem cadastrar nenhum secret.**

### R4 — Migration é ensaiada direto em produção
Não existe segundo projeto Supabase. Por isso todos os guias repetem "confirme o `project-ref`
antes de qualquer comando": a proteção é a atenção do operador. Com 369 migrations e RPCs
`SECURITY DEFINER`, esse é o risco estrutural do pipeline.

### R5 — Não existe registro do que compõe uma versão em produção
554 branches remotas, nome de branch igual à mensagem do commit, nenhuma tag, nenhuma release.
Não há artefato que amarre código, schema e funções numa unidade.

---

## 3. Desenho-alvo do pipeline

```
                        DESENVOLVEDOR
                             │
                             ▼
                     feat/... ou fix/...
                             │
                             ▼
                            PR
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
       ESLint              tsc              ratchet
          │                  │                  │
          └──────────────────┼──────────────────┘
                             ▼
                       npm run build
                             │
                             ▼
                   migration integrity
                             │
                             ▼
                       VERIFY ✅
                             │
                             ▼
                     Vercel Preview
                             │
                             ▼
                    Supabase Staging
                             │
                             ▼
                      Teste funcional
                             │
                             ▼
                        Merge main
                             │
                ┌────────────┴────────────┐
                ▼                         ▼
          Supabase deploy              Vercel
          migrations/functions         Production
                │                         │
                └────────────┬────────────┘
                             ▼
                         Smoke check
                             │
                             ▼
                         RELEASE
                             │
                   ┌─────────┴─────────┐
                   ▼                   ▼
                Git SHA          Migration atual
```

### Estágio 0 — Reconciliação de produção (pré-requisito de tudo)
Antes de mudar qualquer coisa no pipeline, levantar os quatro eixos e registrar o resultado:

| Eixo | Pergunta | Como obter |
|---|---|---|
| Frontend | Qual commit SHA está publicado? | Painel do Vercel, deployment de produção |
| Banco | Qual a última migration aplicada? | `npm run db:check-link` + `npm run db:migration-list` |
| Edge Functions | Quais estão publicadas e de qual código? | `npx supabase functions list --project-ref lcusxnhhrjosxqgiphgp` |
| GitHub | Qual commit deveria corresponder a tudo isso? | `main` no remoto (hoje `e0017e7`) |

Se os quatro convergirem, produção passa a ter uma linha de base conhecida — e essa linha vira a
primeira release manual. Se divergirem, a divergência é resolvida **antes** de automatizar
qualquer coisa: automatizar sobre estado desconhecido só propaga o desconhecimento.

### Estágio 1 — PR (bloqueante)
Estender o job `verify` com:

- `npm run build` — viável sem secret (ver R3);
- `concurrency` por branch, cancelando execuções antigas do mesmo PR;
- **migration integrity**: numeração sequencial sem colisão e proibição de editar migration já
  aplicada (regra que hoje só existe em `guias/guia_sql.md` e já foi violada uma vez — ver o
  realinhamento da 318 para 319).

Marcar `verify` como **required** na branch protection da `main`.

### Estágio 2 — Preview
O Vercel já cria Preview Deployments por PR e publica produção a partir da production branch.
**Manter a integração nativa** — não reimplementar deploy de Next.js via Actions. O que falta é o
preview apontar para um Supabase de **staging**; hoje um preview conversa com o banco de produção.

### Estágio 3 — Produção
Merge na `main` → deploy do Vercel (já funciona) → deploy do banco e das funções → smoke check.

### Estágio 4 — Banco, com aprovação registrada
Workflow `workflow_dispatch` executando `supabase db push`:

- contra **staging**: automático;
- contra **produção**: via GitHub Environment com *required reviewer*.

Como o repositório é público, as regras de proteção de Environment estão disponíveis
independentemente do plano. **Se a visibilidade mudar para privada**, confirmar o plano antes de
depender desse mecanismo; o fallback equivalente é `workflow_dispatch` + secrets exclusivos do
environment de produção + restrição por branch + procedimento manual explícito no runbook.

Em qualquer das formas, isso não afrouxa a regra do repositório: converte o "confirmei o
`project-ref`" em aprovação auditável, e o `db:check-link` passa a ser um passo do job.

### Estágio 5 — Edge Functions
Mesmo `workflow_dispatch`, com `--use-api` (padrão já recomendado no runbook). Tira Docker e CLI da
máquina do dev e cria registro de qual versão foi publicada e por quem.

### Estágio 6 — Release representa implantação concluída
A release **não** é criada no merge. É criada depois que todas as etapas terminaram e o smoke check
passou. Uma tag no merge diria "este commit contém até a migration 359", o que não é a mesma
afirmação que "a migration 359 está aplicada em produção" — e as duas divergem no primeiro
`db push` que falhar depois de um deploy bem-sucedido do Vercel.

Conteúdo do registro de release:

```
Release:            prod-2026.08.10.1
Git SHA:            e0017e717db76a23039ffa97a741409af846a44d
DB migration:       359
Vercel deployment:  <deployment id>
Edge Functions:     import_project_forecast, import_project_activity_forecast, ...
Deploy:             SUCCESS
Publicado por:      GitHub Actions
```

Com isso, "qual código, qual schema e quais funções estão em produção" passa a ser uma consulta de
segundos. É o que fecha R2 e R5 de fato.

### Regra de ordem: EXPAND → MIGRATE → CONTRACT
"Banco primeiro, código depois" não é regra universal — sem compatibilidade, ela apenas troca o
lado que quebra. A regra correta é a mudança em três releases:

```
Release A — EXPAND
  ADD COLUMN nova_coluna;           código antigo continua funcionando

Release B — MIGRATE
  frontend passa a usar nova_coluna

Release C — CONTRACT
  DROP COLUMN coluna_antiga;
```

Cada release é individualmente reversível, e nenhuma exige janela de indisponibilidade. Formalizar
em `guias/guia_sql.md`.

---

## 4. Pré-requisitos concretos

**Secrets no GitHub**
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD` (ou `SUPABASE_DB_URL`)
- `SUPABASE_PROJECT_REF_PROD`
- `SUPABASE_PROJECT_REF_STAGING`

O build no CI **não precisa de secret** (comprovado em R3).

**GitHub Environments**
- `staging` — deploy automático;
- `production` — required reviewer (disponível: repositório público).

**Branch protection na `main`**
- Required status check: `verify`;
- *Automatically delete head branches* — resolve o acúmulo de branches daqui em diante. Note que
  isso é higiene de repositório, **não** versionamento de produção: quem resolve isso é a release
  do estágio 6.

**Repositório**
- `.nvmrc` alinhado ao CI, ao `engines` do `package.json` e ao Vercel.

**Infra**
- Projeto Supabase de staging. Único item com custo real e o que mais reduz risco.

---

## 5. Ordem de execução

| Ordem | Ação | Custo | Risco que ataca |
|---|---|---|---|
| 0 | Reconciliar o estado real de produção nos quatro eixos | Baixo | R1, R2 |
| 1 | `build` + migration check + `concurrency` no `ci.yml` | Baixo | R3 |
| 2 | Tornar `verify` obrigatório na branch protection | Nenhum | R3 |
| 3 | `.nvmrc` + padronizar a versão de Node nas três fontes | Baixo | R3 |
| 4 | Ativar auto-delete de branches | Nenhum | R5 (higiene) |
| 5 | Limpar as 377 branches já mergeadas | Baixo | R5 (higiene) |
| 6 | Resolver conscientemente qualquer código retido (hoje: nenhum) | Nenhum | R2 |
| 7 | Criar o projeto Supabase de staging | Médio | R4 |
| 8 | Automatizar o deploy de banco com aprovação | Médio | R1, R4 |
| 9 | Automatizar o deploy de Edge Functions | Baixo | R1 |
| 10 | Criar a release de produção após deploy bem-sucedido | Médio | R2, R5 |
| 11 | Avaliar Supabase Preview Branch por PR | Alto | R4 |

Ordens 1 a 6 não dependem de infraestrutura nova. A ordem 0 vem antes de tudo porque define a linha
de base sobre a qual todo o resto opera.

### Sobre a ordem 11
Um único Supabase de staging já é uma melhoria grande, mas tem um limite conhecido: PRs simultâneos
com migrations diferentes compartilham o mesmo banco e podem interferir entre si.

```
PR #540 ─┐
PR #541 ─┼→ mesmo Supabase STAGING
PR #542 ─┘
```

O nível ideal é um ambiente por PR, com o Preview do Vercel apontando para o Supabase Preview
correspondente:

```
PR #540 ──┬── Vercel Preview #540
          └── Supabase Preview #540
main ─────┬── Vercel Production
          └── Supabase Production
```

O Supabase oferece Branching para isso, com integração ao Vercel. **Não é obrigatório agora** — o
caminho é `LOCAL → STAGING → PRODUCTION` primeiro, e preview DB por PR só quando o volume de PRs
com migration concorrente justificar.

---

## 6. Divergência entre documentação e código (CLAUDE.md seção 12)

O comentário final de `.github/workflows/ci.yml` e a seção **Testes** do `README.md` afirmam que
`npm run build` não entra no CI porque depende de variáveis do Supabase não cadastradas como
secrets. A medição de 2026-08-10 mostra o contrário: o build conclui com valores fictícios.

Ação: corrigir os dois textos na mesma tarefa em que o passo de build for adicionado (ordem 1). Não
manter uma justificativa que o próprio código desmente.
