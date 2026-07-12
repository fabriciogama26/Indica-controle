# Front-end e UI — Verificação Obrigatória

> Criado: 2026-06 | Aplica-se a: PageView.tsx, hooks.ts, componentes de listagem e formulário.
> Separado de performance de banco/API por ter natureza diferente — aqui o foco é o que o usuário vê e sente.

---

## REGRAS DE BUSCA DE DADOS NO FRONT

### ❌ NÃO FAZER

- Buscar dados sem filtro de período padrão (ex: carregar "todos os projetos do ano")
- Deixar filtro de período com intervalo > 3 meses como padrão
- Buscar dados que o componente pai já buscou (duplicação client-side)
- Chamar `/api/auth/session-access` ou `getUser()` dentro de componentes filhos — usar `useAuth()` do contexto
- Disparar request a cada tecla em campos de busca (sem debounce)
- Recarregar a lista inteira ao mudar um filtro se já tem dados e o filtro vai para a API
- Usar `useEffect` sem lista de dependências — causa loop infinito ou disparo infinito
- Colocar objeto/array inline como dependência do `useEffect` (recriado a cada render)

### ✅ FAZER

- Definir `defaultFilters` com período padrão (mês atual ou últimos 30 dias)
- Usar `useDebounce(value, 300)` em campos de busca texto antes de disparar request
- Usar `useAuth()` centralizado para todos os dados de sessão
- Separar hooks de busca de dados dos componentes de renderização
- Usar `staleTime` no React Query para evitar refetch desnecessário
- Usar `refetchOnWindowFocus: false` em dados operacionais que mudam por ação do usuário

### Exemplo: filtro padrão de período

```typescript
// Em constants.ts do módulo:
export const DEFAULT_FILTERS = {
  startDate: getFirstDayOfCurrentMonth(), // ex: "2026-06-01"
  endDate: getLastDayOfCurrentMonth(),    // ex: "2026-06-30"
  page: 1,
  pageSize: 50,
};

// Em hooks.ts do módulo:
const [filters, setFilters] = useState(DEFAULT_FILTERS);
// → usuário abre a tela e já vê o mês atual, não um carregamento de 1 ano
```

### Exemplo: useEffect com dependências corretas

```typescript
// ❌ ERRADO — dispara infinitamente porque `filters` é recriado a cada render:
useEffect(() => {
  fetchData({ filters: { tenantId, page: 1 } }); // objeto inline
}, [tenantId]);

// ✅ CORRETO — dependências estáveis:
const filtersRef = useRef(filters);
filtersRef.current = filters;

useEffect(() => {
  fetchData(filtersRef.current);
}, [filtersRef]); // ou usar react-query que gerencia isso automaticamente

// ✅ MELHOR — deixar o React Query controlar:
const { data } = useQuery({
  queryKey: ["programacao", tenantId, filters.startDate, filters.endDate, filters.page],
  queryFn: () => fetchProgramacao(filters),
  staleTime: 30_000,
});
```

### Exemplo: debounce em campo de busca

```typescript
// Em hooks.ts do módulo:
const [searchText, setSearchText] = useState("");
const debouncedSearch = useDebounce(searchText, 300); // de src/hooks/useDebounce.ts

// A query usa debouncedSearch, não searchText direto:
const { data } = useQuery({
  queryKey: ["projetos", tenantId, debouncedSearch, filters],
  queryFn: () => fetchProjetos({ ...filters, search: debouncedSearch }),
  enabled: true,
});

// No input:
<input value={searchText} onChange={(e) => setSearchText(e.target.value)} />
// → só dispara request após 300ms de pausa na digitação
```

---

## REGRAS DE RENDERIZAÇÃO E LISTAGEM

### ❌ NÃO FAZER

- Renderizar tabelas com 500+ linhas sem paginação ou virtualização
- Disparar re-render da lista inteira ao atualizar um único item
- Não mostrar estado de loading/vazio/erro — deixar a tela em branco
- Fazer navegação de tela sem limpar o estado de filtros se for comportamento inesperado

### ✅ FAZER

- Usar paginação em todas as listas com mais de 50 registros
- Mostrar skeleton/loading enquanto busca
- Mostrar estado vazio com mensagem clara
- Travar o botão de exportar por 10s após o clique (exportCooldown já implementado)
- Mostrar aviso quando o registro salvo está fora dos filtros ativos

### Exemplo: aviso de registro fora do filtro

```typescript
// Após salvar um registro com sucesso:
const isInCurrentFilter = checkIfInFilter(savedRecord, currentFilters);
if (!isInCurrentFilter) {
  toast.warning(
    `Registro salvo, mas está fora dos filtros ativos. ` +
    `Limpe os filtros para visualizá-lo.`
  );
}
```

---

## REGRAS DE COMPONENTES

