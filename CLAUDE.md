# Regras obrigatórias para o Codex neste repositório

## Prioridade
Estas instruções têm prioridade máxima.
Em caso de conflito, siga esta ordem:
1. Este CLAUDE.md
2. Documentação do repositório
3. Solicitação do usuário
4. REGRA_DE_NEGOCIO.md
5. estrutura_saas_multitenant.md

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
2. Explicar como validar (build, test, run).

---

## Documentação complementar
- Se uma mudança impactar uso, instalação ou configuração, o README DEVE ser atualizado.
- Se criar feature relevante, sugerir atualização de CHANGELOG.md.

---

## Rotina de dependencias (obrigatorio)
- Rodar `npm outdated` mensalmente e registrar as pendencias antes de atualizar.

---

## Regra final (não negociável)
Se alguma instrução deste CLAUDE.md não puder ser cumprida, o Codex DEVE:
1. Parar
2. Explicar o motivo
3. Pedir instruções adicionais

Nunca assumir.

## Regra da Task
Atualize o arquivo TASKS.md com base no estado atual do código.


# Regras obrigatórias para o Codex (SaaS Multi-tenant)

## Prioridade
Ordem de prioridade:
1) Este CLAUDE.md
2) /docs e documentação do repositório
3) Solicitação do usuário

Em caso de conflito, pare e peça orientação.

---

## Regra final (não negociável): confirmação antes do "fim"
Antes de concluir qualquer entrega (especialmente mudanças em código/docs), o Codex DEVE:
1) Mostrar um resumo do que vai mudar (checklist)
2) Mostrar o texto do commit sugerido (detalhado e mapeado)
3) Perguntar: **"Confirma que posso aplicar/fechar essas mudanças?"**
E só então finalizar.

---

## Multi-tenant: regras de segurança e dados
### Escopo de tenant
- Todo dado de negócio deve estar vinculado a `account_owner_id` (ou equivalente do projeto).
- Nenhuma query pode "vazar" dados entre tenants.
- Onde existir RLS (ex.: Supabase/Postgres), sempre assumir **RLS ON** e validar políticas.

### Regras de acesso
- Usuário comum: acesso SOMENTE ao tenant dele.
- Usuário master/admin (se existir): acesso controlado (via função `is_master()`/role/claim do JWT).
- Preferir RPC security-definer para catálogos compartilhados/segurança (quando fizer sentido).

### Mudanças em banco
- Toda alteração de schema deve:
  - Ter migration versionada
  - Considerar impacto em RLS, índices e performance
  - Incluir fallback/backfill quando necessário

### Auditoria / logs
- Mudanças sensíveis (estoque, entradas/saídas, acidentes, permissões) devem gerar log/auditoria.
- Erros de tela devem ser registrados com "tag" do módulo (ex.: `useErrorLogger('<modulo>')`).

---

## Padrão de Performance — Backend (obrigatório)
Toda tela ou endpoint novo que liste, pagine ou agregue dados DEVE seguir este padrão antes de ser considerado pronto. Referência detalhada com exemplos de código: `docs/arquitetura/padrao-performance-backend.md`.

### Listas operacionais
- Paginação real no banco via `count + range` (ou RPC equivalente). Proibido buscar todos os registros para paginar/filtrar em memória no Node.
- Filtros nativos (coluna indexada: data, status, tenant_id, projeto, equipe, id) vão direto ao banco.
- Filtros derivados (sem coluna própria, calculados em runtime) viram pós-filtro aplicado SOMENTE nos itens da página atual retornada pelo banco — nunca sobre o dataset completo. Quando isso tornar o total exibido aproximado, documentar o trade-off no TXT da tela.

### Históricos
- Toda query de histórico/auditoria DEVE ter `.limit(N)`. Padrão: 50 para histórico de ações exibido em modal/tela; até 500 para listas de cruzamento de IDs internas (uso interno, não exibidas diretamente).

### Catálogos e dados estáticos
- Dados que mudam pouco (catálogos, projetos, equipes, tipos) usam cache em memória com TTL (padrão 5 min) e endpoint próprio (`/meta` ou equivalente), separado da listagem/operação que muda a cada request.
- O frontend carrega catálogo e lista/agendamento em paralelo (duas chamadas simultâneas via `Promise.all`), nunca em série.

