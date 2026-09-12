# Runbook de Rollback

## 1. Escopo

Obrigatório antes de reverter código em produção, escolher um ponto para `git bisect`, ou reverter um PR já mergeado na `main`.

Este runbook existe porque neste projeto **o código e o banco são implantados por caminhos separados**: o frontend/API vai para a Vercel automaticamente pelo `main`, e as migrations são aplicadas à mão no Supabase. Voltar só um dos dois quebra o sistema em silêncio.

Para o pipeline completo e o plano de automação, ver [`docs/planejamento/Workflow_Git_Deploy.md`](../docs/planejamento/Workflow_Git_Deploy.md).

---

## 2. Fontes de verdade

- Histórico do Git (`git log`) — commits reais aplicados na `main`.
- Aba de PRs mergeados no GitHub — mostra o status do deploy Vercel por PR (✓ ou ✗).
- `supabase/migrations/README.txt` — o que cada migration fez e o que ela removeu.
- Este arquivo, seção 5 — registro de commits que **não buildam sozinhos**.

---

## 3. A regra que importa

> **Rollback de código nunca desfaz uma migration aplicada.**

Uma migration aplicada continua no banco depois que o código volta. Se ela **removeu** ou **trocou a assinatura** de alguma coisa que o código antigo usava, o código antigo passa a chamar algo que não existe mais — e o erro aparece em runtime, não no build.

O caso mais perigoso é `drop function`: PostgREST devolve `PGRST202` (função não encontrada no schema cache) e a tela mostra apenas "falha ao salvar".

Por isso, antes de qualquer rollback:

1. Descubra **quais migrations já foram aplicadas** no ambiente.
2. Descubra **quais delas são posteriores** ao commit para onde você quer voltar.
3. Para cada uma, leia a entrada dela em `supabase/migrations/README.txt` e responda: *ela remove ou altera assinatura de algo?*
   - **Não remove nada** (só adiciona coluna, índice, tabela ou função nova): o rollback de código é seguro. Colunas novas ficam sem uso, e tudo bem.
   - **Remove ou troca assinatura**: o rollback de código **não** é seguro sozinho. Ou você escreve uma migration de compensação, ou escolhe um ponto de rollback anterior à migration.

---

## 4. Procedimento

### 4.1 Escolher o alvo

```bash
git log --oneline -20
```

Confira o alvo contra a seção 5 (commits que não buildam) antes de continuar. Se o alvo estiver listado, use o commit **anterior** a ele.

### 4.2 Levantar as migrations no caminho

```bash
git log --oneline <alvo>..HEAD -- supabase/migrations
```

Cada arquivo listado é uma migration aplicada depois do alvo. Leia a entrada de cada uma em `supabase/migrations/README.txt`.

### 4.3 Verificar que o alvo builda

```bash
git switch --detach <alvo>
npm ci
npm run build
git switch -
```

Nunca confie no ✓ verde do PR: ele foi rodado no conteúdo daquele PR, não no estado da `main` naquele ponto.

### 4.4 Reverter

Preferir `git revert` a `git reset --hard`: a `main` é pública e reescrever histórico quebra o repositório de quem já puxou.

```bash
git revert --no-commit <commit>..HEAD
git commit
```

### 4.5 Depois

- Confirme o deploy verde na Vercel.
- Se alguma migration da seção 4.2 exigia compensação, aplique a migration de compensação **antes** de considerar o rollback concluído.

---

## 5. Registro de commits que não buildam sozinhos

Commits que falham em `npm run build` quando verificados isoladamente. **Nunca use nenhum deles como alvo de rollback ou como ponto bom de `git bisect`** — use o commit anterior.

| Commit | PR | Data | Por quê | Use no lugar |
|---|---|---|---|---|
| `7d8a81c` | #582 | 2026-08-18 | Levou `TeamCompositionPageView.tsx` já refatorado, mas sem `types.ts` e `components/MeasurementProjectModal.tsx`, que o arquivo importa. Os dois entraram só no `1d437c4` (#583). | `83b9859` |

**Como esse registro é alimentado:** sempre que um PR fechar com deploy vermelho na Vercel e o correto for seguir em frente em vez de reverter, adicione a linha aqui na mesma tarefa. Um ✗ vermelho no histórico de PRs do GitHub é permanente e não indica pendência aberta — indica que aquele ponto do histórico não é utilizável.

---

## 6. Registro de acoplamento código ↔ banco

Pontos em que voltar o código **sem** tratar o banco quebra o sistema.

| Migration | Aplicada em | O que remove/altera | Efeito de voltar o código para antes dela |
|---|---|---|---|
| `373_team_composition_foreman_override.sql` | 2026-08-18 | `drop function save_team_composition_record` na assinatura de 14 argumentos, substituída pela de 15 (`p_foreman_person_id`) | A Composição de Equipe para de salvar com `PGRST202`. O código anterior a `c6e6000` chama a assinatura de 14 argumentos, que não existe mais. Rollback exige recriar a assinatura antiga ou voltar a migration. |
| `374_resolve_team_foreman_from_composition.sql` | 2026-08-18 | Só substitui corpo de função e recria constraints; não remove nada que o código antigo use | Rollback de código é seguro. As telas voltam a exibir o encarregado do cadastro, mas nada quebra. |

---

## 7. Guardrails

Nunca:

- Usar `git reset --hard` + `push --force` na `main` para "limpar" um commit ruim já mergeado.
- Fazer rollback de código sem listar as migrations aplicadas no intervalo.
- Tratar o ✓ verde do PR como prova de que aquele ponto da `main` builda.
- Aplicar `supabase migration repair` antes de determinar o estado real do banco (ver `docs/planejamento/Workflow_Git_Deploy.md`, ordem 0).

---

## 8. A correção de raiz

Commit que não builda sozinho só existe porque **o CI não roda `npm run build`** e o check `verify` não é obrigatório na branch protection da `main`. Com as duas coisas no lugar, o `7d8a81c` teria sido barrado antes do merge.

Tarefa aberta em `TASKS.md`: `[CI][Build] Incluir npm run build e concurrency no .github/workflows/ci.yml`. Enquanto ela não fechar, a seção 5 deste arquivo continua sendo mantida à mão.
