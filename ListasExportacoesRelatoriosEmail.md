# Listas, exportacoes CSV e envio de relatorios por email

Documento tecnico sobre tres fluxos do projeto:

- listas de tela, com foco na lista `Registros de Pessoas`;
- exportacoes em CSV abertas pelo botao `Exportar Excel (CSV)`;
- envio automatico de relatorios por email via Edge Functions.

Data da analise: 2026-09-12.

---

## Escopo

Este documento descreve o comportamento existente no codigo. Nao cria novo fluxo e nao altera regra de negocio.

Fontes principais analisadas:

D:\Fabricio\Projetos SaaS\API-Estoque

- `src/pages/Pessoas.jsx`
- `src/components/Pessoas/PessoasTable.jsx`
- `src/components/Pessoas/PessoasFilters.jsx`
- `src/hooks/usePessoasController.js`
- `src/routes/rules/PessoasRules.js`
- `src/utils/pessoasUtils.js`
- `src/services/api.js`
- `api/_shared/operations.js`
- `docs/ExportacaoExcel.txt`
- `docs/RelatorioEstoque.txt`
- `supabase/functions/relatorio-estoque-mensal`
- `supabase/functions/relatorio-estoque-mensal-email`
- `supabase/functions/relatorio-estoque-semanal`
- `supabase/functions/relatorio-estoque-semanal-email`
- `supabase/functions/relatorio-troca-epi`
- `supabase/functions/relatorio-troca-epi-email`

---

## 1. Listas como na imagem: Registros de Pessoas

### O que e a lista

A lista `Registros de Pessoas` e a tabela principal da tela `Pessoas`.

Ela aparece dentro de uma secao da pagina e mostra os colaboradores cadastrados de acordo com:

- dados carregados do backend/Supabase;
- filtros aplicados na tela;
- enriquecimento com nomes de centro de servico, setor, cargo e tipo de execucao;
- ordenacao por nome;
- paginacao visual de 20 registros por pagina.

Arquivo principal da pagina:

```text
src/pages/Pessoas.jsx
```

Componentes envolvidos:

```text
src/pages/Pessoas.jsx
src/context/PessoasContext.jsx
src/hooks/usePessoasController.js
src/components/Pessoas/PessoasFilters.jsx
src/components/Pessoas/PessoasTable.jsx
src/components/Pessoas/PessoasActions.jsx
src/components/TablePagination.jsx
```

---

### Estrutura visual da secao

Na tela, a secao tem:

- titulo: `Registros de Pessoas`;
- botao `Exportar Excel (CSV)`;
- botao `Atualizar`;
- indicador de carregamento quando `isLoading` esta ativo;
- tabela de dados;
- paginacao abaixo da tabela.

No codigo, a secao fica em `src/pages/Pessoas.jsx`.

Fluxo visual simplificado:

```text
PessoasPage
  PessoasProvider
    PessoasContent
      PageHeader
      PessoasForm
      PessoasFilters
      PessoasResumoCards
      Secao "Registros de Pessoas"
        Botao Exportar Excel (CSV)
        Botao Atualizar
        PessoasTable
          TablePagination
```

---

### Colunas exibidas

A tabela de Pessoas exibe as seguintes colunas:

| Coluna | Origem no registro | Regra de exibicao |
|---|---|---|
| Nome | `pessoa.nome` | Mostra o nome da pessoa. |
| Matricula | `pessoa.matricula` | Se vazio, mostra `-`. |
| Centro de servico | `pessoa.centroServico` ou `pessoa.local` | Se vazio, mostra `-`. |
| Setor | `pessoa.setor` | Se vazio, mostra `-`. |
| Cargo | `pessoa.cargo` | Se vazio, mostra `-`. |
| Tipo Execucao | `pessoa.tipoExecucao` | Se vazio, mostra `-`. |
| Status | `pessoa.ativo` | `false` vira `Inativo`; qualquer outro valor vira `Ativo`. |
| Registrado por | `usuarioCadastroNome`, `usuarioCadastroUsername` ou `usuarioCadastro` | Usa o primeiro campo disponivel; se nenhum existir, mostra `-`. |
| Cadastrado em | `pessoa.criadoEm` | Formatado por `formatDateTime`. |
| Acoes | `PessoasActions` | Abre detalhes, edicao, historico e cancelamento/inativacao. |

Arquivo da tabela:

```text
src/components/Pessoas/PessoasTable.jsx
```

---

### Paginacao

A paginacao da lista e local, feita no frontend.

Configuracao:

```text
src/config/pagination.js
TABLE_PAGE_SIZE = 20
```

Funcionamento:

1. A lista filtrada/ordenada chega em `PessoasTable` pela prop `pessoas`.
2. O componente guarda `currentPage` em estado local.
3. O total de paginas e calculado por `Math.ceil(pessoas.length / 20)`.
4. A pagina atual e cortada com `slice(startIndex, startIndex + PAGE_SIZE)`.
5. Se o filtro reduz a quantidade de pessoas e a pagina atual fica fora do limite, o componente ajusta a pagina automaticamente.

Importante:

- a paginacao afeta somente o que aparece na tabela;
- a exportacao CSV usa a lista inteira filtrada/ordenada, nao apenas a pagina visivel.

