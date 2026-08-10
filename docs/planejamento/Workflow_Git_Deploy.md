# Workflow de Git e Deploy — diagnóstico e desenho-alvo

Levantamento feito em **2026-08-10** por leitura direta do repositório (`.github/workflows/`,
`package.json`, `vercel.json`, `supabase/`, guias) e por medição do estado do Git.

Escopo: o caminho do código do commit até a publicação — CI no GitHub, deploy do frontend no
Vercel, aplicação de migrations no Supabase e deploy de Edge Functions.

Fora de escopo: o encadeamento operacional entre as telas, tratado em
`docs/planejamento/Workflow_Fluxo_Telas.md`.

---

## 1. Estado atual medido

| Item | Situação em 2026-08-10 |
|---|---|
| Workflows no GitHub | 1 arquivo, 1 job: `.github/workflows/ci.yml` → job `verify` |
| Passos do CI | ESLint (`npm run lint:eslint`), ratchet de tamanho (`npm run lint:size`), typecheck (`npx tsc --noEmit`) |
| Build no CI | **Não roda** — excluído por comentário no próprio `ci.yml` |
| Bloqueio de merge | Nenhum — o cabeçalho do `ci.yml` registra que `verify` não está marcado como required na branch protection |
| Gatilhos | `push` na `main` + `pull_request`; sem `concurrency` |
| Deploy do frontend | Integração Git do Vercel. `vercel.json` declara apenas `framework: nextjs`. Não existe workflow de deploy no repositório |
| Deploy do banco | Manual, pela CLI na máquina do dev. Não existe script `db:push` em `package.json` |
| Deploy de Edge Functions | Manual: `npm run fn:deploy`, `fn:deploy:forecast`, `fn:deploy:activity-forecast`, conforme `guias/runbook_deploy_edge_functions.md` |
| Ambientes | **Um único projeto Supabase** (`lcusxnhhrjosxqgiphgp`). Não existe staging |
| Versionamento | Nenhuma tag, nenhuma release |
| Pin de Node | Ausente. CI fixa `20`; `engines` exige `>=20.9.0`; Vercel escolhe a própria versão |
| Governança do repo | Sem Dependabot, sem CODEOWNERS, sem template de PR |
| Branches | **429 locais / 554 remotas**; **377 já mergeadas na `main` e nunca deletadas** |
| Segredos | `.env` nunca foi versionado (verificado em todo o histórico) — correto |

### 1.1 Distância entre o que está publicado e o que existe

- `origin/main` parada em **2026-07-31**, no merge do PR **#523**.
- Branch de trabalho atual: **19 commits à frente** de `origin/main`, o mais antigo de **2026-08-03**.
- Nesses 19 commits entram **7 migrations: 353 a 359**, incluindo
  `355_add_medicao_visualizacao_page_permissions.sql` e
  `356_force_new_pages_blocked_by_default.sql`, que alteram permissão de tela.
- A `main` local está 90 commits atrás de `origin/main` (defasagem só local, sem efeito em produção).

Como o banco é um só e as migrations são aplicadas à mão, o cenário provável é **schema à frente
do frontend publicado**. Confirmar com `npm run db:migration-list` antes de qualquer decisão.

---

## 2. Riscos, em ordem de severidade

### R1 — Banco possivelmente à frente do código publicado
Migrations são aplicadas manualmente e fora do controle do Git. O frontend em produção é de
31/07; as migrations 353–359 podem já estar no banco. `356_force_new_pages_blocked_by_default`
muda o comportamento padrão de permissão de telas que a produção ainda não conhece.

### R2 — Não existe caminho para publicar um hotfix isolado
Com 19 commits acumulados fora da `main`, qualquer correção urgente arrasta dez dias de trabalho
não publicado junto. Não há branch de release nem cherry-pick documentado.

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

### R5 — Não é possível dizer o que está em produção
554 branches remotas, nome de branch igual à mensagem do commit, nenhuma tag. Não existe
identificador que ligue "o que está no ar" a "qual a maior migration aplicada".

---

## 3. Desenho-alvo do pipeline

### Estágio 1 — PR (bloqueante)
Estender o job `verify` com:

- `npm run build` — viável sem secret (ver R3);
- `concurrency` por branch, cancelando execuções antigas do mesmo PR;
- checagem de migration: numeração sequencial sem colisão e proibição de editar migration já
  aplicada (regra que hoje só existe em `guias/guia_sql.md` e já foi violada uma vez — ver o
  realinhamento da 318 para 319).

Marcar `verify` como **required** na branch protection da `main`.

### Estágio 2 — Preview
O Vercel já cria preview por PR. O que falta é o preview apontar para um Supabase de **staging** —
hoje um preview conversa com o banco de produção.

### Estágio 3 — Produção
Merge na `main` → deploy do Vercel (já funciona) + **tag automática** registrando a maior migration
contida no commit. Resolve R5.

### Estágio 4 — Banco, com aprovação registrada
Workflow `workflow_dispatch` executando `supabase db push`:

- contra **staging**: automático;
- contra **produção**: apenas via GitHub Environment com *required reviewer*.

Isso não afrouxa a regra do repositório — converte o "confirmei o `project-ref`" em aprovação
auditável, e o `db:check-link` passa a ser um passo do job.

### Estágio 5 — Edge Functions
Mesmo `workflow_dispatch`, com `--use-api` (padrão já recomendado no runbook). Tira Docker e CLI da
máquina do dev e cria registro de qual versão foi publicada e por quem.

### Regra de ordem a formalizar
**Migration compatível-para-frente primeiro, código depois.** É o que o repositório já faz na
prática, mas não está escrito em nenhum guia.

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
- `production` — required reviewer.

**Branch protection na `main`**
- Required status check: `verify`;
- *Automatically delete head branches* — resolve R5 daqui em diante sem esforço manual.

**Repositório**
- `.nvmrc` alinhado ao CI, ao `engines` do `package.json` e ao Vercel.

**Infra**
- Projeto Supabase de staging. Único item com custo real e o que mais reduz risco.

---

## 5. Ordem de execução

| Fase | O que fazer | Custo | Risco que ataca |
|---|---|---|---|
| 1 | Publicar (ou decidir conscientemente reter) os 19 commits pendentes | Nenhum | R1, R2 |
| 2 | `build` + `concurrency` no `ci.yml`; `.nvmrc`; corrigir README e comentário do `ci.yml` | Baixo | R3 |
| 3 | Required check `verify` + auto-delete de branch na branch protection | Nenhum | R3, R5 |
| 4 | Limpar as 377 branches já mergeadas | Baixo | R5 |
| 5 | Projeto Supabase de staging + envs de preview | Médio | R4 |
| 6 | Workflows de `db push` e `functions deploy` com aprovação por Environment | Médio | R1, R4 |
| 7 | Tag/release automática por merge | Baixo | R5 |

Fases 1 a 4 não dependem de infraestrutura nova e podem ser feitas na mesma semana.

---

## 6. Divergência entre documentação e código (CLAUDE.md seção 12)

O comentário final de `.github/workflows/ci.yml` e a seção **Testes** do `README.md` afirmam que
`npm run build` não entra no CI porque depende de variáveis do Supabase não cadastradas como
secrets. A medição de 2026-08-10 mostra o contrário: o build conclui com valores fictícios.

Ação: corrigir os dois textos na mesma tarefa em que o passo de build for adicionado. Não manter
uma justificativa que o próprio código desmente.
