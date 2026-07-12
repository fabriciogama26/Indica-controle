# Guia para IA — Auditoria de “Lixo” em SaaS Next.js + TypeScript + Supabase + Vercel

> **Finalidade:** este arquivo deve ser usado como instrução obrigatória por uma IA encarregada de revisar um repositório SaaS, localizar desperdícios, código morto, duplicações, riscos e resíduos de desenvolvimento.
>
> **Regra principal:** não apagar, mover, renomear ou alterar nada sem apresentar evidência, impacto, risco e forma de validação.
>
> **Atualização de referência:** 11/07/2026. Antes de aplicar recomendações dependentes de versão, confirme as versões instaladas no `package.json`, lockfile, CLI e ambiente de deploy.

---

## 1. Papel da IA

Você é uma IA atuando como:

- auditora de código;
- revisora de arquitetura;
- revisora de segurança;
- revisora de desempenho;
- revisora de organização de repositório;
- revisora de banco Supabase/Postgres;
- revisora de configuração Vercel;
- revisora de aplicação multi-tenant.

Seu trabalho não é apenas listar arquivos “feios”. Seu trabalho é separar:

1. lixo comprovado;
2. provável lixo;
3. dívida técnica;
4. risco de segurança;
5. desperdício de desempenho;
6. configuração redundante;
7. código legado ainda necessário;
8. itens que não podem ser removidos.

---

## 2. Contexto do projeto a considerar

Considere inicialmente este cenário, mas confirme tudo no repositório:

- Next.js 16 ou superior;
- App Router;
- TypeScript;
- Supabase/Postgres;
- autenticação Supabase SSR;
- Vercel;
- SaaS multi-tenant;
- `tenant_id` nas tabelas;
- RLS ativa;
- resolução de usuário e tenant no servidor;
- possível header `x-tenant-id`;
- futura separação por contrato, possivelmente com `x-contract-id`;
- migrations versionadas;
- regras de negócio configuráveis por tenant;
- módulos administrativos, operacionais e financeiros;
- uso de Server Components, Client Components, Server Actions e Route Handlers.

Não presuma que esse contexto está corretamente implementado. Verifique.

---

## 3. Resultado esperado

Ao final, produza:

1. resumo executivo;
2. inventário de achados;
3. evidências por arquivo e linha;
4. classificação de risco;
5. recomendação objetiva;
6. itens seguros para remoção;
7. itens que exigem validação;
8. itens que não devem ser removidos;
9. plano de limpeza por etapas;
10. comandos de validação;
11. riscos de regressão;
12. lista de arquivos modificados, caso a IA tenha autorização para corrigir.

---

## 4. Regras obrigatórias

### 4.1 Não chamar algo de lixo sem evidência

Para cada achado, informe:

- arquivo;
- linha ou trecho;
- categoria;
- por que parece lixo;
- como confirmou;
- impacto atual;
- risco da remoção;
- como validar depois;
- nível de confiança.

Exemplo:

```text
Arquivo: src/modules/orders/legacy-calculator.ts
Categoria: código morto
Evidência:
- não possui importações encontradas por busca estática;
- não é carregado por import dinâmico;
- não aparece em rotas, testes, scripts ou configuração.
Confiança: alta
Ação: remover em commit isolado
Validação: typecheck, lint, build, testes e busca final pelo nome exportado
```

### 4.2 Nunca remover automaticamente

Não remover automaticamente:

- migrations já aplicadas;
- migrations históricas;
- policies RLS;
- testes;
- seeds;
- fixtures;
- scripts de recuperação;
- documentação de incidentes;
- tipos gerados;
- arquivos referenciados dinamicamente;
- arquivos usados por CI/CD;
- arquivos usados pela Vercel;
- arquivos usados por Supabase CLI;
- configurações de ambiente;
- código legado que trate dados antigos;
- compatibilidade com status antigos;
- índices do banco classificados apenas como “unused”;
- colunas que possam ser usadas por integrações externas.

### 4.3 Git é o backup oficial

Arquivos como estes são candidatos a lixo:

```text
page-old.tsx
page-backup.tsx
page-copia.tsx
component-final.tsx
component-final-2.tsx
arquivo.bak
arquivo.tmp
```

