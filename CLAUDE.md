# Regras obrigatórias para o Codex neste repositório

## Prioridade
Estas instruções têm prioridade máxima.
Em caso de conflito, siga esta ordem:
1. Este CLAUDE.md
2. Documentação do repositório
3. Solicitação do usuário
4. REGRA_DE_NEGOCIO.md
5. estrutura_saas_multitenant.md
6. Estrutura_de_commit.md

O Codex NÃO deve ignorar estas regras.

---

## Regra geral de comportamento
- Sempre leia este CLAUDE.md antes de qualquer ação.
- Não criar, editar ou sugerir README.md fora do padrão definido abaixo.
- Se o README existente não seguir o padrão, ele DEVE ser ajustado.
- Não inventar comandos, tecnologias ou fluxos que não existam no projeto.
- Se faltar informação, perguntar antes de completar.

---

## Padrão OBRIGATÓRIO de README.md

Toda criação ou modificação de README.md DEVE seguir **exatamente** esta estrutura e ordem:

# Nome do Projeto

Descrição curta e objetiva do propósito do projeto.

---

## Visão geral
- Problema resolvido
- Solução proposta
- Contexto de uso

---

## Tecnologias
Lista objetiva das tecnologias principais.

---

## Requisitos
Pré-requisitos necessários para rodar o projeto.

---

## Como rodar o projeto

### Ambiente de desenvolvimento
Passo a passo com comandos reais e testados.

---

### Build / Produção
Incluir somente se aplicável.

---

## Variáveis de ambiente
Lista explícita das variáveis obrigatórias, sem valores fictícios.

---

## Estrutura de pastas
Visão resumida e fiel da organização do projeto.

---

## Estrutura completa de pastas
Visão completa de cada arquivo. Tem que expandir cada pasta e dizer os arquivos e oque faz

---

## Verificação de dados em(caso exista):
D:\Fabricio\Projetos SaaS\API-Estoque\supabasebackup

## Fluxo principal
Descrever o caminho principal de uso do sistema (happy path).

---

## Testes
- Comandos para rodar testes, ou
- Declaração explícita de que não existem testes automatizados.

---

## Troubleshooting
Lista de erros comuns com causa e solução.

---

## Status do projeto
Declarar claramente:
🟢 Em produção  
🟡 Em desenvolvimento  
🔴 Descontinuado  

---

## Licença
Tipo de licença do projeto.

---

## Regras de escrita
- Linguagem técnica, direta e objetiva.
- Proibido texto promocional ou marketing.
- Proibido floreio, storytelling ou exagero.
- Usar exemplos em bloco de código quando aplicável.
- Preferir listas a parágrafos longos.

---

## Fluxo de alteração de código
Antes de modificar código:
1. Explicar em até 3 bullets o que será feito.

Depois da modificação:
1. Explicar o que mudou.
2. Explicar como validar (seção 9).
3. Atualizar documentação afetada (seção 10).
4. Apresentar o texto do commit (`guias/guia_git.md`) e perguntar confirmação antes de encerrar (seção 11).

## 5. Regras de arquitetura

- Toda tela nova/refatorada segue `src/modules/dashboard/<nome-tela>/` (ou subpastas `api/hooks/components/...` para módulos grandes); backend correspondente em `src/server/modules/<dominio>/`. Rota em `src/app/api/<rota>` delega — nunca contém regra de negócio.
- Feature não importa regra de domínio de feature irmã; comunicação via contrato explícito (`core`, `server/modules`, API/RPC). Toda feature expõe fachada pública (`index.ts`).
- `shared`/`lib`/`utils`/`services`/`helpers` globais só contêm infraestrutura universal — nunca regra de domínio.
- `PageView.tsx` até 1.000 linhas; `route.ts`/controller até 1.500 linhas — acima disso exige plano de modularização no TXT da tela (`programacao/route.ts` já está em ~4.500 linhas, CRÍTICO).
- Multi-tenant: toda entidade de negócio carrega `tenant_id`; toda query filtra por tenant no servidor; RLS sempre ativa como última barreira; nenhuma rota confia em `tenant_id` vindo do cliente.
- Detalhe completo por domínio: `guias/guia_backend.md`, `guias/guia_sql.md`, `guias/guia_supabase.md`, `guias/guia_frontend.md`.

## 6. Regras de alteração de código

- Não inventar comandos, tecnologias ou fluxos que não existam no projeto — confirmar em `package.json`/código antes de afirmar.
- Não adicionar abstração, feature flag ou generalização além do que a tarefa pede.
- Não deixar implementação parcial nem remover código sem evidência de que não é usado (ver `guias/guia_backend.md` para busca de uso antes de remover).
- Se faltar informação para decidir, perguntar antes de completar.
- Nunca resolver uma divergência entre guia e código em silêncio — ver seção 12.

## 7. Guias obrigatórios por tipo de tarefa

Leia apenas os guias aplicáveis, mas não deixe de ler nenhum guia diretamente acionado pela tarefa. Uma tarefa pode acionar vários guias.