---

### Carregamento inicial da lista

O carregamento principal acontece no hook:

```text
src/hooks/usePessoasController.js
```

Quando o usuario autenticado existe ou muda, o hook:

1. limpa o cache local de opcoes de pessoas;
2. limpa as referencias carregadas;
3. chama `loadPessoas(PESSOAS_FILTER_DEFAULT, true)`;
4. carrega o resumo da tela com `getPessoasResumo()`.

O `userScopeKey` usado no hook combina:

- id do usuario autenticado;
- owner efetivo quando existe dependente.

Isso evita reaproveitar respostas antigas quando troca usuario/tenant.

---

### Origem dos dados

No modo remoto, a lista passa por esta cadeia:

```text
Pessoas.jsx
  usePessoasContext()
    usePessoasController()
      loadPessoas()
        listPessoas()
          dataClient
            api.pessoas.list()
              Supabase rpc_pessoas_completa()
```

Arquivos:

```text
src/services/pessoasService.js
src/services/dataClient.js
src/services/api.js
```

No service remoto, `api.pessoas.list(params)`:

- resolve o escopo de Pessoas com `resolvePessoasOwnerScope()`;
- aplica restricao por centro de servico quando o usuario nao e master e existe escopo estrito;
- resolve filtros textuais para IDs de catalogo quando parametros remotos sao enviados;
- consulta `rpc_pessoas_completa`;
- ordena por `nome`;
- pagina internamente chamadas grandes com `executePaged`;
- usa fallback local de termo quando a busca remota por termo falha.

---

### Escopo multi-tenant

A lista depende do isolamento por tenant.

Regras aplicadas pelo codigo/documentacao existente:

- `rpc_pessoas_completa` filtra por `account_owner_id/current_account_owner_id`.
- Catalogos de Pessoas usam `rpc_catalog_list` para respeitar owner.
- Dependentes herdam escopo do owner, mas o ator real continua sendo usado nos campos de auditoria.
- O hook ignora respostas assincronas se o usuario/owner mudou durante a requisicao.
- Se um usuario nao-master esta em escopo estrito e nao possui centro de servico permitido, a listagem retorna vazia.

Arquivos/migrations relacionados:

```text
supabase/migrations/20260228_fix_rpc_pessoas_completa_tenant.sql
supabase/migrations/20260308_fix_rpc_catalog_list_owner_scope.sql
src/hooks/usePessoasController.js
src/services/api.js
```

---

### Filtros da lista de Pessoas

Os filtros aparecem no componente:

```text
src/components/Pessoas/PessoasFilters.jsx
```

Campos de filtro:

- `Buscar`;
- `Centro de servico`;
- `Setor`;
- `Cargo`;
- `Tipo de execucao`;
- `Status`;
- `Cadastrado de`;
- `Cadastrado ate`.

Valores padrao:

```text
src/config/PessoasConfig.js
```

```js
{
  termo: '',
  centroServico: 'todos',
  setor: 'todos',
  cargo: 'todos',
  local: 'todos',
  tipoExecucao: 'todos',
  status: 'todos',
  cadastradoInicio: '',
  cadastradoFim: '',
}
```

---

### Como o filtro e aplicado

A funcao central de filtro e:

```text
src/routes/rules/PessoasRules.js
filterPessoas()
```

Ela aplica:

- termo livre;
- centro de servico;
- setor;
- cargo;
- status;
- intervalo de data de cadastro.

Campos usados no termo livre:

- nome;
- matricula;
- centro de servico;
- setor;
- cargo;
- tipo de execucao;
- usuario de cadastro;
- usuario de edicao.

Regra de status:

- filtro `ativo`: remove registros com `ativo === false`;
- filtro `inativo`: mantem somente registros com `ativo === false`;
- filtro `todos`: nao restringe por status.

Regra de data de cadastro:

- `cadastradoInicio` compara com inicio do dia;
- `cadastradoFim` compara com fim do dia;
- a data usada vem de `criadoEm`, `createdAt` ou `created_at`.

---

### Cache da lista

O hook usa `pessoasOptionsRef` como cache local.

Comportamento:

- quando `refreshOptions` e `true`, busca no servidor novamente;
- quando `refreshOptions` e `false` e ja existe cache, nao chama o servidor;
- nesse caso, reusa a lista em memoria, reenriquece nomes de referencias e reaplica `filterPessoas`.

Efeito pratico:

- clicar em `Aplicar` nos filtros pode usar cache local;
- clicar em `Atualizar` forca nova consulta ao backend;
- apos cadastro, edicao, cancelamento ou importacao, a tela chama `loadPessoas(filters, true)`.

---

### Ordenacao

A lista final enviada para a tabela e `pessoasOrdenadas`.

Ela e calculada por:

```text
src/routes/rules/PessoasRules.js
sortPessoasByNome()
```

Regra:

- ordena por `nome`;
- usa locale `pt-BR`;
- ignora diferenca forte de acento/caixa;
- nao altera a lista original, pois faz `slice()` antes do sort.

---

### Botao Atualizar

O botao `Atualizar` fica na secao `Registros de Pessoas`.

