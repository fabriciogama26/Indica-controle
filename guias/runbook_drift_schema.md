# Runbook de Drift de Schema

## 1. Escopo

Obrigatório quando houver suspeita de que o banco de produção não corresponde ao que as migrations reconstroem: correção aplicada direto no Dashboard/SQL editor, remediação manual de alerta do Supabase Advisor, ou objeto cujo estado vivo diverge do arquivo que o criou.

Este runbook existe pelo mesmo motivo do [`runbook_rollback.md`](runbook_rollback.md): **as migrations são aplicadas à mão no Supabase**, não por pipeline. Um conserto feito pelo Dashboard corrige produção e não deixa rastro no repositório. Produção fica certa; a receita para reconstruí-la fica errada.

O sintoma não aparece em produção. Aparece em `supabase db reset`, branch de preview, projeto novo ou ambiente de outro tenant — onde o objeto renasce com o defeito original.

---

## 2. Fontes de verdade

- `supabase/migrations/*` — a receita. É ela que precisa estar certa, não só o banco.
- Banco linkado — o estado real, obtido por `npm run db:check-link` + consulta.
- `npm run db:drift-check` — compara os dois montando um shadow das migrations.
- [`guia_sql.md`](guia_sql.md) regra 26 — a regra que este runbook operacionaliza.

---

## 3. Caso de referência

`v_stock_conflicts` e `v_stock_conflict_items` foram criadas pela migration `007_views_conflicts.sql` **sem** `security_invoker = true`, o que faz a view ignorar a RLS por tenant da tabela base. Em algum momento a opção foi corrigida direto no banco — provavelmente na leva de remediação do Advisor que originou a migration `375`.

Consequência: a consulta ao banco vivo mostrava `security_invoker=true` nas três views e **nenhum risco ativo**, enquanto o repositório continuava criando as views vulneráveis. Qualquer ambiente novo nasceria sem isolamento por tenant nessas views.

Resolvido pela migration `377`, que removeu as duas views (não tinham consumidor em `src/`), e pelo check estático `npm run db:view-check`, que passou a falhar na origem.

**A lição que generaliza:** um check que só lê o banco vivo teria passado. O que pegou o problema foi comparar a receita com o resultado.

---

## 4. Procedimento

### 4.1 Confirmar o link antes de qualquer coisa

```bash
npm run db:check-link
```

Nunca rodar diff contra um projeto divergente — `guia_sql.md` regra 5.

### 4.2 Rodar o diff geral

```bash
npm run db:drift-check
```

Monta um shadow a partir de `supabase/migrations` e compara com o banco linkado, restrito ao schema `public`. **Exige Docker rodando** — o shadow é um Postgres em container.

Saída vazia = sem drift no `public`. Qualquer SQL na saída é uma diferença entre a receita e o banco.

### 4.3 Ler o diff na direção certa

A saída descreve **o que faltaria aplicar nas migrations para chegar no banco vivo**. Cada bloco cai em um destes casos:

| O que o diff mostra | Leitura | Ação |
|---|---|---|
| Objeto existe no banco, ausente nas migrations | Criado à mão | Versionar como migration nova |
| Opção/atributo diferente (ex.: `security_invoker`, `search_path`, grant) | Corrigido à mão | Versionar a correção; avaliar se o objeto ainda é necessário |
| Objeto nas migrations, ausente no banco | Migration não aplicada | `npm run db:migration-list` e aplicar |
| Diferença só de formatação/ordem | Ruído do diff | Ignorar, registrar aqui na seção 6 |

### 4.4 Fechar o drift

Para cada diferença real, criar migration nova — **nunca editar a migration original** (`guia_sql.md` regra 2). A migration deve ser segura contra o estado atual de produção: `drop ... if exists`, `create or replace`, ou bloco `DO` idempotente. Em produção ela tende a ser no-op; o valor dela é corrigir ambientes novos.

Incluir bloco `DO` de validação pós-aplicação que falha se a condição não se sustentar, no padrão das migrations `375` e `377`.

### 4.5 Depois

- Rodar `npm run db:security-check` e `npm run db:view-check` (estáticos, pegam na origem).
- Rodar `npm run db:drift-check` de novo e confirmar saída vazia.
- Registrar na seção 6 deste arquivo qualquer diferença que for ruído conhecido.

---

## 5. Quando rodar sem suspeita

- Antes de criar um ambiente novo (preview, homolog, tenant separado).
- Depois de qualquer remediação de alerta do Supabase Advisor feita pelo Dashboard.
- Antes de um rollback que envolva migrations — drift não detectado transforma rollback em incidente.

---

## 6. Registro de diferenças conhecidas

Nenhuma registrada até o momento. O primeiro `db:drift-check` geral ainda não foi executado — ver seção 7.

---

## 7. Pendência aberta

O `db:drift-check` geral **ainda não foi rodado**. O caso das views de conflito foi encontrado por inspeção pontual, não por varredura. Como a correção manual daquelas views é evidência de que o Dashboard já foi usado para consertar schema, é razoável supor que existam outras diferenças ainda não mapeadas.

Rodar a varredura completa e preencher a seção 6 é tarefa pendente.

---

## 8. Guardrails

Nunca:
- Concluir que "está tudo certo" com base apenas em consulta ao banco vivo — ele não revela o que as migrations reconstroem.
- Editar uma migration já aplicada para fechar drift.
- Aplicar o SQL cru da saída do `db diff` como migration sem revisar: a saída é SQL de revisão, não script portátil de aplicação (o próprio CLI avisa).
- Rodar diff sem confirmar o link.
