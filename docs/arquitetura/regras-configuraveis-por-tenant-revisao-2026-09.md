# Regras Configuráveis por Tenant — Revisão do Levantamento por Tela
Gerado em: 2026-09-09 | Base: `main` em `2d3dc02` | 431 arquivos de migration (última numerada: 420)

Este documento **não substitui** os quatro anteriores. Ele revisa o levantamento à luz de ~145 migrations e ~26 telas que entraram depois deles, e responde a uma pergunta que os anteriores não separaram: **quanto cada regra custa em banco se virar configuração**.

Leitura prévia obrigatória, nesta ordem:

| Arquivo | Papel | Estado em 2026-09-09 |
|---|---|---|
| [`regras-configuraveis-por-tenant-estudo.md`](regras-configuraveis-por-tenant-estudo.md) | Arquitetura proposta, modelo de `rule_key`, RLS | Válido no desenho. Números do resumo executivo desatualizados. |
| [`regras-configuraveis-por-tenant-inventario.md`](regras-configuraveis-por-tenant-inventario.md) | Inventário de módulos, APIs, tabelas e hardcodes | **Parcialmente obsoleto.** Ver seção 2. |
| [`regras-configuraveis-por-tenant-plano.md`](regras-configuraveis-por-tenant-plano.md) | Roadmap em fases, decisões D1–D7 | Válido no desenho. Ordem das fases precisa ser refeita. |
| [`regras-configuraveis-por-tenant-pre-implantacao.md`](regras-configuraveis-por-tenant-pre-implantacao.md) | Checklist de bloqueio antes da primeira migration | Itens de schema precisam ser reconferidos. |

Nada foi implementado: `business_rule_definitions` e `tenant_business_rules` **não existem** no banco. Nenhuma migration entre 276 e 420 criou tabela de regras. A Fase 0 do plano continua sendo o único estado alcançado.

---

## 1. Resumo

O sistema tem hoje **55 rotas de dashboard**, **44 grupos de rota de API**, **52 documentos de tela** e **431 arquivos de migration**. O levantamento de 2026-06-27 cobriu 29 módulos e parou na migration ~275.

O achado central desta revisão é que as regras fixas se dividem em dois grupos de custo muito diferentes, e o inventário anterior não os separava:

- **Regras que vivem só em TypeScript.** Trocar por configuração custa uma leitura nova e nada mais. São a maioria dos candidatos bons.
- **Regras que vivem em `CHECK`, trigger ou RPC `SECURITY DEFINER`.** Trocar por configuração significa recriar função de banco, e em alguns casos derrubar constraint de tabela com dado já gravado que talvez não passe na regra nova.

A regra de "motivo com no mínimo 10 caracteres" é o pior caso mapeado: está escrita em **5 arquivos de aplicação e em 4 funções de banco distintas**. É também a regra com maior chance de alguém querer mudar. Essa combinação é o argumento mais forte a favor da tela de configuração, e ao mesmo tempo o motivo para ela não começar por aí.

---

## 2. Divergências do inventário anterior

Conferidas diretamente no repositório. Elas importam porque a pré-implantação marcou vários desses itens como `[x]` confirmado.

| Item no inventário de 2026-06-27 | Realidade em 2026-09-09 |
|---|---|
| Módulo Programação em `/programacao-simples`, prioridade **1 — Alta** | `src/app/api/programacao/route.ts` **não existe mais**. A tela viva é `programacao-normalizada`. O `CLAUDE.md` congela `programacao-simples` até a remoção: nem refatoração nem crescimento. Toda a Fase 5 do plano aponta para código congelado. |
| Tabelas de permissão: `page_permissions`, `user_page_permissions` | Nomes reais: `app_pages`, `app_user_page_permissions`, `role_page_permissions`. |
| `src/server/modules/` — "apenas programacao" | 22 módulos server-side hoje. |
| ~29 módulos de tela | 55 rotas de dashboard. |
| Telas ausentes do inventário | Cronograma de Solicitações, Medição Comercial, Medição Visualização, Requisição Atendimento, Requisição Solicitação, Estorno Atendimento, Endereçamento Almoxarifado, Mapa Almoxarifado, Contrato, Município, Nível de Tensão, Porte, Prioridade, Tipo de Serviço, Categoria e Grupo de Atividade, Responsáveis Distribuidora, Imei, Dashboard Carteira Operacional. |
| Linha `src/app/api/faturamento/route.ts:859` (motivo ≥ 10) | Arquivo existe e a regra existe, mas as linhas citadas em todo o inventário não foram reconferidas nesta revisão. Tratar toda referência de linha dos documentos de junho como aproximada. |

