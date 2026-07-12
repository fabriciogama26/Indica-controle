# CRC — [Nome do Módulo]

> CRC = Componente / Responsabilidade / Colaboradores
> Este arquivo descreve o que o módulo faz, quem são seus arquivos principais e como eles se relacionam.
> Atualizar sempre que houver mudança estrutural no módulo.

---

## Visão Geral

**Tela:** `[Nome da tela no sistema]`
**Rota:** `/[caminho-na-url]`
**Page Key (permissão):** `[page-key usado em app_user_page_permissions]`
**Arquivo de documentação:** `docs/[Tela].txt`

**O que esta tela faz (em 1-3 frases):**
> Descrever o propósito operacional da tela.

---

## Arquivos do Módulo

| Arquivo | Responsabilidade |
|---|---|
| `src/app/(dashboard)/[rota]/page.tsx` | Entry point — carrega o módulo |
| `src/modules/dashboard/[modulo]/[Nome]PageView.tsx` | Componente principal da tela |
| `src/modules/dashboard/[modulo]/types.ts` | Tipos TypeScript da tela |
| `src/modules/dashboard/[modulo]/constants.ts` | Constantes (PAGE_SIZE, labels, etc.) |
| `src/modules/dashboard/[modulo]/utils.ts` | Funções utilitárias da tela |
| `src/modules/dashboard/[modulo]/hooks.ts` | Hooks customizados (se existir) |
| `src/modules/dashboard/[modulo]/api.ts` | Chamadas à API (se existir) |
| `src/app/api/[rota]/route.ts` | Route Handler — lógica de servidor |

---

## API Routes Utilizadas

| Método | Endpoint | O que faz | Queries (Supabase) |
|---|---|---|---|
| GET | `/api/[rota]` | Descrição | N queries |
| POST | `/api/[rota]` | Descrição | N queries |
| PUT | `/api/[rota]` | Descrição | N queries |

---

## Tabelas Supabase Acessadas

| Tabela | Operação | Filtros principais | Índice necessário |
|---|---|---|---|
| `nome_tabela` | SELECT | tenant_id, status | ✅ existe / ❌ falta |

---

## Regras de Negócio Principais

> Liste as regras de negócio que DEVEM ser preservadas mesmo em refatorações.
> Se a regra for violada, o sistema gera inconsistência operacional.

1. **[Regra 1]:** [descrição]
2. **[Regra 2]:** [descrição]

---

## Pontos de Atenção (Riscos)

- [ ] Há concorrência? (múltiplos usuários editando ao mesmo tempo?)
- [ ] Há gravação parcial possível? (campos salvos em múltiplas chamadas?)
- [ ] Há queries acima de 1.000 registros?
- [ ] Há dependências com outros módulos?

---

## Colaboradores (dependências externas)

| Módulo / Arquivo | Como usa |
|---|---|
| `src/lib/server/appUsersAdmin.ts` | Auth e tenant em todas as rotas |
| `src/lib/server/pageAuthorization.ts` | Controle de permissão por ação |
| `src/lib/server/concurrency.ts` | Controle de conflito de edição |