Ao clicar:

```js
loadPessoas(filters, true)
```

Ou seja:

- usa os filtros atuais da tela;
- forca recarga remota;
- atualiza referencias e lista;
- bloqueia o botao enquanto `isLoading` esta ativo.

---

### Acoes da linha

A coluna `Acoes` e renderizada por:

```text
src/components/Pessoas/PessoasActions.jsx
```

As acoes recebem handlers vindos do controller:

- detalhes: abre `PessoaDetailsModal`;
- editar: chama `startEdit`, preenche o formulario e rola a tela para o topo;
- historico: chama `openHistory`, consulta historico e abre modal;
- cancelar/inativar: abre `PessoaCancelModal`.

O historico usa cache por pessoa:

- se ja carregou o historico daquela pessoa, reabre usando cache;
- se ainda nao carregou, chama `getPessoaHistory(pessoa.id)`.

Cancelamento/inativacao:

- exige observacao;
- monta payload com `ativo: false`;
- chama `updatePessoa`;
- limpa historico/cache local;
- recarrega a lista.

---

### Mensagens de estado

A lista trata estes estados:

- `Carregando...`: exibido quando `isLoading` esta ativo.
- `Nenhuma pessoa cadastrada ainda.`: exibido quando a lista recebida pela tabela esta vazia.
- Erros de carregamento/salvamento: armazenados em `error` no controller e registrados via `useErrorLogger('pessoas')`.

---

## 2. Exportacoes em CSV

### O que o botao gera

O botao `Exportar Excel (CSV)` nao gera arquivo `.xlsx`.

Ele gera:

- arquivo texto `.csv`;
- separador de campos `;`;
- MIME type `text/csv;charset=utf-8;`;
- download no navegador via `Blob` e link temporario.

O termo `Excel` no botao indica que o arquivo pode ser aberto no Excel.

---

### Fluxo geral do clique

O fluxo padrao e:

```text
Usuario clica em Exportar Excel (CSV)
  handleExportCsv()
    define nome do arquivo
    chama downloadXxxCsv(lista, contexto)
      buildXxxCsv()
        monta cabecalho
        monta linhas
        sanitiza valores
      cria Blob
      cria URL temporaria
      cria <a download>
      dispara click()
      remove link
      revoga URL
```

Nao ha chamada ao backend durante a exportacao de tela.

A exportacao usa os dados que ja estao carregados em memoria.

---

### Sanitizacao dos valores

Cada modulo tem sua propria funcao local de sanitizacao.

Regra comum:

- `null` e `undefined` viram campo vazio;
- aspas duplas internas viram aspas duplicadas;
- quebras de linha viram espaco;
- valores contendo `;`, aspas ou quebra de linha sao envolvidos por aspas.

Exemplo conceitual:

```text
Valor original:
Joao "Teste"; Setor A

Valor no CSV:
"Joao ""Teste""; Setor A"
```

---

### Separador

Todas as exportacoes usam `;`.

Motivo:

- e o formato mais compativel com abertura direta no Excel em ambiente pt-BR;
- evita conflito com virgula decimal em alguns cenarios.

Observacao:

- alguns builders incluem a linha `sep=;`;
- outros nao incluem.

---

### Exportacao da lista de Pessoas

Na tela da imagem, o botao chama:

```text
src/pages/Pessoas.jsx
handleExportCsv()
```

Codigo do fluxo:

```js
const filename = `pessoas-${new Date().toISOString().slice(0, 10)}.csv`
downloadPessoasCsv(pessoasOrdenadas, { filename })
```

Arquivos:

```text
src/pages/Pessoas.jsx
src/utils/pessoasUtils.js
```

Fonte dos dados:

- `pessoasOrdenadas`;
- ou seja, a lista ja filtrada pelo controller e ordenada por nome.

Importante:

- exporta todos os registros filtrados;
- nao exporta apenas os 20 registros da pagina visivel;
- se o filtro estiver em `Ativo`, exporta ativos;
- se o filtro estiver em `Inativo`, exporta inativos;
- se o filtro estiver em `Todos`, exporta todos os registros carregados que respeitam o escopo do usuario.

Nome do arquivo:

```text
pessoas-AAAA-MM-DD.csv
```

O dia vem de `new Date().toISOString().slice(0, 10)`, portanto usa data UTC.

---

### Colunas do CSV de Pessoas

O CSV de Pessoas possui:

| Coluna no CSV | Origem |
|---|---|
| ID | `pessoa.id` |
| Nome | `pessoa.nome` |
| Matricula | `pessoa.matricula` |
| Centro de servico | `pessoa.centroServico` ou `pessoa.local` |
| Setor | `pessoa.setor` |
| Cargo | `pessoa.cargo` |
| Tipo de execucao | `pessoa.tipoExecucao` |
| Data admissao | `pessoa.dataAdmissao` formatada como data |
| Data demissao | `pessoa.dataDemissao` formatada como data |
| Status | `ATIVO` ou `INATIVO` |
| Usuario cadastro | `pessoa.usuarioCadastro` |
| Usuario edicao | `pessoa.usuarioEdicao` |
| Criado em | `pessoa.criadoEm` formatado como data/hora |
| Atualizado em | `pessoa.atualizadoEm` formatado como data/hora |