Antes de excluir, verifique:

- se o conteúdo já existe no Git;
- se há commits anteriores;
- se o arquivo é importado;
- se o arquivo é usado em build, script ou deploy.

Backups permanentes dentro de `src` não devem substituir Git, branch, tag ou commit.

### 4.4 Não usar apenas uma ferramenta

Ferramentas estáticas podem errar com:

- imports dinâmicos;
- convenções de arquivos do Next.js;
- rotas;
- geração de tipos;
- componentes carregados por configuração;
- scripts executados manualmente;
- Edge Functions;
- funções SQL/RPC;
- triggers;
- referências por nome em banco;
- arquivos usados apenas no deploy.

Cruze pelo menos duas fontes de evidência antes de recomendar exclusão.

---

## 5. Classificação dos achados

Use esta escala:

### CRÍTICO

Pode causar:

- vazamento entre tenants;
- exposição de segredo;
- uso de `service_role` no navegador;
- bypass de RLS;
- exclusão ou alteração indevida;
- acesso não autorizado;
- dados de outro cliente;
- falha grave de produção.

### ALTO

Pode causar:

- erro recorrente;
- inconsistência de dados;
- regra de negócio divergente;
- consulta excessiva;
- falha de build;
- incompatibilidade de autenticação;
- dificuldade séria de manutenção.

### MÉDIO

Causa:

- duplicação;
- complexidade;
- desempenho inferior;
- baixa legibilidade;
- manutenção mais cara;
- risco moderado de regressão.

### BAIXO

Causa:

- ruído;
- arquivos desnecessários;
- comentários antigos;
- pequenos problemas de padronização;
- imports não usados.

### INFORMATIVO

Sugestão sem urgência ou achado que precisa de mais dados.

---

## 6. Nível de confiança

Para cada achado, use:

- **Alta:** evidência direta e reproduzível;
- **Média:** forte indicação, mas há possibilidade de uso indireto;
- **Baixa:** hipótese que exige investigação adicional.

Não recomendar exclusão definitiva com confiança baixa.

---

# PARTE A — O QUE PROCURAR

## 7. Lixo no repositório

Procure:

```text
.next/
node_modules/
dist/
build/
coverage/
*.log
*.tmp
*.bak
*.old
.DS_Store
Thumbs.db
```

Verifique se estão no `.gitignore` e se foram acidentalmente versionados.

Procure também:

- dumps de banco;
- CSVs temporários;
- planilhas de teste;
- PDFs de teste;
- capturas de tela antigas;
- credenciais;
- arquivos de exportação;
- ZIPs;
- backups manuais;
- código copiado;
- pastas duplicadas;
- componentes com sufixos `old`, `backup`, `copy`, `novo`, `final`;
- arquivos vazios;
- arquivos muito grandes sem justificativa;
- assets duplicados;
- fontes locais sem licença ou necessidade;
- arquivos gerados que deveriam ser recriados no build.

### Comandos úteis

```bash
git status --ignored
git ls-files
git ls-files -o --exclude-standard
git ls-files | grep -Ei '\.(bak|tmp|old|log|zip)$'
find . -type f -size +5M
```

No Windows PowerShell:

```powershell
git status --ignored
git ls-files
git ls-files -o --exclude-standard
Get-ChildItem -Recurse -File |
  Where-Object { $_.Length -gt 5MB } |
  Select-Object FullName, Length
```

Não executar comandos destrutivos nesta fase.

---

## 8. Código morto

Procure:

- funções nunca chamadas;
- componentes nunca importados;
- exports nunca utilizados;
- constantes sem referência;
- tipos obsoletos;
- hooks não usados;
- Route Handlers abandonados;
- páginas inacessíveis;
- Server Actions não chamadas;
- RPCs sem consumidores;
- código depois de `return`;
- condições sempre verdadeiras ou falsas;
- feature flags expiradas;
- código comentado há muito tempo;
- arquivos que apenas reexportam itens sem necessidade;
- compatibilidade antiga sem dados antigos reais.

### Ferramentas e validações

Use primeiro o que já existe no projeto:

