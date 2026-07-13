# Guia de Git

## 1. Escopo

Obrigatório ao final de toda tarefa que altera ou cria arquivos — define como propor o commit e como o agente deve (e não deve) interagir com o git neste repositório.

## 2. Fontes de verdade

- Preferência explícita do usuário (memória de feedback deste projeto).
- `CLAUDE.md`, seção 11 (comunicação e entrega).

## 3. Regras obrigatórias

1. O agente nunca executa `git add`, `git commit`, `git checkout -b`, `git push` ou qualquer comando git que altere o repositório, a não ser que o usuário peça explicitamente naquela tarefa. O usuário faz o commit e o sync manualmente.
2. Ao final de toda tarefa que altera/cria arquivos, apresentar o **texto do commit** (nunca executá-lo) seguindo exatamente esta estrutura:
   ```
   type(scope): resumo curto em português

   - O que foi feito:
     - bullets descrevendo cada mudança
   - Arquivos:
     - lista de todos os arquivos tocados com caminho completo
   - Mapeamento:
     - por módulo/tela: o que mudou em cada parte
   - Como validar:
     - comandos e passos para validar a entrega
   - Impacto multi-tenant:
     - como RLS, tenant_id, permissões e segurança foram preservados
   - Docs:
     - quais arquivos de docs foram criados ou atualizados
   ```
   Tipos aceitos no título: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`. Nenhuma seção pode ser omitida — se não aplicável, escrever "N/A" ou "nenhuma alteração".
3. Se a tarefa for apenas análise/relatório sem mudança de código, gerar o commit para os arquivos de documentação criados/alterados (nunca pular o texto do commit).
4. Antes de considerar qualquer entrega finalizada, mostrar um resumo do que vai mudar (checklist) e perguntar explicitamente: **"Confirma que posso aplicar/fechar essas mudanças?"** — só finalizar depois da confirmação.
5. `TASKS.md` é atualizado na mesma tarefa (ver [`guia_documentacao.md`](guia_documentacao.md) regra 9), antes de apresentar o texto do commit.

## 4. Fluxo recomendado

1. Concluir a implementação/alteração.
2. Atualizar `TASKS.md` e o(s) TXT(s) de tela afetados.
3. Rodar as validações aplicáveis ([`guia_validacao.md`](guia_validacao.md)).
4. Apresentar: resumo do que mudou → validações executadas → texto do commit completo → pergunta de confirmação.
5. Não executar nenhum comando git além de leitura (`git status`, `git diff`, `git log`) sem pedido explícito do usuário.

## 5. Exemplos

**Pedido:** "Corrige o bug do filtro de data na Programação."
**Comportamento esperado:** implementar a correção, atualizar `TASKS.md` e o TXT da tela, rodar `npx tsc --noEmit`/`lint`, e terminar a resposta com o texto do commit nas 6 seções — sem rodar `git commit`.

**Pedido:** "Pode commitar isso pra mim?"
**Comportamento esperado:** só então executar os comandos git pedidos, ainda seguindo o texto de commit já apresentado.

## 6. Guardrails

Nunca:
- Rodar `git add`/`git commit`/`git push`/`git checkout -b` sem pedido explícito do usuário na tarefa atual (uma autorização anterior não vale para tarefas futuras).
- Omitir qualquer uma das 6 seções do texto de commit.
- Finalizar uma entrega sem perguntar a confirmação do usuário.

## 7. Validação

- Conferir que as 6 seções do commit estão presentes e preenchidas (ou "N/A").
- Conferir que nenhum comando git de escrita foi executado sem pedido explícito.
