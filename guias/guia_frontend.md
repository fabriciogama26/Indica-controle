# Guia de Frontend e UI

## 1. Escopo

Obrigatório sempre que a tarefa altera ou cria:
- `PageView.tsx`, `hooks.ts`, `components/*` de uma tela;
- filtro, listagem, formulário, exportação ou layout visual;
- qualquer ponto que leia sessão/auth no client.

Este guia funde frontend (busca de dados, hooks, Next.js client/server components) e UI (renderização, componentes visuais) porque o projeto hoje trata os dois como uma camada só — não há separação de arquivos entre "lógica de front" e "UI pura" nos módulos existentes. Para regras de API que o front consome, ver [`guia_backend.md`](guia_backend.md).

## 2. Fontes de verdade

- Módulos de referência: `src/modules/dashboard/programacao-simples/*`, `src/modules/dashboard/medicao/*`.
- `src/hooks/useDebounce.ts`, `src/lib/utils/formatters.ts`, `src/lib/utils/csv.ts`, `src/lib/utils/parsers.ts`.
- `AuthContext`/`useAuth()` como única fonte de sessão no client.

## 3. Regras obrigatórias

### Busca de dados
1. Toda tela de listagem define `defaultFilters` com período padrão (mês atual ou últimos 30 dias) — proibido carregar "todos os registros do ano" por padrão.
2. Campo de busca texto usa debounce mínimo de 300ms (`useDebounce`) antes de disparar request.
3. Sessão, usuário e permissões só são acessados via `useAuth()` — proibido chamar `supabase.auth.getUser()`/`getSession()` ou `/api/auth/session-access` dentro de componentes filhos.
4. `useEffect` nunca tem objeto ou array inline como dependência (é recriado a cada render → loop). Preferir React Query controlando a `queryKey`, ou `useRef` estável.
5. Não duplicar busca de dados que o componente pai já buscou.
6. Não recarregar a lista inteira ao mudar um filtro que já vai para a API — deixar a API filtrar.
7. `useQuery` usa `staleTime` adequado: dados operacionais (mudam por ação do usuário) usam `staleTime` curto (ex. 30s) e `refetchOnWindowFocus: false`; catálogos (raramente mudam) usam `staleTime` de 10 min.

### Renderização e listagem
8. Listas com mais de 50 itens exigem paginação ou carregamento progressivo — nunca renderizar 500+ linhas sem paginação/virtualização.
9. Toda tela mostra estado de loading, vazio e erro — nunca deixar a tela em branco enquanto busca.
10. Exportação trava o botão por 10s após o clique (cooldown).
11. Quando um registro salvo fica fora dos filtros ativos, mostrar aviso explícito orientando a limpar o filtro para visualizá-lo.

### Componentes
12. Lógica de negócio crítica não fica dentro do `PageView` — delega para hooks (busca) ou services/API Routes (regra).
13. Componente nunca chama `supabase.from(...)` diretamente — usar hooks ou API Routes.
14. Formatação (`formatDate`, `formatDateTime`, `toIsoDate`), CSV (`downloadCsvFile`) e parsers (`parseNonNegativeInteger`, `parsePositiveNumber`) vêm de `src/lib/utils/` — proibido reimplementar dentro do `PageView`.
15. `PageView.tsx` fica abaixo de 1.000 linhas; acima disso exige plano de modularização registrado no TXT da tela.
16. `console.log` em produção é proibido — usar `useErrorLogger("<modulo>")` com a tag do módulo.

### Sessão e autenticação no front
17. Apenas `useAuth()` acessa sessão, usuário e permissões — nunca recarregar permissões a cada troca de tela.
18. `AuthContext` é a única fonte de revalidação e idle timeout.
19. Autorização visual usa `session.pageAccess.includes("page-key")` — mas isso nunca substitui a autorização server-side (ver [`guia_backend.md`](guia_backend.md) regra 8): esconder botão/menu no front não é controle de acesso.
20. Tokens não são armazenados fora da chave definida em `auth.service.ts`.

## 4. Fluxo recomendado

1. Definir `DEFAULT_FILTERS` em `constants.ts` do módulo antes de implementar a busca.
2. Implementar hooks de busca separados do componente de renderização.
3. Ligar debounce em qualquer campo de busca texto.
4. Configurar `useQuery` com `staleTime`/`gcTime`/`refetchOnWindowFocus` adequados ao tipo de dado.
5. Verificar loading/vazio/erro antes de considerar a tela pronta.
6. Rodar o checklist de front-end de [`guia_validacao.md`](guia_validacao.md).

## 5. Exemplos

**Pedido:** "Cria um filtro por status na listagem de ordens."
**Comportamento esperado:** filtro entra em `DEFAULT_FILTERS`/`useState`, vai para a `queryKey` do React Query e é enviado à API — nunca aplicado em `data.filter(...)` sobre a lista já carregada. Status inválido na URL cai no padrão "todos" sem quebrar a página.

```ts
// Em constants.ts do módulo:
export const DEFAULT_FILTERS = {
  startDate: getFirstDayOfCurrentMonth(),
  endDate: getLastDayOfCurrentMonth(),
  page: 1,
  pageSize: 50,
};
```

**Pedido:** "O campo de busca da tela de Projetos está disparando uma request a cada tecla."
**Comportamento esperado:** aplicar `useDebounce(searchText, 300)` e usar o valor "debounced" na `queryKey`/`queryFn`, não o valor bruto do input.

## 6. Guardrails

Nunca:
- Chamar `supabase.auth.getUser()`/`getSession()` dentro de um componente.
- Usar objeto/array inline como dependência de `useEffect`.
- Deixar uma tela sem filtro de período padrão.
- Confiar em botão desabilitado/menu escondido como controle de acesso.
- Copiar `formatDate`/parsers para dentro do `PageView` em vez de importar de `src/lib/utils/`.

## 7. Validação

- `npx tsc --noEmit`
- `npm run lint`
- Teste manual do caminho feliz e de pelo menos um filtro/estado vazio antes de reportar a tarefa como concluída (não há suíte automatizada de testes de UI hoje — ver [`guia_validacao.md`](guia_validacao.md)).