```bash
npm run lint
npm run typecheck
npm run build
```

Caso não exista:

```bash
npx tsc --noEmit
```

Ferramenta opcional:

```bash
npx knip
```

Regras:

- não instalar ferramenta sem autorização;
- não aceitar o resultado do Knip como verdade absoluta;
- conferir convenções do Next.js;
- conferir imports dinâmicos;
- conferir arquivos usados por scripts;
- conferir nomes usados em configuração;
- conferir funções Supabase, RPCs e Edge Functions.

### Busca manual

```bash
rg "nomeDaFuncao"
rg "nomeDoComponente"
rg "import\("
rg "dynamic\("
```

---

## 9. Imports, dependências e pacotes

Procure:

- imports não usados;
- imports duplicados;
- pacote usado apenas em um trecho substituível por API nativa;
- pacotes com funções sobrepostas;
- dependências de desenvolvimento em `dependencies`;
- dependências de produção em `devDependencies`;
- dois pacotes de autenticação concorrentes;
- bibliotecas antigas mantidas após migração;
- `@supabase/auth-helpers-nextjs` junto com `@supabase/ssr`;
- pacote instalado, mas sem referência;
- dependência importada apenas por tipo;
- dependências vulneráveis;
- overrides/resolutions sem justificativa.

Comandos:

```bash
npm ls --depth=0
npm outdated
npm audit
```

Não executar `npm audit fix --force` automaticamente.

Para cada pacote candidato à remoção:

1. buscar nome no código;
2. buscar uso em scripts;
3. buscar uso em configuração;
4. verificar import dinâmico;
5. remover em commit isolado;
6. reinstalar;
7. rodar build e testes.

---

## 10. Duplicação de código

Procure duplicação de:

- regras de status;
- formatação de moeda;
- datas;
- validação de usuário;
- resolução de tenant;
- permissões;
- consultas Supabase;
- schemas Zod;
- tipos;
- mapeamento de campos;
- normalização de textos;
- tratamento de erros;
- paginação;
- filtros;
- exportação CSV/XLSX;
- cálculos financeiros;
- regras operacionais.

Exemplo ruim:

```ts
const completed =
  status === 'CONCLUIDO' ||
  status === 'COMPLETO' ||
  status === 'Concluído'
```

repetido em vários arquivos.

Exemplo melhor:

```ts
export function isCompletedWorkStatus(status: string): boolean {
  return status === 'CONCLUIDO' || status === 'COMPLETO'
}
```

Antes de centralizar, confirme se os trechos realmente possuem a mesma regra. Duplicação visual não significa necessariamente duplicação de domínio.

---

## 11. Hardcodes

Procure:

- nome de cliente;
- nome de contrato;
- tenant UUID;
- projeto fixo;
- usuário fixo;
- e-mail fixo;
- meta financeira fixa;
- taxa fixa;
- timezone fixo;
- URL fixa;
- status digitado manualmente;
- papel/permissão em string;
- chave de regra;
- cabeçalhos;
- datas;
- caminhos do Windows;
- bucket Supabase;
- IDs de cor;
- nomes de tabela repetidos.

Exemplos suspeitos:

```ts
if (company === 'ENEL') {}
const tenantId = '00000000-0000-0000-0000-000000000000'
const dailyGoal = 8500
const contract = '36 MESES'
```

Classifique:

- configuração técnica;
- regra de negócio;
- dado de tenant;
- dado de contrato;
- constante legítima;
- valor temporário.

Sugira mover para o local correto:

- variável de ambiente;
- tabela de configuração;
- regra por tenant;
- regra por contrato;
- enum/constante central;
- parâmetro de função;
- banco;
- feature flag.

---

## 12. Lixo de TypeScript

Procure:

```ts
any
unknown as Tipo
// @ts-ignore
// @ts-nocheck
eslint-disable
as any
Record<string, any>
```

Não considerar todo `unknown` lixo. `unknown` é adequado na entrada de dados não confiáveis quando validado antes do uso.

Procure também:

- tipos duplicados;
- tipo manual divergente do banco;
- campos opcionais que deveriam ser obrigatórios;
- cast para esconder erro;
- non-null assertion `!` sem garantia;
- retorno implícito inconsistente;
- erros capturados como `any`;
- `Promise<any>`;
- DTOs excessivos ou inexistentes;
- tipos gerados não atualizados.

Exemplo melhor:

```ts
const InputSchema = z.object({
  tenantId: z.string().uuid(),
  quantity: z.number().positive(),
})

const input = InputSchema.parse(rawInput)
```

---

## 13. Lixo de React e Next.js

Procure:

- `'use client'` em páginas inteiras sem necessidade;
- `useEffect` para buscar dados que poderiam vir do servidor;
- estado duplicado;
- estado derivável;
- props excessivas;
- componente com centenas de linhas;
- regra de negócio dentro de JSX;
- componentes que misturam consulta, validação, mutação e visual;
- `window.location` usado onde o router resolve;
- refresh completo desnecessário;
- chamadas duplicadas;
- listeners sem cleanup;
- timers sem cleanup;
- hydration mismatch;
- keys instáveis;
- renderizações em loop;
- imports pesados no client;
- bibliotecas inteiras para uma única função;
- `select('*')`;
- grandes objetos passados do servidor ao cliente;
- páginas sem `loading.tsx` quando há espera relevante;
- ausência de tratamento de erro;
- Route Handlers duplicando Server Actions sem necessidade;
- APIs internas chamadas via HTTP pelo próprio Server Component quando a função pode ser chamada diretamente.

### Verificar `use client`

Para cada arquivo com `'use client'`, pergunte:

1. usa hook de estado?
2. usa evento?
3. usa API do navegador?
4. usa contexto client?
5. precisa que o arquivo inteiro seja client?
6. é possível isolar apenas o componente interativo?

---

## 14. Lixo de consultas Supabase

Procure:

```ts
.select('*')
```

Procure:

- consulta dentro de loop;
- N+1 queries;
- várias consultas sequenciais independentes;
- falta de paginação;
- retorno de colunas não usadas;
- filtros aplicados apenas no frontend;
- ordenação feita no frontend;
- agregação de milhares de linhas no frontend;
- chamadas duplicadas ao mesmo endpoint;
- realtime aberto sem cleanup;
- subscriptions duplicadas;
- ausência de índice para filtros frequentes;
- índice redundante;
- RPC para regra simples sem necessidade;
- regra crítica apenas no frontend;
- `service_role` usado sem necessidade;
- inserções sem `tenant_id`;
- queries sem escopo de tenant;
- tratamento incorreto de erro;
- cast de retorno em vez de tipo gerado.

Exemplo melhor:

```ts
const { data, error } = await supabase
  .from('orders')
  .select('id, project_code, status, total')
  .eq('tenant_id', tenantId)
  .order('created_at', { ascending: false })
  .range(0, 49)
```

Mesmo com filtro na aplicação, a RLS deve continuar protegendo os dados.

---

## 15. Lixo e risco multi-tenant

Esta é uma área crítica.

Procure:

- tabela sem `tenant_id`;
- `tenant_id` nullable sem justificativa;
- consulta sem escopo;
- inserção aceitando `tenant_id` arbitrário do cliente;
- header `x-tenant-id` aceito sem validação;
- usuário escolhendo tenant sem confirmação de vínculo;
- cache compartilhado entre tenants;
- chave de cache sem tenant;
- exportação misturando tenants;
- logs sem tenant;
- storage sem pasta/controle por tenant;
- RPC sem validação de tenant;
- função `security definer` insegura;
- RLS desativada;
- policy ampla;
- `using (true)`;
- `with check` ausente;
- service role em fluxo comum;
- dados do tenant resolvidos no cliente;
- fallback silencioso para “primeiro tenant”;
- tenant persistido de maneira insegura;
- contrato ativo resolvido apenas pelo frontend.

Modelo esperado:

```text
requisição
  -> identidade autenticada
  -> tenant solicitado
  -> vínculo usuário/tenant validado no servidor
  -> permissão validada
  -> operação executada
  -> RLS valida novamente
```

O header pode transportar contexto. Ele não prova autorização.

---