**Consequência prática:** a ordem de fases do plano não pode ser executada como está. A Fase 5 (Programação) era a primeira e agora aponta para uma tela congelada.

---

## 3. Critério: o que vale virar configuração

Uma regra só entra na tela se passar nos três testes.

1. **Alguém pode querer o contrário.** Se nenhum cliente plausível quer o valor diferente, é constante, não configuração. "Saldo mínimo não pode ser maior que o saldo máximo" nunca terá outro valor.
2. **Mudar não corrompe dado gravado.** Afrouxar um formato é seguro. Apertar um formato invalida linhas que já existem, e a tela precisa dizer isso antes de salvar.
3. **A regra tem uma dona clara.** Se ela existe por integridade referencial ou por isolamento de tenant, não é política de negócio e não é negociável.

---

## 4. Escala de impacto no banco

| Nível | Onde a regra vive hoje | O que custa tornar configurável |
|---|---|---|
| **N0** | Só em `.ts`/`.tsx` | Uma leitura da tabela de regras. Nenhuma migration além da própria tabela. |
| **N1** | TypeScript, mas o valor já ficou gravado em coluna derivada ou snapshot | N0 mais decidir o que acontece com o histórico: recalcular ou congelar. |
| **N2** | Dentro de RPC `SECURITY DEFINER` | Recriar a função lendo a configuração, com `revoke`/`grant` explícito. Cada função é uma migration e um ponto de regressão. |
| **N3** | `CHECK` de tabela ou trigger | Derrubar a constraint, mover para função que lê a configuração, e conferir se todo dado gravado passa na regra nova. É o único nível que pode travar `INSERT` em produção se der errado. |

---

## 5. Levantamento por tela

Somente regras que passaram nos três testes da seção 3. Regras de integridade e de tenant estão na seção 6.

### 5.1 Transversal — vale mais que qualquer regra de tela isolada

| Regra fixa | Valor hoje | Onde vive | Nível | Nota |
|---|---|---|---|---|
| Tamanho mínimo do motivo de cancelamento, reabertura e divergência | 10 caracteres | 5 arquivos de app + 4 RPCs: `set_project_measurement_order_status`, `set_project_billing_order_status`, `save_project_apr_control`, `transfer_project_programming_team` | **N2** | Maior duplicação mapeada. Atinge Medição, Medição Comercial, Faturamento, As Built, Controle APR e Programação. Ver seção 7. |
| Ciclo operacional 21 a 20 | Dia 21 abre, dia 20 fecha | `medicao/normalizers.ts`, `dashboard-measurement/cycles.ts`, `dashboard-portfolio/controller.ts`, `api/meta/route.ts`, `api/apuracao-fator-minimo/route.ts` | **N1** | Reescrito em 5 lugares com a mesma expressão. Muda meta, pontuação, dashboards e apuração ao mesmo tempo. Só uma migration histórica (165) o repete, então o banco quase não atrapalha. |
| Limite de linhas do cadastro em massa | 500 | `src/lib/constants/massImport.ts` | **N0** | Referenciado em 16 pontos. Candidato barato. |
| Tamanho de página padrão | 20 / 5 / 100 | `src/lib/constants/pagination.ts` | **N0** | Preferência de UX, não regra de negócio. Cabe melhor em preferência de usuário. |
| Senha mínima | 8 caracteres | `RecoveryPasswordPageView.tsx:81` | **N0** | O Supabase Auth tem política própria. Configurar nos dois lugares sem alinhar cria erro contraditório. |

### 5.2 Projetos

