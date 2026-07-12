---
description: Analisa o repositório e propõe melhorias de arquitetura priorizadas por evidência (segurança, Proxy/Next 16, RLS, performance) (ver prompts/melhorias-arquitetura.md)
---

Siga exatamente o procedimento definido em `prompts/melhorias-arquitetura.md` deste repositório. Leia esse arquivo completo antes de começar — ele contém o papel, o contexto, a regra de priorização (FAZER AGORA / PRÓXIMO CICLO / QUANDO HOUVER EVIDÊNCIA / NÃO COMPENSA AGORA), as restrições sobre Proxy/RLS/service role, a matriz de compensa-ou-não, e o formato de saída obrigatório.

Argumento opcional (área a priorizar, ex. "auth" ou "performance de dashboard"): $ARGUMENTS

Primeiro confirme as versões instaladas e consulte documentação oficial atual quando a recomendação depender de versão; mapeie autenticação, tenant, RLS, Server Actions, Route Handlers e consultas; rode as validações existentes. Entregue primeiro o diagnóstico e o plano por fases — não faça mudança ampla sem mostrar o diff proposto e a validação, no formato de saída exigido por `prompts/melhorias-arquitetura.md`.
