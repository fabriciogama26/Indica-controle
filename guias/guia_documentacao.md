# Guia de Documentação

## 1. Escopo

Obrigatório sempre que a tarefa: cria/edita `README.md`; cria ou altera uma tela (page); altera controller/hook/service/util relacionado a uma tela; altera regra de negócio relevante (validação, cancelamento, saldo, permissões); ou atualiza `TASKS.md`.

## 2. Fontes de verdade

- `README.md` (raiz) — já segue o padrão abaixo corretamente; usar como referência de formato.
- `docs/Tela_Entrada_SaaS.txt` — referência de modelo para o padrão TXT de tela.
- `TASKS.md` — log vivo de tarefas.

## 3. Regras obrigatórias

### README.md
1. Toda criação ou modificação de `README.md` segue **exatamente** esta estrutura e ordem:
   ```
   # Nome do Projeto
   (descrição curta e objetiva)

   ## Visão geral
   ## Tecnologias
   ## Requisitos
   ## Como rodar o projeto
   ### Ambiente de desenvolvimento
   ### Build / Produção (se aplicável)
   ## Variáveis de ambiente
   ## Estrutura de pastas
   ## Estrutura completa de pastas
   ## Verificação de dados em (caso exista): D:\Fabricio\Projetos SaaS\API-Estoque\supabasebackup
   ## Fluxo principal
   ## Testes
   ## Troubleshooting
   ## Status do projeto
   ## Licença
   ```
2. Se o README existente não seguir o padrão, ele deve ser ajustado — nunca criar um README alternativo fora dele.
3. Não inventar comandos, tecnologias ou fluxos que não existam no projeto — confirmar em `package.json`/scripts antes de escrever.
4. Linguagem técnica, direta, objetiva. Proibido texto promocional, floreio ou storytelling. Preferir listas a parágrafos longos. Exemplos sempre em bloco de código.
5. Se a mudança impactar uso, instalação ou configuração, o README deve ser atualizado na mesma tarefa.

### Docs por tela (`/docs/<Tela>.txt`)
6. Sempre que criar/alterar uma tela, controller/hook/service/util relacionado, ou regra de negócio relevante, criar/atualizar `/docs/Tela_<Nome>_SaaS.txt` seguindo o mesmo padrão do modelo de referência (estrutura + títulos + separadores).
7. Estrutura obrigatória do TXT, nesta ordem: "Tela: `<Nome>`", "Visao geral", "Arquitetura", "Cadastro" (quando houver), "Filtros, auto-complete e listagem" (quando houver), "Boas praticas", "Cancelamento e saldo" (quando houver), "Atalhos" (quando houver), "Atualizacao YYYY-MM" (quando aplicável), "Mapa de Codigo" (funções principais com caminho e responsabilidade, constantes/configurações, funções utilitárias relacionadas, serviços/integrações externas, ajuda contextual se existir).
8. No TXT, mapear: arquivos alterados/criados; funções/hooks/constantes tocadas; comportamento antes/depois quando mudou.

### TASKS.md
9. Atualizar `TASKS.md` com base no estado atual do código ao final de toda tarefa — não deixar tarefas concluídas sem marcar `[x]`, nem tarefas pendentes sem registrar.
10. Se a mudança criar uma feature relevante, sugerir atualização de `CHANGELOG.md` (quando o projeto tiver um).

### Rotina de dependências
11. Rodar `npm outdated` mensalmente e registrar as pendências (em `TASKS.md` ou item próprio) antes de atualizar qualquer dependência.

## 4. Fluxo recomendado

1. Antes de alterar código de uma tela: identificar se ela já tem `/docs/Tela_<Nome>_SaaS.txt` e ler o estado atual documentado.
2. Depois da mudança: atualizar o TXT da tela (seção "Atualizacao YYYY-MM" + "Mapa de Codigo").
3. Atualizar `TASKS.md` refletindo o estado real.
4. Se o README foi impactado (novo comando, nova variável de ambiente, nova pasta), atualizar na mesma tarefa.

## 5. Exemplos

**Pedido:** "Adiciona um novo filtro na tela de Projetos."
**Comportamento esperado:** atualizar `docs/Tela_Projetos_SaaS.txt` na seção "Filtros, auto-complete e listagem" e no "Mapa de Codigo" (nova constante/hook tocado), sem tocar no README (não impacta instalação/configuração).

**Pedido:** "Adiciona uma variável de ambiente nova para uma integração."
**Comportamento esperado:** atualizar a seção "Variáveis de ambiente" do README, sem valores fictícios — apenas o nome da variável e sua finalidade.

## 6. Guardrails

Nunca:
- Criar um README fora da estrutura obrigatória, mesmo que "temporário".
- Inventar um comando ou script que não existe em `package.json`.
- Deixar uma tela alterada sem atualizar seu TXT correspondente.
- Deixar `TASKS.md` desatualizado em relação ao código.

## 7. Validação

- Conferir que o README segue a ordem exata das seções (regra 1).
- Conferir que o TXT da tela tem a seção "Atualizacao YYYY-MM" mais recente refletindo a mudança.
- Conferir que `TASKS.md` tem uma linha nova ou atualizada para a tarefa.
