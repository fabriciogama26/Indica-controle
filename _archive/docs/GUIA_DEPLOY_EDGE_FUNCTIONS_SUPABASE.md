# Deploy de Edge Functions no Supabase

## Objetivo

Fazer deploy de uma Edge Function do projeto **Indica Controle** no Supabase, evitando falhas de:

- autenticação/permissão (`403`);
- Docker Desktop local;
- projeto Supabase errado;
- deploy sem confirmação.

---

## Dados do projeto

| Item | Valor |
|---|---|
| Projeto Supabase | `indicadatesupabase` |
| Project ref | `lcusxnhhrjosxqgiphgp` |
| Caminho local | `D:\Fabricio\Projetos SaaS\Indica-controle` |
| Exemplo de função | `import_project_forecast` |
| Método recomendado de deploy | `--use-api` |

> **Importante:** não use ou compartilhe o token da Supabase CLI, links de login temporários ou valores de `.env`.

---

# Fluxo normal de deploy

## 1. Abrir o terminal na raiz do projeto

```powershell
cd "D:\Fabricio\Projetos SaaS\Indica-controle"
```

## 2. Conferir se o projeto local está ligado ao Supabase correto

```powershell
npm run db:check-link
```

Resultado esperado:

```text
OK: CLI linkado ao projeto correto (lcusxnhhrjosxqgiphgp)
Projeto: indicadatesupabase
Fonte: supabase/.temp/project-ref
```

Se o `project-ref` for diferente de `lcusxnhhrjosxqgiphgp`, **pare**. Não faça deploy antes de corrigir o vínculo.

## 3. Conferir se a função existe localmente

Exemplo para a função de importação de previsão:

```powershell
Test-Path "supabase/functions/import_project_forecast/index.ts"
```

Resultado esperado:

```text
True
```

## 4. Fazer o deploy usando a API do Supabase

Use este comando:

```powershell
npx supabase functions deploy import_project_forecast --project-ref lcusxnhhrjosxqgiphgp --use-api
```

O `--use-api` evita depender do Docker Desktop local para montar a função.

## 5. Confirmar o sucesso

Resultado esperado:

```text
Deployed Functions on project lcusxnhhrjosxqgiphgp: import_project_forecast
```

Depois, valide no sistema com uma importação pequena e confira os logs da função no Dashboard do Supabase.

---

# Script recomendado no package.json

Deixe o script de deploy com `--use-api`.

```json
{
  "scripts": {
    "fn:deploy:forecast": "npm run db:check-link && npx supabase functions deploy import_project_forecast --project-ref lcusxnhhrjosxqgiphgp --use-api"
  }
}
```

Depois disso, o deploy normal fica:

```powershell
npm run fn:deploy:forecast
```

---

# Erro 1 — 403 ao listar ou publicar Functions

## Mensagem típica

```text
unexpected list functions status 403:
Your account does not have the necessary privileges to access this endpoint.
```

## O que significa

O projeto pode estar corretamente linkado, mas a Supabase CLI está autenticada com:

- conta errada;
- token antigo, revogado ou inválido;
- usuário sem permissão suficiente no projeto ou na organização.

Esse erro **não tem relação com o código da função**, RLS, chave `service_role` ou banco de dados.

## Como corrigir

### 1. Ver quais projetos a CLI consegue acessar

```powershell
npx supabase projects list
```

O projeto abaixo precisa aparecer:

```text
lcusxnhhrjosxqgiphgp
```

Se não aparecer, a CLI está usando uma conta que não possui acesso ao projeto.

### 2. Autenticar novamente

```powershell
npx supabase login
```

Faça login no navegador com a conta que possui acesso administrativo ao projeto.

### 3. Testar a permissão específica de Functions

```powershell
npx supabase functions list --project-ref lcusxnhhrjosxqgiphgp
```

Resultado esperado: uma lista de funções, sem erro `403`.

Exemplo de funções já existentes:

```text
auth-login-web
logout
auth-recover
login_matricula
verify_admin_pin
get_materials
get_project_forecast_template
import_project_forecast
get_project_activity_forecast_template
import_project_activity_forecast
```

### 4. Repetir o deploy

