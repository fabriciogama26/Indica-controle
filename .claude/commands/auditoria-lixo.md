---
description: Audita o repositório em busca de código morto, duplicação, hardcode, riscos de segurança/multi-tenant e desperdício de build/deploy (ver prompts/auditoria-lixo.md)
---

Siga exatamente o procedimento definido em `prompts/auditoria-lixo.md` deste repositório. Leia esse arquivo completo antes de começar — ele contém o papel, o contexto, as restrições (o que nunca remover automaticamente), o plano de execução em 8 etapas, todas as categorias de achado a procurar, os critérios de aceite e o formato de saída obrigatório.

Argumento opcional (área/módulo específico a priorizar, ex. "estoque" ou "auth"): $ARGUMENTS

Regra principal: não apagar, mover, renomear ou alterar nada sem apresentar evidência, impacto, risco e forma de validação. Primeiro confirme as versões instaladas, rode as validações existentes (`npm run lint`, `npx tsc --noEmit`, `npm run build`), faça as buscas automatizadas da Etapa 4, e só então abra e analise cada ocorrência relevante antes de produzir o relatório final no formato exigido por `prompts/auditoria-lixo.md`.