| Regra fixa | Valor hoje | Onde vive | Nível | Vale? |
|---|---|---|---|---|
| Formato do SOB por prioridade | `GRUPO B - FLUXO`, `DRP / DRC`, `GRUPO A - FLUXO` exigem `^A[0-9]{9}$`; `FUSESAVER` exige `^(ZX\|FS)[0-9]{8}$` | Função `project_sob_matches_priority` + `CHECK chk_project_sob_priority_format`, migration 038 | **N3** | **Sim, alta.** É o exemplo mais próximo do que se quer para a Incidência. Nomes de prioridade estão escritos como texto literal dentro da função: renomear uma prioridade na tela desliga a validação em silêncio. |
| Formato do FOB | Exatamente 10 caracteres | `CHECK`, migration 073 | **N3** | Sim, média. |
| Mensagem de erro do SOB | Nenhuma | — | — | **Divergência aberta:** nada em `src/` traduz `chk_project_sob_priority_format`. O usuário recebe erro cru de constraint. Vale corrigir mesmo sem a tela de regras. |

### 5.3 Medição, Medição Comercial e As Built

| Regra fixa | Valor hoje | Onde vive | Nível | Vale? |
|---|---|---|---|---|
| Formato da Incidência | Nenhum. Texto livre até 120 caracteres | `CommercialOrderRefField.tsx`, `medicao/handlers.ts` | **N0** | **Sim.** Pedido explícito do usuário. Ver seção 7. |
| Unicidade da Incidência por Equipe e Data | Sempre ativa | `UNIQUE INDEX uq_project_measurement_orders_commercial_ref_team_date`, migration 419 | **N3** | Não. É integridade, e afrouxar admitiria duplicata que a tela nasceu para impedir. |
| Projeto obrigatório | Obrigatório em `COM_PRODUCAO` técnica; opcional na comercial | Trigger `enforce_measurement_project_rules` + RPC | **N3** | Sim, média. Já é condicional por categoria de equipe, então o mecanismo de decisão existe. |
| Processo, Hora início e Hora fim obrigatórios na comercial | Sempre | Trigger `enforce_commercial_measurement_fields`, migração 418/419 | **N2** | Sim, baixa. |
| Turno não atravessa meia-noite | Fim maior que início | App e trigger | **N3** | Não pela tela de regras. A doc registra que isso viraria `timestamptz`, não check mais frouxo. |
| Cargo que conta como Eletricista | `ILIKE %ELETRICISTA%` | `medicao/metaHandler.ts:155` | **N0** | **Sim, alta.** Casar cargo por texto é frágil: um cargo novo com outro nome some do select sem erro. |
| Garantia de faturamento mínimo | Ligada, calculada por RPC | `calculate_measurement_minimum_billing_guarantee` | **N2** | Sim, média. As metas em si já são editáveis na tela Meta. |

### 5.4 Cronograma de Solicitações

| Regra fixa | Valor hoje | Onde vive | Nível | Vale? |
|---|---|---|---|---|
| Prazo por prioridade | Baixa = entrada + 10 dias, Média = entrada + 5, Alta = manual | `cronograma-solicitacoes/normalizers.ts:14-18` | **N0** | **Sim, alta.** Melhor candidato do levantamento: prazo de SLA é exatamente o tipo de número que cada cliente quer diferente, e nada no banco o repete. |
| Estados que liberam As Built | `CONCLUIDO`, `PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO`, `BENEFICIO_ATINGIDO` | `normalizers.ts:30-34` | **N0** | Sim, média. Cuidado: o terceiro código existe só por um typo legado remapeado. Configurável, mas o default precisa vir com os três. |
| Dias corridos, não úteis | Corridos | Mesmo arquivo | **N0** | Sim, baixa. |

### 5.5 Equipes, Pessoas e Composição

| Regra fixa | Valor hoje | Onde vive | Nível | Vale? |
|---|---|---|---|---|
| Cargo que conta como Encarregado | `ILIKE %ENCARREGADO%` | `api/teams/meta/route.ts:37`, `teams/lookups.ts:66`, `programacao-normalizada/catalogs.ts:37` | **N0** | **Sim, alta.** Mesma expressão copiada em três lugares. |
| Cargo que conta como Supervisor | `ILIKE %SUPERVISOR%` | `api/teams/meta/route.ts:38`, `teams/lookups.ts:67` | **N0** | Sim, alta. |
| Cargos que exigem tipo | `ENCARREGADO DE TURMA`, `AJUDANTE DE ELETRICISTA`, `ELETRICISTA DE CONSTRUCAO` | `api/people/route.ts:217-227` e `PeoplePageView.tsx:246` | **N0** | Sim, média. Lista literal duplicada entre front e back. |
| Formato do CPF | 11 dígitos, opcional | `api/people/route.ts:202` + `CHECK`, migration 198 | **N3** | Sim, baixa. Só faz sentido se houver tenant com documento estrangeiro. |
| Equipe COMERCIAL dispensa Encarregado e exige Supervisor | Fixo | Trigger `enforce_team_category_links`, migration 420 | **N2** | Não. É a definição da categoria, não parâmetro. |
| Base obrigatória na equipe | Obrigatória | `api/teams/route.ts:444` e `:594` | **N0** | Não. Ver seção 8. |