```powershell
npm run fn:deploy:forecast
```

---

# Erro 2 — Docker Desktop / edge-runtime

## Mensagem típica

```text
Bundling Function: import_project_forecast
failed to inspect docker image:
request returned 500 Internal Server Error
... dockerDesktopLinuxEngine ...
... public.ecr.aws/supabase/edge-runtime ...
```

## O que significa

A CLI conseguiu autenticar e chegar ao momento de empacotar a função, mas o Docker Desktop local falhou ao acessar a imagem do runtime.

Esse erro é do ambiente local do Docker/WSL. Não é falha da função e não indica que o deploy foi concluído.

## Solução recomendada

Faça o deploy via API:

```powershell
npx supabase functions deploy import_project_forecast --project-ref lcusxnhhrjosxqgiphgp --use-api
```

Essa é a opção preferida neste projeto, pois evita depender do Docker.

---

# Correção opcional do Docker Desktop

Só faça isso caso precise usar Docker localmente para testar ou empacotar funções.

## 1. Fechar o Docker Desktop por completo

Feche pelo ícone ao lado do relógio do Windows, usando a opção de sair.

## 2. Encerrar o WSL

No PowerShell:

```powershell
wsl --shutdown
```

## 3. Abrir novamente o Docker Desktop

Espere ele ficar totalmente iniciado.

## 4. Testar se o Docker responde

```powershell
docker version
```

O resultado precisa mostrar as partes:

```text
Client
Server
```

## 5. Testar o download da imagem usada pelo runtime

```powershell
docker pull public.ecr.aws/supabase/edge-runtime:v1.74.1
```

Se continuar retornando erro `500`, o problema está no Docker Desktop/WSL local. Continue usando `--use-api` para publicar as Edge Functions.

---

# Conferência após o deploy

## 1. Conferir a versão publicada

```powershell
npx supabase functions list --project-ref lcusxnhhrjosxqgiphgp
```

Confira a coluna `VERSION` ou `UPDATED_AT` da função publicada.

## 2. Abrir os logs no Dashboard

Acesse o projeto no Supabase Dashboard:

```text
Project > Edge Functions > import_project_forecast > Logs
```

## 3. Executar um teste funcional controlado

Para a função `import_project_forecast`:

1. use uma planilha pequena e válida;
2. importe poucos registros;
3. confirme os dados gravados no sistema;
4. valide se não houve duplicidade;
5. confira se erros de validação retornam mensagens claras;
6. consulte os logs da função logo após o teste.

---

# Checklist antes de publicar

- [ ] Estou na pasta `D:\Fabricio\Projetos SaaS\Indica-controle`.
- [ ] `npm run db:check-link` confirma `lcusxnhhrjosxqgiphgp`.
- [ ] O arquivo `supabase/functions/<nome-da-funcao>/index.ts` existe.
- [ ] A alteração foi revisada.
- [ ] Não há token, chave privada ou `service_role` exposto no código.
- [ ] A CLI consegue executar `npx supabase functions list --project-ref lcusxnhhrjosxqgiphgp`.
- [ ] O comando de deploy contém `--use-api`.
- [ ] Após o deploy, foi feito um teste funcional pequeno.
- [ ] Os logs da Edge Function foram verificados.

---

# Comandos prontos

## Publicar a previsão de projetos

```powershell
npm run fn:deploy:forecast
```

## Publicar diretamente, sem usar o script

```powershell
npx supabase functions deploy import_project_forecast --project-ref lcusxnhhrjosxqgiphgp --use-api
```

## Listar as funções existentes

```powershell
npx supabase functions list --project-ref lcusxnhhrjosxqgiphgp
```

## Conferir vínculo do projeto local

```powershell
npm run db:check-link
```

## Entrar novamente na conta da Supabase CLI

```powershell
npx supabase login
```

## Ver projetos acessíveis à conta atual

```powershell
npx supabase projects list
```

---

# Regra prática

1. Se der `403`: corrigir login/permissão da Supabase CLI.
2. Se der erro de Docker: usar `--use-api`.
3. Se o `db:check-link` falhar: não fazer deploy.
4. Se o deploy disser `Deployed Functions`: testar no sistema e conferir os logs.