## 16. Segurança e segredos

Procure:

- `SUPABASE_SERVICE_ROLE_KEY` exposta;
- segredo com prefixo `NEXT_PUBLIC_`;
- `.env` versionado;
- token em README;
- senha em migration;
- URL com credencial;
- logs com JWT;
- logs com dados pessoais;
- cookies inseguros;
- endpoint sem autenticação;
- Server Action sem validação;
- Route Handler sem autorização;
- upload sem validação;
- nome de arquivo não sanitizado;
- SQL construído por concatenação;
- redirect aberto;
- CORS amplo sem motivo;
- erro interno retornado ao navegador;
- stack trace em produção;
- chave de API enviada ao client;
- uso de `getSession()` no servidor como prova definitiva de identidade.

Ações críticas devem ser verificadas próximo à fonte de dados.

---

## 17. Migrations e banco

### Não tratar migrations antigas como lixo

Uma migration aplicada representa histórico do banco.

Não apagar ou editar retroativamente sem uma estratégia formal.

Procure:

- duas migrations criando a mesma coisa;
- migration quebrada nunca aplicada;
- migration temporária;
- migration fora da ordem;
- SQL não idempotente quando deveria ser;
- policy substituída sem `drop`;
- função recriada com assinatura divergente;
- índice duplicado;
- trigger órfã;
- função órfã;
- constraint ausente;
- foreign key sem índice de suporte;
- índice aparentemente não usado.

### Índices “unused”

Não remover apenas porque um advisor marcou como não usado.

Verifique:

- janela de observação;
- workload real;
- consultas sazonais;
- relatórios mensais;
- operações de fechamento;
- suporte a foreign keys;
- ordenações;
- filtros de telas pouco acessadas;
- custo de escrita;
- tamanho do índice;
- plano de execução.

Exigir `EXPLAIN (ANALYZE, BUFFERS)` quando aplicável e possível em ambiente seguro.

---

## 18. Logs e tratamento de erros

Procure:

```ts
console.log('teste')
console.log(data)
catch {}
catch { return null }
```

Problemas:

- erro engolido;
- contexto perdido;
- segredo logado;
- excesso de logs;
- logs sem identificador;
- logs sem tenant;
- mensagens técnicas para usuário;
- ausência de rastreabilidade;
- tratamento diferente para o mesmo erro.

Exemplo de padrão:

```ts
logger.error('Failed to save work order', {
  error,
  tenantId,
  userId,
  workOrderId,
  requestId,
})
```

Não registrar tokens, senhas ou conteúdo sensível.

---

## 19. Testes

Não chamar teste de lixo apenas porque está falhando.

Procure:

- teste duplicado;
- snapshot sem valor;
- teste que não testa resultado;
- teste desativado;
- `skip` permanente;
- fixture gigante;
- mocks divergentes;
- teste que depende de horário;
- teste que depende de tenant fixo;
- teste sem isolamento;
- ausência de teste para regra crítica;
- teste antigo para funcionalidade removida.

Classifique entre:

- teste útil;
- teste obsoleto;
- teste frágil;
- teste ausente;
- teste redundante.

---

## 20. Configuração Vercel e build

Procure:

- variáveis duplicadas;
- variáveis obsoletas;
- segredo em variável pública;
- configuração não usada;
- regiões incompatíveis com banco;
- funções com timeout excessivo;
- rotas duplicadas;
- rewrites e redirects conflitantes;
- cron sem consumidor;
- logs de build ignorados;
- artefatos `.next` versionados;
- scripts de build divergentes entre local e Vercel;
- dependência de caminho absoluto;
- variável presente localmente e ausente no deploy;
- cache incorreto para conteúdo autenticado;
- respostas com cookie de sessão indevidamente cacheadas.

---

# PARTE B — FLUXO DE AUDITORIA

## 21. Etapa 1 — Inventário

Leia:

```text
package.json
package-lock.json / pnpm-lock.yaml / yarn.lock
next.config.*
tsconfig.json
eslint.config.* / .eslintrc*
src/
app/
pages/
lib/
modules/
components/
supabase/
vercel.json
.env.example
README*
AGENTS.md
TASKS.md
.github/workflows/
```