| Tarefa envolve | Guia |
|---|---|
| API Route, módulo server-side, transação, concorrência, paginação, cache de API | [`guias/guia_backend.md`](guias/guia_backend.md) |
| PageView, hook, componente, filtro, listagem, mudança visual/responsividade/acessibilidade | [`guias/guia_frontend.md`](guias/guia_frontend.md) |
| Migration, RLS, constraint, índice, função `SECURITY DEFINER`, trigger PL/pgSQL | [`guias/guia_sql.md`](guias/guia_sql.md) |
| Auth/sessão, `service_role`, Edge Function, CLI do Supabase, Realtime | [`guias/guia_supabase.md`](guias/guia_supabase.md) |
| README, doc TXT de tela, `TASKS.md`, dependências | [`guias/guia_documentacao.md`](guias/guia_documentacao.md) |
| Proposta de commit, uso de comandos git | [`guias/guia_git.md`](guias/guia_git.md) |
| Qualquer PR/entrega de código | [`guias/guia_validacao.md`](guias/guia_validacao.md) (sempre) |
| Deploy de Edge Function | [`guias/runbook_deploy_edge_functions.md`](guias/runbook_deploy_edge_functions.md) |
| Gerar uma ordem de engenharia a partir de um pedido simples | [`prompts/gerar-prompt.md`](prompts/gerar-prompt.md) |

**Exemplo real de combinação:** "Adiciona um filtro por status na listagem de Cronograma de Solicitações" aciona `guia_backend.md` (filtro no banco, não em memória), `guia_frontend.md` (estado do filtro, debounce se for texto) e `guia_validacao.md` (checklist antes do PR) — não aciona `guia_sql.md` a menos que o filtro exija coluna/índice novo.

## 8. Ferramentas MCP disponíveis

Nenhum servidor MCP configurado no momento (sem `.mcp.json` no repositório e sem servidor Supabase MCP local). Se um servidor Supabase MCP for configurado no futuro, preferir inspecionar schema/RLS via MCP a inferir apenas pela leitura de migrations.

## 9. Validação obrigatória

Comandos reais do projeto (`package.json`):
- `npx tsc --noEmit` — typecheck.
- `npm run lint` — ESLint.
- `npm run build` — build de produção, para mudanças que afetam rota/build.
- `npm run db:check-link` — confirma o projeto Supabase linkado antes de qualquer comando abaixo.
- `npm run db:migration-list` / `npm run db:lint` — só depois do link confirmado.
- `npm run db:security-check` / `npm run db:security-check-live` — grants de RPC `SECURITY DEFINER`.

Não há script `test` — até uma suíte automatizada existir, validação de front/UI é manual (caminho feliz + estado vazio/erro), registrada como lacuna em `guias/guia_validacao.md`.

## 10. Documentação

## Padrão de permissão granular por operação (obrigatório)
Aplica-se quando uma permissão/flag bloqueia apenas PARTE das operações de uma tela, e não a tela inteira (ex.: `saida-requisicao` dentro de Operacoes de Equipe).

1. Backend: o `requirePageAction` da permissão específica fica DENTRO do `if` da operação bloqueada, nunca no topo da rota. As demais operações continuam sob a permissão da tela.
2. Frontend: se a opção bloqueada some de um `select`/lista, TODOS os caminhos que escrevem esse estado devem respeitar a mesma flag — estado inicial, `resetForm()` pós-save, cancelar, limpar filtros. Nunca deixar o estado guardar um valor que a UI não renderiza: o select exibe outra coisa, o submit envia o valor invisível e o backend recusa a operação errada.
3. Validar sempre o caminho longo, não só a carga da tela: executar UMA operação permitida, deixar o formulário resetar e executar OUTRA. Esse tipo de bug só aparece na segunda.
4. Documentar em `/docs/<Tela>.txt` o escopo exato do bloqueio: o que fica indisponível e, explicitamente, o que continua liberado.

---

## Padrão OBRIGATÓRIO de README.md
Quando criar/editar README.md, seguir exatamente esta ordem:

## 11. Comunicação e entrega

- Seguir `guias/guia_git.md`: nunca executar `git add`/`commit`/`push`/`checkout -b` sem pedido explícito do usuário na tarefa atual.
- Ao final de toda entrega: resumo do que mudou, validações executadas, texto do commit (6 seções), e a pergunta **"Confirma que posso aplicar/fechar essas mudanças?"** antes de encerrar.

## 12. Divergência entre guia e implementação

Quando um guia e o código real divergirem:
1. Não seguir silenciosamente nenhuma das versões.
2. Verificar se o código é evolução legítima ou desvio (migrations, histórico Git, testes).
3. Informar a divergência ao usuário.
4. Adotar a solução mais segura e compatível com a arquitetura vigente.
5. Atualizar o guia na mesma tarefa quando a regra nova for confirmada.
6. **Nunca alterar um guia apenas para justificar uma implementação incorreta.**
