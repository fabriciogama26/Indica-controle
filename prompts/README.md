# Índice de prompts

Procedimentos invocáveis sob demanda (não são regras passivas — são ferramentas que um agente executa quando o usuário pede explicitamente). Cada um tem um comando espelho em `.claude/commands/`.

| Prompt | Comando | Quando usar |
|---|---|---|
| [`gerar-prompt.md`](gerar-prompt.md) | `/gerar-prompt` | Transformar um pedido simples do usuário numa ordem de engenharia executável e autossuficiente |
| [`auditoria-lixo.md`](auditoria-lixo.md) | `/auditoria-lixo` | Auditar o repositório em busca de código morto, duplicação, hardcode, riscos de segurança/multi-tenant e desperdício |
| [`melhorias-arquitetura.md`](melhorias-arquitetura.md) | `/melhorias-arquitetura` | Analisar o repositório e propor melhorias priorizadas (segurança, Proxy/Next 16, RLS, performance) com base em evidência |

> `auditoria-lixo.md` e `melhorias-arquitetura.md` foram reformatados a partir dos originais `GUIA_IA_AUDITORIA_LIXO_NEXT_SUPABASE.md` e `GUIA_IA_MELHORIAS_NEXT_SUPABASE_PROXY.md` (preservados em `_archive/docs/`), usando o mesmo formato de blocos de `gerar-prompt.md`.