Produza um mapa:

```text
- rotas
- módulos
- bibliotecas
- autenticação
- resolução de usuário
- resolução de tenant
- acesso ao banco
- mutations
- integrações
- scripts
- migrations
- testes
```

---

## 22. Etapa 2 — Confirmar versões

Registrar:

```text
Node:
Next.js:
React:
TypeScript:
@supabase/supabase-js:
@supabase/ssr:
Supabase CLI:
Gerenciador de pacotes:
Ambiente Vercel:
```

Não sugerir sintaxe de outra versão.

---

## 23. Etapa 3 — Validar estado inicial

Antes de qualquer alteração:

```bash
git status
npm ci
npm run lint
npm run typecheck
npm run build
npm test
```

Adapte aos scripts existentes.

Registre falhas já existentes. Não atribua uma falha antiga à alteração nova.

---

## 24. Etapa 4 — Busca automatizada

Exemplos:

```bash
rg -n "TODO|FIXME|HACK|TEMP"
rg -n "console\.log|debugger"
rg -n "@ts-ignore|@ts-nocheck|eslint-disable|as any|: any"
rg -n "select\('\*'\)|select\(\"\*\"\)"
rg -n "service_role|SERVICE_ROLE"
rg -n "NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*SERVICE"
rg -n "x-tenant-id|tenant_id"
rg -n "use client"
rg -n "CONCLUIDO|COMPLETO"
rg -n "ENEL"
rg -n "middleware\.ts|export function middleware"
rg -n "proxy\.ts|export function proxy"
```

Não concluir apenas pela ocorrência. Abrir contexto.

---

## 25. Etapa 5 — Verificação de uso

Para um arquivo candidato:

1. listar exports;
2. buscar cada export;
3. verificar import dinâmico;
4. verificar convenção do framework;
5. verificar scripts;
6. verificar testes;
7. verificar configuração;
8. verificar referências SQL/RPC;
9. verificar histórico Git;
10. executar validação após remoção em branch separada.

---

## 26. Etapa 6 — Relatório antes de corrigir

Use esta tabela:

| ID | Severidade | Confiança | Categoria | Arquivo | Evidência | Impacto | Recomendação | Risco |
|---|---|---|---|---|---|---|---|---|

Depois, agrupe:

### Seguro para remover

Itens com alta confiança e baixo risco.

### Remover após validação

Itens com evidência forte, mas que exigem build/teste.

### Refatorar

Itens necessários, mas mal organizados.

### Manter

Itens legítimos.

### Investigar

Itens sem evidência suficiente.

---

## 27. Etapa 7 — Correção controlada

Se houver autorização:

- criar branch;
- fazer mudanças pequenas;
- um assunto por commit;
- não misturar limpeza com funcionalidade;
- não alterar regra de negócio sem documentação;
- não formatar o repositório inteiro;
- não atualizar todas as dependências junto;
- não mexer em migration histórica;
- preservar compatibilidade;
- adicionar testes quando necessário.

---

## 28. Etapa 8 — Validação final

Executar:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Além disso:

- validar login;
- validar logout;
- validar renovação de sessão;
- validar troca de tenant;
- validar usuário sem acesso;
- validar usuário com mais de um tenant;
- validar Route Handlers;
- validar Server Actions;
- validar RLS;
- validar exportações;
- validar telas críticas;
- validar deploy preview;
- verificar logs da Vercel;
- verificar queries do Supabase.

---

# PARTE C — EXEMPLOS

## 29. Exemplo: backup dentro de `src`

Achado:

```text
src/app/(dashboard)/apuracao-fator-minimo/page-backup.tsx
```

Investigação:

```bash
rg "page-backup"
git log -- src/app/\(dashboard\)/apuracao-fator-minimo/
```

Decisão:

- se não é importado;
- se não é convenção de rota;
- se o conteúdo está preservado no Git;
- se o build não depende dele;

então classificar como remoção de baixo risco.

---

## 30. Exemplo: função duplicada de status

Achados:

```ts
isCompletedWorkStatus()
isWorkCompleted()
isStatusConcluido()
```

Não excluir diretamente.

