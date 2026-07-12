# Guia de Validação (protocolo pré-PR)

## 1. Escopo

Obrigatório antes de qualquer PR ou entrega de código. Substitui o protocolo antigo da pasta `verificacao/` (os 12 arquivos numerados) — as regras estáveis de cada um foram fundidas nos guias de domínio; este guia é o índice de "quando ler o quê" e o checklist final consolidado. Os logs históricos de entregas passadas desses 12 arquivos foram preservados em `_archive/verificacao-logs/`.

## 2. Fontes de verdade

- [`guia_backend.md`](guia_backend.md), [`guia_frontend.md`](guia_frontend.md), [`guia_sql.md`](guia_sql.md), [`guia_supabase.md`](guia_supabase.md) — regras de domínio detalhadas.
- `verificacao/crc/*.md` — dados de instância por módulo (ler antes de alterar qualquer arquivo do módulo listado).
- `package.json` — comandos reais de validação (`lint`, `db:check-link`, `db:lint`, `db:security-check`).

## 3. Regras obrigatórias

### Protocolo
1. Antes de qualquer PR, ler os guias de domínio relevantes para a mudança (mapa abaixo) e marcar explicitamente quais itens do checklist da seção 3 foram verificados.
2. Se algum item do checklist não se aplicar, justificar brevemente em vez de simplesmente omitir.
3. Se houver CRC do módulo afetado em `verificacao/crc/`, ler antes de qualquer alteração.

### Mapa: tipo de mudança → o que ler

| Mudança | Ler |
|---|---|
| Qualquer escrita em banco | [`guia_sql.md`](guia_sql.md) + [`guia_backend.md`](guia_backend.md) (transação/concorrência) |
| Mudança de fluxo operacional (status, cancelamento, saldo) | [`guia_backend.md`](guia_backend.md) (regras de negócio) |
| Rota nova ou mudança de auth/permissão | [`guia_supabase.md`](guia_supabase.md) + [`guia_backend.md`](guia_backend.md) (autorização) |
| Query ou escrita envolvendo `tenant_id` | [`guia_sql.md`](guia_sql.md) (multi-tenant) + [`guia_backend.md`](guia_backend.md) |
| Mudança de tipos, nomes de campo ou schema | [`guia_sql.md`](guia_sql.md) + [`guia_backend.md`](guia_backend.md) |
| Query, limite, cache ou endpoint de lista | [`guia_backend.md`](guia_backend.md) (performance) |
| Função que parece existir em outro lugar | [`guia_backend.md`](guia_backend.md) (estrutura de módulo) |
| Try/catch, resposta de erro ou validação | [`guia_backend.md`](guia_backend.md) (tratamento de erros) |
| Operação que altera dado crítico | [`guia_backend.md`](guia_backend.md) (auditoria) |
| Antes de deploy ou mudança de ambiente | [`guia_supabase.md`](guia_supabase.md) + [`runbook_deploy_edge_functions.md`](runbook_deploy_edge_functions.md) |
| PageView, hook ou componente de listagem | [`guia_frontend.md`](guia_frontend.md) |
| Endpoint que retorna lista ou dashboard | [`guia_backend.md`](guia_backend.md) (tráfego/egress) |
| Alteração de trigger/função PL-pgSQL | [`guia_sql.md`](guia_sql.md) (armadilha de NULL boolean) |
| `crc/[modulo].md` existente | ler antes de alterar qualquer arquivo do módulo listado |

### Checklist consolidado de qualidade por tela

**Integridade e concorrência**
- [ ] `expectedUpdatedAt` exigido no PATCH/PUT.
- [ ] Conflito retorna 409 com `currentRecord`, `currentUpdatedAt`, `updatedBy`, `changedFields`.
- [ ] Save transacional: RPC para operações com efeitos colaterais.
- [ ] Lote atômico: rollback total se qualquer item falhar.
- [ ] Histórico na mesma transação da operação principal.

**Segurança e autorização**
- [ ] Toda rota valida `page_key` e `action` no servidor.
- [ ] Nenhuma rota aceita `tenant_id` do body como fonte de verdade.
- [ ] RPC `SECURITY DEFINER` executável apenas por `service_role` ou valida auth internamente.
- [ ] Tabela operacional crítica não aceita INSERT/UPDATE direto de `authenticated`.