Arquivo:

```text
src/utils/pessoasUtils.js
buildPessoasCsv()
downloadPessoasCsv()
```

Observacao importante:

- a tabela visual mostra `Registrado por` priorizando nome resolvido;
- o CSV atual usa `usuarioCadastro` e `usuarioEdicao`;
- se esses campos forem UUIDs ou valores tecnicos, o CSV pode nao mostrar o nome amigavel que aparece na tela.

---

### Exportacoes CSV existentes por tela

| Tela | Arquivo da pagina | Util de CSV | Nome do arquivo |
|---|---|---|---|
| Pessoas | `src/pages/Pessoas.jsx` | `src/utils/pessoasUtils.js` | `pessoas-AAAA-MM-DD.csv` |
| Acidentes | `src/pages/Acidentes.jsx` | `src/utils/acidentesExport.js` | `acidentes-AAAA-MM-DD.csv` |
| ASO | `src/pages/AsoPage.jsx` | `src/utils/asoExport.js` | `controle-de-aso-AAAA-MM-DD.csv` |
| Entradas | `src/pages/EntradasPage.jsx` | `src/utils/entradasExport.js` | `entradas-AAAA-MM-DD.csv` |
| Saidas | `src/pages/SaidasPage.jsx` | `src/utils/saidasExport.js` | `saidas-AAAA-MM-DD.csv` |
| Materiais | `src/pages/Materiais.jsx` | `src/utils/MateriaisUtils.js` | `materiais-AAAA-MM-DD.csv` |
| Estoque Atual | `src/pages/EstoquePage.jsx` | `src/utils/estoqueUtils.js` | `estoque-atual-AAAA-MM-DD.csv` |

---

### Dados exportados por tela

Regra geral:

- exporta a lista filtrada/ordenada em memoria;
- nao exporta a pagina visual atual;
- nao gera XLSX real;
- nao salva historico de exportacao no banco.

Detalhes por tela:

#### Pessoas

Origem:

- `pessoasOrdenadas`.

Colunas:

- ID;
- Nome;
- Matricula;
- Centro de servico;
- Setor;
- Cargo;
- Tipo de execucao;
- Data admissao;
- Data demissao;
- Status;
- Usuario cadastro;
- Usuario edicao;
- Criado em;
- Atualizado em.

#### Acidentes

Origem:

- `acidentesFiltrados`.

Colunas:

- Nome;
- Matricula;
- Status;
- Data;
- Centro de servico;
- Local;
- CAT;
- CID;
- Registrado por;
- Cadastrado em.

#### ASO

Origem:

- lista `asos` carregada pela tela.

Colunas:

- ID;
- Funcionario;
- Matricula;
- Tipo de exame;
- Data do exame;
- Proximo vencimento;
- Dias para vencer;
- Status;
- Centro de servico;
- Setor;
- Cargo;
- Observacao;
- Cadastrado em;
- Atualizado em.

#### Entradas

Origem:

- `filteredEntradas`;
- mapas de materiais e centros para resolver nomes.

Colunas:

- ID;
- Centro de estoque;
- Material;
- Descricao;
- Quantidade;
- Status;
- Registrado por;
- Cadastrado em.

#### Saidas

Origem:

- `saidasFiltradas`;
- mapas de pessoas, materiais e centros.

Colunas:

- ID;
- Pessoa;
- Matricula;
- Material;
- Quantidade;
- Centro de estoque;
- Centro de custo;
- Centro de servico;
- Data entrega;
- Data troca;
- Status;
- Registrado por;
- Cadastrado em.

#### Materiais

Origem:

- `materiaisOrdenados`.

Colunas:

- ID;
- CA;
- Grupo;
- Material;
- Descricao;
- Valor unitario;
- Validade (dias);
- Fabricante;
- Registrado por;
- Cadastrado em.

#### Estoque Atual

Origem:

- `itensFiltradosBase`;
- representa saldo fisico acumulado.

Colunas:

- Material ID;
- Material;
- Fabricante;
- CA;
- Cor;
- Validade (dias);
- Centros de estoque;
- Quantidade em estoque;
- Total de entradas;
- Total de saidas;
- Estoque minimo;
- Deficit;
- Valor unitario;
- Valor total;
- Valor para reposicao;
- Ultima atualizacao;
- Ultima saida.

Observacao:

- mesmo quando a tela usa modo de movimentacao por periodo, o CSV de Estoque Atual exporta a posicao fisica acumulada.

---

### Diferenca entre exportacao de tela e CSV de erro de importacao

Existem dois usos diferentes de CSV no projeto.

#### Exportacao de tela

Gerada no navegador:

- Pessoas;
- Acidentes;
- ASO;
- Entradas;
- Saidas;
- Materiais;
- Estoque Atual.

Nao depende de Edge Function.

#### CSV de erro de importacao

Gerado por Edge Functions de importacao em massa.

Exemplos:

- cadastro em massa de Pessoas;
- desligamento em massa;
- ASO em massa;
- acidentes em massa;
- cadastro base em massa.

Esses arquivos ficam no Storage, normalmente em:

```text
imports/<owner_id>/erros/*_erros_<uuid>.csv
```

Formato documentado nas telas de importacao:

```text
linha,matricula,coluna,motivo
```

O CSV de erro serve para auditoria/correcao da planilha importada. Ele nao e a mesma coisa que a exportacao da lista.

---

### Inconsistencias ja mapeadas

O documento `docs/ExportacaoExcel.txt` registra inconsistencias atuais:

- algumas telas adicionam BOM UTF-8 e outras nao;
- algumas telas adicionam `sep=;` e outras nao;
- Pessoas, Materiais e Estoque Atual podem ter maior risco de acentuacao incorreta ao abrir direto no Excel sem BOM;
- os nomes de arquivo nem sempre usam a mesma regra de data local/UTC;
- cada modulo reimplementa a sanitizacao CSV, sem utilitario compartilhado.

Estado atual conhecido:

- com BOM: Acidentes, ASO, Entradas, Saidas;
- sem BOM: Pessoas, Materiais, Estoque Atual;
- com `sep=;`: ASO, Entradas, Saidas;
- sem `sep=;`: Acidentes, Pessoas, Materiais, Estoque Atual.

---

## 3. Envio de relatorios por email

### Visao geral

O envio de relatorios por email acontece em Edge Functions do Supabase.

Ha tres fluxos principais:

1. relatorio mensal de estoque;
2. relatorio semanal de movimentacao;
3. relatorio semanal de troca de EPI.

Todos usam:

- Supabase Service Role para consultar dados e atualizar status;
- `CRON_SECRET` para autorizar chamadas de cron;
- Brevo para envio SMTP/API;
- tabela `inventory_report` como historico/status;
- tabela `edge_functions_error_report` para log de execucao de cron.

---

### Tabela de controle

A tabela central e:

```text
inventory_report
```

Campos usados no fluxo de email:

| Campo | Uso |
|---|---|
| `account_owner_id` | Tenant/owner do relatorio. |
| `created_by` | Usuario/owner que gerou o relatorio. |
| `periodo_inicio` | Inicio do periodo do relatorio. |
| `periodo_fim` | Fim do periodo do relatorio. |
| `metadados` | JSON com tipo, contexto, arquivos ou itens. |
| `arquivos_total` | Quantidade de arquivos gerados, usado no semanal. |
| `email_status` | `pendente`, `enviado` ou `erro`. |
| `email_enviado_em` | Timestamp do envio bem-sucedido. |
| `email_erro` | Mensagem da ultima falha. |
| `email_tentativas` | Contador de tentativas de envio. |

Migrations relacionadas:

```text
supabase/migrations/20260218_add_inventory_report_email_fields.sql
supabase/migrations/20260221_add_inventory_report_files_count.sql
```

---

### Status do email

Estados usados:

```text
pendente
enviado
erro
```

Regra geral das functions de envio:

1. Busca o ultimo relatorio do owner para o tipo esperado.
2. Se `email_status` esta vazio, trata como `pendente`.
3. Se nao esta em `pendente` ou `erro`, pula o envio.
4. Se tenta enviar, incrementa `email_tentativas`.
5. Se Brevo retorna sucesso, grava:

```text
email_status = enviado
email_enviado_em = now()
email_erro = null
email_tentativas = tentativas + 1
```

6. Se Brevo ou validacao falha, grava:

```text
email_status = erro
email_erro = mensagem da falha
email_tentativas = tentativas + 1
```

Modo teste:

- quando `test_email` e informado, o envio nao atualiza `inventory_report`;
- se `test_email` for usado sem `test_owner_id`, a function limita o envio a 1 owner.

---

### Autorizacao das Edge Functions

As Edge Functions de cron aceitam somente `POST`.

Tambem respondem `OPTIONS` para CORS.

Autorizacao:

- a variavel `CRON_SECRET` precisa existir;
- a chamada deve enviar o segredo em `x-cron-secret`; ou
- a chamada deve enviar o segredo como Bearer token no header `Authorization`.

Se faltar segredo:

```text
500 Missing CRON_SECRET
```

Se o segredo nao bater:

```text
401 Unauthorized
```

---

### Variaveis de ambiente