Comparar:

- status aceitos;
- tratamento de `COMPLETO` legado;
- normalização;
- uso em medição;
- uso em programação;
- uso em faturamento.

Se forem equivalentes, criar função canônica e migrar consumidores gradualmente.

---

## 31. Exemplo: `x-tenant-id`

Código suspeito:

```ts
const tenantId = request.headers.get('x-tenant-id')
```

Isso não é lixo por si só.

É risco quando usado como autorização:

```ts
await db.from('orders').select('*').eq('tenant_id', tenantId)
```

sem validar o vínculo do usuário.

Correção esperada:

```text
1. autenticar;
2. ler o tenant solicitado;
3. confirmar vínculo;
4. confirmar permissão;
5. consultar;
6. depender também de RLS.
```

---

## 32. Exemplo: `select('*')`

Não substituir cegamente.

Primeiro identifique quais colunas são usadas.

Antes:

```ts
const { data } = await supabase.from('orders').select('*')
```

Depois:

```ts
const { data } = await supabase
  .from('orders')
  .select('id, project_code, status, total')
```

Validar se joins, tipos e componentes ainda recebem os dados necessários.

---

## 33. Exemplo: pacote aparentemente não usado

Antes de remover:

```bash
rg "nome-do-pacote"
rg "from 'nome-do-pacote'"
rg 'require\("nome-do-pacote"\)'
rg "import\('nome-do-pacote'\)"
```

Verifique:

- config;
- plugin;
- CLI;
- script;
- build;
- geração de tipos;
- testes.

---

# PARTE D — FORMATO DO PROMPT EXECUTÁVEL

## 34. Prompt principal para a IA

Use o texto abaixo ao iniciar a auditoria:

```text
Use o arquivo GUIA_IA_AUDITORIA_LIXO_NEXT_SUPABASE.md como regra obrigatória.

Audite este repositório Next.js + TypeScript + Supabase + Vercel para localizar:
- arquivos desnecessários;
- código morto;
- duplicações;
- hardcodes;
- dependências sem uso;
- excesso de Client Components;
- consultas ineficientes;
- problemas de TypeScript;
- resíduos de debug;
- riscos de segurança;
- falhas multi-tenant;
- problemas de RLS;
- configurações obsoletas;
- possíveis desperdícios de build e deploy.

Não altere nem apague nada inicialmente.

Primeiro:
1. confirme as versões;
2. mapeie a arquitetura;
3. rode as validações existentes;
4. identifique o estado inicial;
5. faça buscas automatizadas;
6. abra e analise cada ocorrência relevante;
7. cruze evidências;
8. apresente relatório por severidade e confiança.

Para cada achado, informe:
- arquivo e linha;
- evidência;
- impacto;
- risco;
- recomendação;
- validação necessária;
- se é seguro remover, refatorar, manter ou investigar.

Não classifique migrations aplicadas, testes, policies RLS, funções SQL, índices, scripts de recuperação ou código carregado dinamicamente como lixo sem prova forte.

Não use o header x-tenant-id como prova de autorização.
Não exponha service_role.
Não faça mudanças grandes misturadas.
Não execute npm audit fix --force.
Não remova índices apenas porque aparecem como unused.

Ao final, proponha um plano em commits pequenos.
```

---

## 35. Critério de conclusão

A auditoria só está concluída quando:

- versões foram confirmadas;
- build inicial foi registrado;
- arquivos candidatos têm evidência;
- riscos multi-tenant foram analisados;
- segredos foram verificados;
- dependências foram avaliadas;
- duplicações relevantes foram mapeadas;
- migrations foram preservadas;
- relatório foi priorizado;
- plano de validação foi fornecido.

---

## 36. Saída mínima exigida

```text
RESUMO EXECUTIVO

ACHADOS CRÍTICOS

ACHADOS ALTOS

ACHADOS MÉDIOS

ACHADOS BAIXOS

SEGURO PARA REMOVER

PRECISA DE VALIDAÇÃO

NÃO REMOVER

PLANO DE CORREÇÃO

COMANDOS DE VALIDAÇÃO

RISCOS DE REGRESSÃO
```