**Performance e tráfego**
- [ ] Nenhum `.select("*")`.
- [ ] Nenhum `.limit()` acima de 1.000 sem paginação ou RPC de agregação.
- [ ] Filtros aplicados no banco, não no JavaScript.
- [ ] Queries independentes são paralelas (`Promise.all`).
- [ ] Colunas de filtro frequente têm índice documentado.
- [ ] Dashboard retorna resumo (RPC), não dados brutos.
- [ ] Log de tamanho de resposta adicionado se o endpoint retorna lista.
- [ ] Catálogo usa cache (`unstable_cache`). Dado operacional NÃO usa cache.

**Front-end e UI**
- [ ] Filtro de período padrão definido (mês atual ou últimos 30 dias).
- [ ] Debounce em campos de busca texto (300ms mínimo).
- [ ] `useAuth()` centralizado — não chama auth fora do contexto.
- [ ] `useEffect` sem dependências inline (objetos/arrays).
- [ ] Listas com > 50 itens têm paginação.
- [ ] Exportação tem cooldown de 10s.
- [ ] PageView abaixo de 1.000 linhas.
- [ ] Erros registrados com `useErrorLogger("modulo")`.
- [ ] Funções de formatação importadas de `src/lib/utils/`, não copiadas.

**Documentação e rastreabilidade**
- [ ] `/docs/Tela_<Nome>_SaaS.txt` criado ou atualizado.
- [ ] CRC em `verificacao/crc/<modulo>.md` atualizado se houve mudança estrutural.
- [ ] `useErrorLogger` integrado com tag do módulo.
- [ ] Sem funções duplicadas: imports de `src/lib/utils/` em vez de copiar.
- [ ] `TASKS.md` atualizado.

### Qualidade operacional (deploy/ambiente)
- [ ] Ambiente dev/homolog/prod separados; nenhuma mistura.
- [ ] Backup e rollback preparados antes de mudança estrutural.
- [ ] Validação local (`npx tsc --noEmit`, `npm run lint`) executada antes de qualquer deploy.
- [ ] `npm run db:check-link` confirmado antes de `db:migration-list`/`db:lint`/deploy.

## 4. Fluxo recomendado

1. Identificar o(s) tipo(s) de mudança da tarefa e localizar os guias aplicáveis no mapa da seção 3.
2. Ler o(s) guia(s) e o CRC do módulo (se existir) antes de alterar qualquer arquivo.
3. Implementar.
4. Marcar o checklist consolidado, item a item, justificando o que não se aplica.
5. Rodar as validações da seção 7.
6. Seguir [`guia_git.md`](guia_git.md) para apresentar a entrega.

## 5. Exemplos

**Pedido:** "Adiciona uma tela nova de cadastro de Materiais em Massa."
**Comportamento esperado:** ler `guia_backend.md` (estrutura de módulo + integridade + performance), `guia_frontend.md` (UI/filtros), `guia_sql.md` (se criar tabela/índice), criar `verificacao/crc/materiais.md` a partir do template se o módulo for novo, e marcar o checklist consolidado completo antes do PR.

**Pedido:** "Corrige um bug pequeno de formatação de data numa coluna existente."
**Comportamento esperado:** checklist consolidado ainda é percorrido, mas a maioria dos itens é marcada como "não aplicável" com justificativa de uma linha (não é uma escrita nova, não muda auth, não muda schema).

## 6. Guardrails

Nunca:
- Abrir PR sem marcar o checklist consolidado (mesmo que a mudança pareça pequena).
- Pular a leitura do CRC do módulo quando ele existir.
- Tratar "não aplicável" como equivalente a "não verifiquei" — sempre justificar em uma linha.

## 7. Validação

- `npx tsc --noEmit`
- `npm run lint`
- `npm run build` (mudanças que afetam rota/build)
- `npm run db:lint` / `npm run db:security-check` (mudanças de schema/RPC)

**Lacuna conhecida:** o projeto não tem suíte de testes automatizados hoje (`package.json` não define script `test`). Até isso ser resolvido, a validação deste guia fica limitada a typecheck/lint/build e verificação manual do caminho feliz — ver TODO no relatório da migração de documentação (2026-07).