### ❌ NÃO FAZER

- Colocar lógica de negócio crítica dentro do componente PageView
- Chamar `supabase.from(...)` diretamente dentro de componentes — usar hooks ou API Routes
- Usar `console.log` em produção — usar `useErrorLogger` com tag do módulo
- Criar funções utilitárias (formatDate, parsers) dentro do PageView — importar de `src/lib/utils/`

### ✅ FAZER

- Manter PageView abaixo de 1.000 linhas
- Delegar lógica de busca para hooks
- Delegar lógica de negócio para services ou API Routes
- Registrar erros com `useErrorLogger("nome-do-modulo")`
- Importar `formatDate`, `formatDateTime`, `toIsoDate` de `src/lib/utils/formatters.ts`
- Importar `downloadCsvFile` de `src/lib/utils/csv.ts`
- Importar `parseNonNegativeInteger`, `parsePositiveNumber` de `src/lib/utils/parsers.ts`

---

## REGRAS DE SESSÃO E AUTH NO FRONT

### ❌ NÃO FAZER

- Chamar `supabase.auth.getUser()` ou `supabase.auth.getSession()` dentro de componentes
- Chamar `/api/auth/session-access` fora do fluxo de login/hidratação
- Recarregar permissões a cada troca de tela
- Armazenar tokens em `localStorage` com chave diferente da definida em `auth.service.ts`

### ✅ FAZER

- Usar apenas `useAuth()` para acessar sessão, usuário e permissões
- Confiar no `AuthContext` para gerenciar revalidação e idle timeout
- Verificar `session.pageAccess.includes("page-key")` para autorização visual

---

## Checklist de front-end por PR

- [ ] Há filtro de período padrão definido? (mês atual como default)
- [ ] Campos de busca texto usam debounce (300ms mínimo)?
- [ ] Não há chamada de auth fora do `useAuth()`?
- [ ] `useEffect` tem dependências corretas? Não há objeto/array inline?
- [ ] Listas com > 50 itens têm paginação?
- [ ] PageView está abaixo de 1.000 linhas?
- [ ] Erros são registrados com `useErrorLogger("modulo")`?
- [ ] Funções de formatação vêm de `src/lib/utils/` (não copiadas)?
- [ ] Exportação tem cooldown de 10s?
- [ ] Componente não chama `supabase.from()` diretamente?
## Verificacao desta entrega - 2026-06-27
- [x] Calendario semanal ganhou classe e legenda propria para `ANTECIPADA`.
- [x] Historico exibe `PARCIAL` legado como `Parcial nao planejado`.
- [x] Nao aplicavel: tela nova ou mudanca de layout estrutural.

## Verificacao desta entrega - 2026-07-04
- [x] Botoes de exportacao da Medicao mantem modal `Gerando...` e feedback de erro.
- [x] Tela usa `useAuth()`/token ja centralizado; nao foi adicionada chamada direta ao Supabase no componente.
- [x] Exportacao continua bloqueada por estados `isExporting`, `isExportingDetails` e `isExportingScore`.
- [x] Nao aplicavel: nenhuma mudanca visual estrutural, filtro novo ou listagem sem paginacao.

## Verificacao desta entrega - 2026-07-04 - Modal compartilhado
- [x] Modal de exportacao foi extraido para `ExportProgressModal` reutilizavel.
- [x] Medicao usa modo simples/indeterminado para exportacao server-side, sem exibir percentual falso.
- [x] O componente compartilhado nao acessa auth, Supabase ou regra de negocio.
- [x] Botoes de exportacao convertidos para `CsvExportButton` ou `ExportProgressModal` compartilhado mantem estado `isExporting` e texto `Exportando...`/`Gerando...`.
- [x] Nao aplicavel: nao houve alteracao em filtros, listagens, paginacao, auth ou layout estrutural.

## Verificacao desta entrega - 2026-07-05
- [x] Telas novas usam CSS Module e mantem padrao visual de cards, campos e botoes do sistema.
- [x] Telas novas usam `useAuth()` e nao chamam Supabase diretamente no componente.
- [x] Erros sao registrados com `useErrorLogger("configuracao_mapa_almoxarifado")` e `useErrorLogger("mapa_almoxarifado")`.
- [x] Nao aplicavel: busca do mapa e filtro local sobre payload ja carregado; nao dispara request por tecla.
- [x] Select de centro passa a receber apenas opcoes fisicas elegiveis da API, sem regra visual por texto do nome.
- [x] Cadastro Base ganhou seletor Prateleira/Pallet e o mapa ganhou modal de revisao para enderecamento em massa.
- [x] Lista do lote fica limitada a 100 itens por operacao, com area rolavel no modal.
- [x] Inputs do Cadastro Base limitam colunas a 15, linhas a 20, andares a 10 e posicoes por andar a 10.
