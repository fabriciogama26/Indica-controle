<tipo>(<módulo>): <resumo curto>

- O que foi feito:
  - ...
  - ...

- Arquivos:
  - ...

- Mapeamento:
  - ...

- Como validar:
  - ...

- Multi-tenant:
  - ...

- Docs:
  - ...
Tipos utilizados
feat → nova funcionalidade
fix → correção de bug ou comportamento
refactor → reorganização sem alterar comportamento
docs → somente documentação
Estrutura
1. Título
fix(programacao): organizar origem nos modais de copia e reprogramacao

Formato:

tipo(modulo): descrição

Sempre em minúsculas.

2. O que foi feito

Lista objetiva.

- O que foi feito:
  - Adicionado...
  - Corrigido...
  - Removido...
3. Arquivos
- Arquivos:
  - src/...
  - docs/...

Sem explicar os arquivos.

4. Mapeamento

Sempre por módulo/tela.

Exemplo:

- Mapeamento:
  - Programação Simples:
    - ...
  - API:
    - ...
  - Banco:
    - ...
5. Como validar

Normalmente:

- Como validar:
  - npm run lint
  - npx tsc --noEmit
  - npm run build
  - testar ...
6. Multi-tenant

Sempre informa o impacto.

Quando não existe:

- Multi-tenant:
  - Sem alteração de schema/RLS.
  - Mantido tenant_id.

Quando existe:

- Multi-tenant:
  - Tenant derivado da sessão.
  - RLS preservada.
7. Docs
- Docs:
  - docs/Tela_X_SaaS.txt atualizado.
  - TASKS.md atualizado.
Convenções que você vem mantendo
Sem emojis.
Sem markdown em negrito.
Frases curtas.
Verbos no passado ("Adicionado", "Corrigido", "Removido", "Mantido").
Um único commit pode agrupar pequenas correções relacionadas do mesmo módulo.
Sempre informar impacto em multi-tenant, mesmo quando não houver impacto.
Sempre finalizar indicando a documentação atualizada.