Obrigatorias para envio por email:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
CRON_SECRET
BREVO_API_KEY
RELATORIO_ESTOQUE_EMAIL_FROM
```

Opcionais:

```text
RELATORIO_ESTOQUE_EMAIL_FROM_NAME
RELATORIO_ESTOQUE_EMAIL_REPLY_TO
TERMO_EPI_EMPRESA_NOME
TERMO_EPI_EMPRESA_DOCUMENTO
TERMO_EPI_EMPRESA_ENDERECO
TERMO_EPI_EMPRESA_CONTATO
TERMO_EPI_EMPRESA_LOGO_URL
TERMO_EPI_EMPRESA_LOGO_SECUNDARIO_URL
MATERIAIS_VIEW
RELATORIO_SEMANAL_BUCKET
RELATORIO_SEMANAL_TIMEZONE
RELATORIO_TROCA_EPI_TIMEZONE
```

Padroes:

- `RELATORIO_SEMANAL_BUCKET`: `imports`;
- `RELATORIO_SEMANAL_TIMEZONE`: `America/Sao_Paulo`;
- `RELATORIO_TROCA_EPI_TIMEZONE`: `America/Sao_Paulo`;
- `MATERIAIS_VIEW`: `materiais_view`.

---

### Destinatarios

As functions buscam owners ativos:

```text
app_users
parent_user_id is null
ativo != false
```

Depois, para cada owner, buscam usuarios administradores daquele owner.

#### Mensal de estoque

Aceita credenciais:

- `admin`;
- `master`.

Tambem aceita credenciais gravadas como UUID quando `app_credentials_catalog.id_text` e `admin` ou `master`.

Escopo:

```text
id = ownerId OR parent_user_id = ownerId
```

Somente usuarios com email entram como destinatarios.

#### Semanal de movimentacao

Mesmo criterio do mensal:

- `admin`;
- `master`;
- texto ou UUID via `app_credentials_catalog`.

#### Troca de EPI

Aceita apenas credencial:

- `admin`.

Tambem aceita UUID quando `app_credentials_catalog.id_text` e `admin`.

Nao inclui `master` nesse fluxo pelo codigo atual.

---

### Envio via Brevo

Todos os emails usam:

```text
POST https://api.brevo.com/v3/smtp/email
```

Header:

```text
api-key: BREVO_API_KEY
Content-Type: application/json
```

Payload base:

```json
{
  "sender": { "name": "...", "email": "..." },
  "to": [{ "name": "...", "email": "..." }],
  "subject": "...",
  "textContent": "...",
  "htmlContent": "..."
}
```

Quando existe `RELATORIO_ESTOQUE_EMAIL_REPLY_TO`, tambem envia:

```json
{
  "replyTo": { "name": "...", "email": "..." }
}
```

No semanal de movimentacao, tambem envia:

```json
{
  "attachment": [
    { "name": "arquivo.csv", "content": "base64..." }
  ]
}
```

---

## 3.1 Relatorio mensal de estoque

### Geracao mensal

Function:

```text
supabase/functions/relatorio-estoque-mensal
```

Core:

```text
supabase/functions/relatorio-estoque-mensal/_shared/relatorioEstoqueCore.ts
```

Essa function:

- percorre owners ativos;
- identifica meses ainda nao registrados;
- carrega movimentacoes do owner;
- monta estoque atual e dashboard;
- calcula resumo do relatorio;
- ignora periodos sem movimentacao;
- grava registro em `inventory_report`;
- define `metadados.tipo = mensal`;
- grava `email_status = pendente`.

No backend Vercel tambem existe geracao manual:

```text
api/_shared/operations.js
EstoqueOperations.report()
```

Ela recebe periodo, calcula contexto e grava `inventory_report`.

---

### Envio mensal

Function:

```text
supabase/functions/relatorio-estoque-mensal-email
```

Core:

```text
supabase/functions/relatorio-estoque-mensal-email/_shared/relatorioEstoqueEmailCore.ts
```

Fluxo:

1. Valida ambiente.
2. Carrega owners ativos.
3. Opcionalmente restringe por `test_owner_id`.
4. Para cada owner, busca o ultimo `inventory_report` com `metadados->>tipo = mensal`.
5. Pula se o ultimo relatorio ja estiver com status diferente de `pendente`/`erro`.
6. Busca destinatarios admin/master do owner.
7. Valida se o relatorio tem `metadados.contexto`.
8. Renderiza HTML pelo template:

```text
supabase/functions/relatorio-estoque-mensal-email/_shared/relatorioEstoqueTemplate.ts
```

9. Envia pelo Brevo.
10. Atualiza `email_status`, `email_enviado_em`, `email_erro` e `email_tentativas`.

Assunto:

```text
Relatorio mensal de estoque - MM/AAAA
```

Conteudo:

- HTML completo do relatorio;
- texto simples com periodo;
- sem anexo CSV.

---

## 3.2 Relatorio semanal de movimentacao

### Geracao semanal

Function:

```text
supabase/functions/relatorio-estoque-semanal
```

Core:

```text
supabase/functions/relatorio-estoque-semanal/_shared/relatorioEstoqueSemanalCore.ts
```

Essa function:

- percorre owners ativos;
- calcula periodo semanal usando timezone configurado;
- coleta entradas, saidas, acidentes, HHT e estoque;
- ignora registros cancelados quando aplicavel;
- monta arquivos CSV;
- faz upload dos arquivos no bucket configurado;
- grava `inventory_report` com `metadados.tipo = semanal`;
- grava no JSON `metadados.arquivos` a lista de anexos;
- define `arquivos_total`;
- define `email_status = pendente`.

Bucket padrao:

```text
imports
```

Caminho documentado:

```text
<owner_id>/relatorios-semanais/<periodo>/
```

Arquivos gerados:

```text
entradas-<periodo>.csv
saidas-<periodo>.csv
acidentes-<periodo>.csv
hht-<periodo>.csv
estoque-atual-<periodo>.csv
```

Observacao:

- entradas, saidas, acidentes e HHT recebem BOM UTF-8 no upload;
- `estoque-atual` e enviado sem BOM no trecho atual do core semanal.

---

### Envio semanal

Function:

```text
supabase/functions/relatorio-estoque-semanal-email
```

Core:

```text
supabase/functions/relatorio-estoque-semanal-email/_shared/relatorioEstoqueSemanalEmailCore.ts
```

Fluxo:

1. Valida ambiente.
2. Carrega owners ativos.
3. Opcionalmente restringe por `test_owner_id`.
4. Busca o ultimo `inventory_report` com `metadados->>tipo = semanal`.
5. Pula se ja estiver enviado.
6. Busca destinatarios admin/master.
7. Le `metadados.arquivos`.
8. Baixa cada arquivo do Storage.
9. Converte cada arquivo para Base64.
10. Soma o tamanho total dos anexos.
11. Bloqueia se passar de 20 MB.
12. Bloqueia se destinatarios passarem de 99.
13. Envia email com HTML simples e CSVs anexados.
14. Atualiza status/tentativas.

Assunto:

```text
Relatorio semanal de movimentacao - <periodo>
```

Limites:

- anexos totais: 20 MB;
- destinatarios com anexo: 99.

---

## 3.3 Relatorio de troca de EPI

### Geracao do relatorio

Function:

```text
supabase/functions/relatorio-troca-epi
```

Core:

```text
supabase/functions/relatorio-troca-epi/_shared/relatorioTrocaEpiCore.ts
```

Essa function:

- calcula uma janela semanal a partir da data atual no timezone configurado;
- busca saidas com `dataTroca` no intervalo;
- remove saidas canceladas;
- carrega nomes de pessoas, materiais, usuarios e centros;
- monta itens de alerta;
- grava `inventory_report` com `metadados.tipo = troca-epi-alertas`;
- grava `metadados.itens` com as linhas do relatorio;
- define `email_status = pendente`.

Tipo gravado:

```text
troca-epi-alertas
```

---

### Envio do email de troca de EPI

Function:

```text
supabase/functions/relatorio-troca-epi-email
```

Core:

```text
supabase/functions/relatorio-troca-epi-email/_shared/relatorioTrocaEpiEmailCore.ts
```

Fluxo:

1. Valida ambiente.
2. Carrega owners ativos.
3. Opcionalmente restringe por `test_owner_id`.
4. Busca o ultimo `inventory_report` com `metadados->>tipo = troca-epi-alertas`.
5. Pula se ja estiver enviado.
6. Busca destinatarios admin do owner.
7. Le `metadados.itens`.
8. Se nao houver itens, marca erro.
9. Monta HTML com tabela de pessoas, matriculas, materiais, quantidades, centros, entrega e troca.
10. Envia pelo Brevo.
11. Atualiza status/tentativas.

Assunto:

```text
Relatorio troca de EPI - DD/MM/AAAA a DD/MM/AAAA
```

Nao envia anexos.

---

## Parametros de teste

As functions de email aceitam parametros de teste por:

- body JSON;
- query string;
- headers.

Nomes aceitos:

```text
test_email
testEmail
x-test-email
test_owner_id
owner_id
testOwnerId
ownerId
x-test-owner-id
```

Exemplo de body:

```json
{
  "test_email": "usuario@dominio.com",
  "test_owner_id": "uuid-do-owner"
}
```

Comportamento:

- `test_email` direciona o envio para esse email;
- `test_owner_id` limita o owner usado;
- se `test_email` for informado sem `test_owner_id`, o codigo envia teste para apenas 1 owner e retorna warning;
- modo teste nao atualiza `email_status` no banco.

---

## Logs de cron

As Edge Functions de cron registram execucao em:

```text
edge_functions_error_report
```

Campos preenchidos incluem:

- `function_name`;
- `bucket = cron`;
- `duration_ms`;
- `http_status`;
- `errors_count`;
- `error_message`;
- `error_stack`;
- `sb_request_id`;
- `details`.

O log e gravado somente quando a chamada foi autorizada como cron.

---

## Como validar

### Validar lista de Pessoas

1. Entrar na tela Pessoas.
2. Conferir que `Registros de Pessoas` carrega dados do tenant atual.
3. Aplicar filtro por texto, centro, setor, cargo, tipo, status e data.
4. Confirmar que a tabela muda sem navegar de pagina.
5. Confirmar que a paginacao mostra 20 registros por pagina.
6. Clicar em `Atualizar` e confirmar recarga.
7. Abrir detalhes, historico e edicao em uma linha.

### Validar CSV de Pessoas

1. Aplicar um filtro na lista.
2. Clicar em `Exportar Excel (CSV)`.
3. Confirmar download de `pessoas-AAAA-MM-DD.csv`.
4. Abrir o arquivo e conferir as colunas.
5. Confirmar que o CSV trouxe todos os registros filtrados, nao apenas a pagina visivel.

### Validar relatorio mensal por email

Verificar no banco:

```sql
select
  id,
  account_owner_id,
  periodo_inicio,
  periodo_fim,
  metadados->>'tipo' as tipo,
  email_status,
  email_enviado_em,
  email_erro,
  email_tentativas