### 5.6 Materiais e Estoque

| Regra fixa | Valor hoje | Onde vive | Nível | Vale? |
|---|---|---|---|---|
| Campos obrigatórios do material | `codigo`, `descricao`, `categoria`, `subcategoria`, `tipo`, `umb` | Formulário, API e RPC `save_material_record` | **N2** | Sim, baixa. Obrigatoriedade em três camadas: mudar uma sem as outras produz erro contraditório. |
| Preço obrigatório | Não. Vazio grava `0.00` | API | **N0** | Sim, baixa. |
| Saldo mínimo ≤ saldo máximo | Fixo | App | — | Não. Coerência interna. |
| Rastreio por serial | Por material, já editável | `materials.serial_tracking` | — | Já é configuração, por material e não por tenant. Modelo a seguir. |

### 5.7 Programação Normalizada

| Regra fixa | Valor hoje | Onde vive | Nível | Vale? |
|---|---|---|---|---|
| Equipes detalhadas na mensagem de conflito | 3 | `scheduleConflict.ts:21` | **N0** | Não. Legibilidade de mensagem, não negócio. |
| `CONCLUIDO` e `COMPLETO` tratados como concluído | Fixo | Normalizers e várias funções de banco | **N2** | Não. Alias legado de leitura, com limpeza histórica pendente. |
| Regras de etapa, antecipação e conclusão | Fixas | Triggers `zz_trg_project_programming_*` e RPCs | **N3** | Reavaliar depois do corte. O plano de junho as colocava na Fase 5, apontando para a tela congelada. |

### 5.8 Telas sem regra candidata

Cadastros de catálogo — Prioridade, Centro de Serviço, Centro de Estoque, Categoria e Grupo de Atividade, Motivo sem Produção, Tipo de Equipe, Tipo de Serviço, Nível de Tensão, Porte, Município, Responsáveis Distribuidora, Imei — **já são configuração**. Cada um é uma tabela com `tenant_id` e tela de CRUD. Não precisam da tela de regras; precisam que o código pare de casar seus valores por texto, que é o problema apontado em 5.3 e 5.5.

Dashboards (Medição, Equipes, Carteira Operacional, Dash Estoque, Dash Operacional Faturamento) não têm regra própria: leem as regras das telas de origem. As metas que eles exibem já são editáveis na tela Meta.

---

## 6. O que nunca deve entrar na tela

Registrado para que a tela não vire porta dos fundos.

- Qualquer filtro por `tenant_id`, qualquer policy de RLS, qualquer `revoke`/`grant` de RPC.
- Unicidade: número de ordem, Incidência por Equipe e Data, CPF, código de material, um contrato por tenant.
- Integridade referencial e FKs compostas com `tenant_id`.
- Limites de infraestrutura, que são do servidor e não do cliente: teto de 1.000 linhas do PostgREST, tamanho de página de consulta, TTL de cache de sessão, teto de arquivo de importação, tamanho de lote.
- Permissão por página. Já tem tela própria e outro modelo de dado.

---

## 7. Registro: a regra da Incidência

Pedido do usuário em 2026-09-09, **não implementado**, a ser atendido pela futura tela de configuração de regras.

**Regra desejada:** o campo Incidência da Medição Comercial deve aceitar somente dígitos, exatamente 8, e recusar os que começam com `00`.

Formato equivalente: `^(?!00)[0-9]{8}$`.