### Queries independentes
- Toda query sem dependência do resultado de outra DEVE rodar em `Promise.all`. Proibido encadear `await` sequencial quando não há dependência real entre os dados buscados.

### Dashboards e apurações
- Nunca tratar como lista comum carregada por inteiro no Node. Usar RPC de agregação, rollup ou view materializada no banco.

### Antes de criar uma tela/endpoint novo
1. Verificar se já existe padrão equivalente implementado (Medição, Medição As Built, Programação) e reaproveitar a mesma arquitetura — não reinventar.
2. Se a tela tiver lista operacional + catálogo estático, separar em dois endpoints desde o início (não tratar como otimização posterior).

---

## Padrão OBRIGATÓRIO de README.md
Quando criar/editar README.md, seguir exatamente esta ordem:

# Nome do Projeto
Descrição curta e objetiva.

## Visão geral
## Tecnologias
## Requisitos
## Como rodar o projeto
### Ambiente de desenvolvimento
### Build / Produção (se aplicável)
## Variáveis de ambiente
## Estrutura de pastas
## Estrutura completa de pastas
## Verificacao de dados em (caso exista):
D:\Fabricio\Projetos SaaS\API-Estoque\supabasebackup
## Fluxo principal
## Testes
## Troubleshooting
## Status do projeto
## Licença

Regras:
- Direto, técnico, sem marketing.
- Não inventar comandos/fluxos: buscar em package.json/Makefile/scripts antes.
- Exemplos sempre em bloco de código.

---

## Docs obrigatórias (pasta /docs): padrão TXT mapeado
Sempre que:
- Criar/alterar tela (page)
- Alterar controller/hook/service/util relacionado a uma tela
- Alterar regras de negócio relevantes (validação, cancelamento, saldo, permissões)
O Codex DEVE criar/atualizar um arquivo em `/docs/<Tela>.txt` seguindo o MESMO padrão do modelo anexado (Estrutura + títulos + separadores). Referência: Entradas.txt.

### Estrutura obrigatória do TXT
- "Tela: <Nome>"
- "Visao geral"
- "Arquitetura"
- "Cadastro" (quando houver)
- "Filtros, auto-complete e listagem" (quando houver)
- "Boas praticas"
- "Cancelamento e saldo" (quando houver)
- "Atalhos" (quando houver)
- "Atualizacao YYYY-MM" (quando aplicável)
- "Mapa de Codigo (funcoes, hooks e constantes)"
  - Funcoes principais (com Caminho e Responsavel por)
  - Constantes e configuracoes
  - Funcoes utilitarias relacionadas
  - Servicos e integracoes externas
  - Ajuda contextual (se existir)

### Regra de mapeamento
No TXT, o Codex DEVE mapear:
- arquivos alterados/criados
- funções/hooks/constantes tocadas
- comportamento antes/depois (se mudou)

---

## Commit: texto obrigatório (detalhado e mapeado)
O Codex SEMPRE deve sugerir um commit message + corpo detalhado SOMENTE NO FINAL.

### Formato recomendado
- Linha 1 (título): `type(scope): resumo curto`
  Tipos: feat, fix, refactor, docs, chore, test
- Corpo (obrigatório), incluindo:
  - **O que foi feito** (bullets)
  - **Arquivos tocados** (lista)
  - **Mapeamento por módulo/tela** (o que mudou em cada parte)
  - **Como validar** (comandos e passos)
  - **Impacto multi-tenant** (RLS/tenant scope/segurança) quando aplicável
  - **Docs atualizadas** (qual /docs/<Tela>.txt foi criado/alterado)

Exemplo de corpo:
- O que foi feito:
  - ...
- Arquivos:
  - src/...
- Mapeamento:
  - Tela X: ...
  - Service Y: ...
- Como validar:
  - ...
- Multi-tenant:
  - ...
- Docs:
  - docs/X.txt atualizado

---

## Fluxo de alteração (obrigatório)
Antes de mudar código:
- Plano em até 3 bullets.

Depois:
- Resumo do que mudou.
- Como validar.
- Texto do commit (detalhado e mapeado).
- Perguntar confirmação do usuário para encerrar.