from public.inventory_report
where metadados->>'tipo' = 'mensal'
order by periodo_inicio desc, created_at desc;
```

Validar:

- existe relatorio mensal;
- `metadados.contexto` esta preenchido;
- owner possui admin/master com email;
- envs de Brevo/remetente existem;
- function `relatorio-estoque-mensal-email` foi executada com `CRON_SECRET`.

### Validar relatorio semanal por email

Verificar no banco:

```sql
select
  id,
  account_owner_id,
  periodo_inicio,
  periodo_fim,
  metadados->>'tipo' as tipo,
  arquivos_total,
  metadados->'arquivos' as arquivos,
  email_status,
  email_enviado_em,
  email_erro,
  email_tentativas
from public.inventory_report
where metadados->>'tipo' = 'semanal'
order by periodo_inicio desc, created_at desc;
```

Validar:

- `arquivos_total` maior que zero;
- `metadados.arquivos` contem paths validos no bucket;
- anexos existem no Storage;
- tamanho total nao passa de 20 MB;
- destinatarios nao passam de 99;
- function `relatorio-estoque-semanal-email` foi executada com `CRON_SECRET`.

### Validar troca de EPI por email

Verificar no banco:

```sql
select
  id,
  account_owner_id,
  periodo_inicio,
  periodo_fim,
  metadados->>'tipo' as tipo,
  metadados->>'total' as total,
  email_status,
  email_enviado_em,
  email_erro,
  email_tentativas