**Estado atual:** o campo aceita texto livre até 120 caracteres. A única validação é não estar em branco, em três camadas — formulário, rota e trigger `enforce_commercial_measurement_fields`. O `maxLength` de 120 está no componente `CommercialOrderRefField.tsx`; a coluna é `project_measurement_orders.commercial_order_ref`.

**Chave proposta:** `medicao_comercial.incidencia_formato`, do tipo texto contendo a expressão, com default vazio significando sem restrição.

**Impacto no banco: N0.** Nenhum `CHECK` de formato existe hoje sobre `commercial_order_ref`. A validação nasceria só em aplicação, e o índice único da migration 419 continua valendo independentemente do formato.

**Cuidado obrigatório na implantação.** Esta regra *aperta* o formato. Toda Incidência já gravada que não casar com o padrão passa a ser inválida. Ordens antigas continuam legíveis, mas qualquer edição delas passa a falhar na validação nova. A tela precisa medir quantas linhas não passam antes de salvar a regra, e a decisão de aplicar só a registros novos ou a todos é de negócio.

**Alternativa enquanto a tela não existe:** cravar a validação em `CommercialOrderRefField.tsx` e em `medicao/handlers.ts`, com a expressão isolada numa constante exportada, para a migração para a tela ser uma troca de origem do valor e não uma reescrita.

---

## 8. Um caso que a tela de regras não resolve

O usuário levantou, na mesma tarefa, que a coluna `Centro de Servicos` do CSV de Detalhamento depende de projeto e por isso sai vazia em quase toda ordem comercial.

Isso **não é regra configurável**. É escolha de fonte de dado: hoje vem de `project_with_labels.service_center_text`, e a saída proposta é cair para a Base da equipe, `teams.service_center_id`, que é obrigatória no cadastro de Equipes.

Registrado aqui porque a fronteira importa. Configuração parametriza uma regra que já existe. Trocar de onde um dado vem é mudança de código. Misturar os dois transformaria a tela de regras num painel de comportamento arbitrário, que é exatamente o que o estudo de junho quis evitar.

---

## 9. Ordem recomendada

A ordem do plano de junho começava por Programação, que hoje é a tela congelada. Esta é a ordem por retorno sobre risco.

| Ordem | Escopo | Nível | Por quê |
|---|---|---|---|
| 1 | Tabela de regras, RLS, RPC de escrita e leitura em cache | — | Fundação. Sem ela nada mais existe. As decisões D1–D7 do plano continuam válidas. |
| 2 | Prazos do Cronograma de Solicitações | N0 | Primeira regra real: uma tela, um arquivo, nenhuma função de banco. Prova o modelo ponta a ponta com risco quase nulo. |
| 3 | Cargos que contam como Encarregado, Supervisor e Eletricista | N0 | Elimina três cópias da mesma expressão e corrige uma fragilidade real de casamento por texto. |
| 4 | Formato da Incidência | N0 | Pedido do usuário. Estreia o tipo "expressão de formato", que a fundação precisa suportar. |
| 5 | Motivo com mínimo de caracteres | N2 | Quatro RPCs. Só depois do modelo provado nos níveis N0. |
| 6 | Ciclo 21 a 20 | N1 | Cinco módulos e efeito em dashboards e metas ao mesmo tempo. Exige plano de recálculo. |
| 7 | Formato do SOB por prioridade | N3 | Derruba `CHECK` da tabela `project`. Só com backfill conferido. |
| 8 | Programação | N3 | Reavaliar depois do corte da Programação Normalizada. |

---

## 10. Limites deste levantamento

Registrado para não ser lido como mais firme do que é.

- Leitura **estática** do repositório. Nada foi conferido contra o banco vivo: não sei quantas linhas hoje violariam cada regra proposta, e esse número é justamente o que decide o risco dos níveis N1 e N3.
- As referências de linha desta revisão foram conferidas; as dos documentos de junho, não.
- A varredura de regras priorizou mensagens de validação e constantes nomeadas. Regra escrita como número solto no meio de uma expressão pode ter escapado.
- Não há suíte de testes automatizados no projeto, então nenhuma das regras mapeadas tem teste que prove o comportamento atual antes de mexer.
- Das 4 funções de banco com a regra de 10 caracteres, todas foram identificadas pelo texto da migration mais recente de cada uma. Confirmar no banco vivo qual versão está instalada antes de recriar qualquer uma.
