---
description: Audita concorrência, consistência transacional e conflitos de estado — o que acontece quando duas ações incompatíveis acontecem sobre o mesmo registro (ver prompts/auditoria-concorrencia.md)
---

Siga exatamente o procedimento definido em `prompts/auditoria-concorrencia.md` deste repositório. Leia esse arquivo completo antes de começar — ele contém o papel, o contexto, as restrições, o plano de execução em 7 etapas, a checklist obrigatória dos 7 pontos, a matriz de cenários concorrentes, a matriz de precedência, a lista de telas prioritárias e o formato de saída obrigatório (matriz de relatório).

Argumento opcional (tela/entidade específica a priorizar, ex. "medicao" ou "cronograma-solicitacoes"): $ARGUMENTS

Regra principal: para cada entidade mutável com mais de uma ação de escrita, simule duas operações concorrentes incompatíveis e prove que não existe sobrescrita silenciosa, transição inválida de estado, efeito duplicado ou perda de dados. "Existe `FOR UPDATE`" ou "existe `expectedUpdatedAt` no payload" não é evidência suficiente sozinha — confirme atomicidade real e obrigatoriedade da versão antes de classificar como protegido. Não proponha "edição sempre vence" como regra universal; prioridade entre ações é decisão de negócio por entidade, registrada na matriz de precedência do prompt.

Ao final, apresentar o texto do commit conforme `guias/guia_git.md` e perguntar **"Confirma que posso aplicar/fechar essas mudanças?"** antes de encerrar.