from public.inventory_report
where metadados->>'tipo' = 'troca-epi-alertas'
order by periodo_inicio desc, created_at desc;
```

Validar:

- `metadados.total` maior que zero;
- `metadados.itens` contem registros;
- owner possui admin com email;
- function `relatorio-troca-epi-email` foi executada com `CRON_SECRET`.

---

## Troubleshooting

### CSV abriu com caracteres quebrados no Excel

Causa provavel:

- exportacao sem BOM UTF-8.

Afeta com maior chance:

- Pessoas;
- Materiais;
- Estoque Atual.

Mitigacao:

- importar pelo Excel escolhendo UTF-8;
- ou corrigir o util da tela para adicionar BOM.

### CSV abriu tudo em uma coluna

Causa provavel:

- Excel nao reconheceu `;` como separador.

Mitigacao:

- importar manualmente escolhendo `;`;
- ou adicionar linha `sep=;` no builder da tela.

### Exportacao nao reflete o que esta na pagina atual

Comportamento esperado:

- a exportacao usa a lista completa filtrada;
- a paginacao visual nao limita o CSV.

### Email nao enviou e ficou como erro

Verificar:

- `BREVO_API_KEY`;
- `RELATORIO_ESTOQUE_EMAIL_FROM`;
- destinatarios admin/master com email;
- erro salvo em `inventory_report.email_erro`;
- log em `edge_functions_error_report`.

### Function retorna Unauthorized

Causa:

- `CRON_SECRET` ausente ou incorreto na chamada.

Validar:

- header `x-cron-secret`;
- ou `Authorization: Bearer <CRON_SECRET>`.

### Sem destinatarios para envio

Causa:

- nao existe usuario admin/master com email no owner;
- ou, no relatorio de troca de EPI, nao existe usuario admin com email;
- ou credencial esta fora dos valores mapeados.

### Relatorio semanal sem anexos

Causa:

- `metadados.arquivos` vazio;
- arquivos nao foram gravados no Storage;
- bucket/caminho divergente;
- `RELATORIO_SEMANAL_BUCKET` configurado diferente do bucket usado na geracao.

### Relatorio mensal sem contexto

Causa:

- `metadados.contexto` ausente no `inventory_report`.

Efeito:

- function mensal marca erro `Contexto do relatorio nao encontrado.`

---

## Mapa rapido de codigo

### Pessoas

```text
src/pages/Pessoas.jsx
src/context/PessoasContext.jsx
src/hooks/usePessoasController.js
src/components/Pessoas/PessoasTable.jsx
src/components/Pessoas/PessoasFilters.jsx
src/components/Pessoas/PessoasActions.jsx
src/routes/rules/PessoasRules.js
src/utils/pessoasUtils.js
src/services/pessoasService.js
src/services/api.js
```

### CSV

```text
src/utils/pessoasUtils.js
src/utils/acidentesExport.js
src/utils/asoExport.js
src/utils/entradasExport.js
src/utils/saidasExport.js
src/utils/MateriaisUtils.js
src/utils/estoqueUtils.js
```

### Relatorios e email

```text
api/_shared/operations.js
src/services/relatorioEstoqueApi.js
supabase/functions/relatorio-estoque-mensal
supabase/functions/relatorio-estoque-mensal-email
supabase/functions/relatorio-estoque-semanal
supabase/functions/relatorio-estoque-semanal-email
supabase/functions/relatorio-troca-epi
supabase/functions/relatorio-troca-epi-email
```

---

## Observacoes finais

- A documentacao acima descreve o estado atual.
- Para padronizar CSV, a melhoria mais direta e criar um util unico de CSV com BOM, `sep=;`, sanitizacao e download compartilhados.
- Para email, a validacao principal em producao deve olhar `inventory_report` e `edge_functions_error_report`, pois esses dois pontos mostram status por tenant e falhas de execucao.
