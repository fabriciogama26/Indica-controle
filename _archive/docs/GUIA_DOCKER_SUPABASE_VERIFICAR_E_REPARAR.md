# Docker Desktop + Supabase Edge Functions — Verificação e Reparo

## Finalidade

Este guia registra como diagnosticar e corrigir erros do Docker Desktop ao fazer deploy de Edge Functions do Supabase no projeto **Indica Controle**.

Ele cobre principalmente estes erros:

```text
failed to inspect docker image
request returned 500 Internal Server Error
```

```text
failed to create docker container
error during connect: Post ".../containers/create": EOF
```

---

## Contexto do projeto

| Item | Valor |
|---|---|
| Projeto local | `D:\Fabricio\Projetos SaaS\Indica-controle` |
| Projeto Supabase | `indicadatesupabase` |
| Project ref | `lcusxnhhrjosxqgiphgp` |
| Exemplo de função | `import_project_forecast` |
| Imagem usada no bundle | `public.ecr.aws/supabase/edge-runtime:v1.74.1` |

---

# Resultado de deploy bem-sucedido

O deploy está concluído quando aparecer algo como:

```text
Bundling Function: import_project_forecast
Deploying Function: import_project_forecast (script size: 218.8kB)
Deployed Functions on project lcusxnhhrjosxqgiphgp: import_project_forecast
```

Isso significa:

1. a função foi encontrada localmente;
2. o Docker conseguiu criar o container de bundle;
3. o código foi empacotado;
4. a Edge Function foi enviada ao Supabase;
5. a nova versão foi publicada.

---

# Fluxo normal de deploy com Docker

## 1. Abrir o terminal na pasta do projeto

```powershell
cd "D:\Fabricio\Projetos SaaS\Indica-controle"
```

## 2. Confirmar que o projeto local está ligado ao Supabase correto

```powershell
npm run db:check-link
```

Resultado esperado:

```text
OK: CLI linkado ao projeto correto (lcusxnhhrjosxqgiphgp)
Projeto: indicadatesupabase
Fonte: supabase/.temp/project-ref
```

> Se o `project-ref` não for `lcusxnhhrjosxqgiphgp`, pare antes de fazer deploy.

## 3. Fazer o deploy

```powershell
npm run fn:deploy:forecast
```

O script executa:

```powershell
npx supabase functions deploy import_project_forecast --project-ref lcusxnhhrjosxqgiphgp
```

---

# Diagnóstico inicial do Docker

Rode estes comandos para conferir se Docker Desktop, engine Linux e WSL estão funcionando.

```powershell
docker desktop status
docker version
docker info
docker context ls
docker desktop engine ls
wsl -l -v
wsl --version
```

## Resultado esperado

### Docker Desktop

```text
Status  running
```

### `docker version`

Deve mostrar as seções:

```text
Client:
Server:
```

Na seção `Server`, o sistema operacional deve ser:

```text
OS/Arch: linux/amd64
```

### Contexto

Em `docker context ls`, deve existir um asterisco no contexto:

```text
desktop-linux *
```

### Engine

Em `docker desktop engine ls`, deve aparecer:

```text
linux *
```

Se o asterisco estiver em `windows`, alterne o Docker Desktop para **Linux containers** antes de continuar.

---

# Erro 1 — Falha ao inspecionar a imagem do Supabase

## Mensagem típica

```text
failed to inspect docker image:
request returned 500 Internal Server Error
... dockerDesktopLinuxEngine ...
... /images/public.ecr.aws/supabase/edge-runtime:v1.74.1/json
```

## Causa provável

A imagem do runtime do Supabase não estava disponível corretamente no cache local do Docker. Em alguns casos, o Docker Desktop pode responder `500` ao consultar uma imagem inexistente ou incompleta, em vez de mostrar uma mensagem mais clara de imagem não encontrada.

## Como verificar

No PowerShell:

```powershell
$img = "public.ecr.aws/supabase/edge-runtime:v1.74.1"

docker image inspect $img
```

### Interpretação

| Resultado | Significado |
|---|---|
| Mostra dados JSON da imagem | A imagem está disponível localmente. |
| Retorna `No such object` | A imagem ainda não foi baixada. |
| Retorna `500 Internal Server Error` | O Docker falhou ao consultar a imagem local. Faça o pull manual. |

## Como reparar

Baixe manualmente a imagem:

```powershell
docker pull public.ecr.aws/supabase/edge-runtime:v1.74.1
```

Depois confirme:

```powershell
docker image inspect public.ecr.aws/supabase/edge-runtime:v1.74.1
```

Resultado esperado: deve aparecer uma estrutura JSON contendo campos como:

```text
RepoTags
RepoDigests
Architecture
Os
Size
RootFS
```

Depois repita o deploy:

```powershell
cd "D:\Fabricio\Projetos SaaS\Indica-controle"
npm run fn:deploy:forecast
```

---

# Erro 2 — Docker pede compartilhamento da pasta

## Janela típica

O Docker Desktop mostra uma mensagem parecida com:

```text
Docker wants to access:
D:\Fabricio\Projetos SaaS\Indica-controle\supabase\functions

Do you want to share it?
```

## O que isso significa

O Supabase CLI cria um container Docker para empacotar a Edge Function. Esse container precisa acessar a pasta local:

```text
D:\Fabricio\Projetos SaaS\Indica-controle\supabase\functions
```

Sem permissão de acesso, o Docker não consegue montar os arquivos da função dentro do container.

## O que fazer

Clique em:

```text
Yes
```

Depois espere alguns segundos para o Docker aplicar a permissão e execute o deploy novamente.

```powershell
cd "D:\Fabricio\Projetos SaaS\Indica-controle"
npm run fn:deploy:forecast
```

---

# Erro 3 — EOF ao criar o container

## Mensagem típica

```text
failed to create docker container:
error during connect:
Post ".../containers/create": EOF
```

## Causa mais provável

Esse erro pode ocorrer quando o Docker Desktop está pedindo autorização para compartilhar a pasta e a CLI tenta criar o container antes de a autorização ser concluída.

Também pode acontecer quando o Docker Desktop reinicia ou perde a comunicação momentaneamente com o engine Linux.

## Reparação imediata

1. Clique em **Yes** caso o Docker peça acesso à pasta.
2. Aguarde de 10 a 20 segundos.
3. Feche o terminal que executou o comando anterior.
4. Abra um PowerShell novo.
5. Rode novamente:

```powershell
cd "D:\Fabricio\Projetos SaaS\Indica-controle"
npm run fn:deploy:forecast
```

## Teste de montagem da pasta

Antes de repetir o deploy, confira se o container consegue ler a pasta de funções:

```powershell
docker run --rm -v "D:\Fabricio\Projetos SaaS\Indica-controle\supabase\functions:/functions:ro" alpine ls -la /functions
```

Resultado esperado: devem aparecer pastas como:

```text
_shared
import_project_forecast
get_project_forecast_template
import_project_activity_forecast
```

Se as pastas forem listadas, o Docker já tem acesso ao código local.

---

# Quando reiniciar o Docker Desktop

Reinicie o Docker Desktop quando ocorrer qualquer um destes cenários:

- `docker version` não mostra a seção `Server`;
- `docker info` dá erro;
- `docker image inspect` retorna `500` mesmo após baixar a imagem;
- o teste de montagem da pasta falha;
- o erro `EOF` continua mesmo após autorizar o compartilhamento;
- a janela de compartilhamento some, mas o Docker continua sem acesso à pasta.

## Comando de reinício

```powershell
docker desktop restart
```

Depois aguarde o Docker voltar e confirme:

```powershell
docker desktop status
docker version
```

Em seguida, teste novamente a montagem e o deploy.

---

# Quando encerrar o WSL

Use este procedimento apenas se reiniciar o Docker não resolver.

## 1. Fechar o Docker Desktop

Feche pelo ícone próximo ao relógio do Windows, usando a opção de sair.

## 2. Encerrar o WSL

```powershell
wsl --shutdown
```

## 3. Abrir o Docker Desktop novamente

Aguarde até o status ficar `running`.

## 4. Verificar o Docker

```powershell
docker version
docker info
```

## 5. Repetir o deploy

```powershell
cd "D:\Fabricio\Projetos SaaS\Indica-controle"
npm run fn:deploy:forecast
```

---

# Verificar rede, proxy e download da imagem

O Docker pode usar proxy interno para acessar registries públicos. Confira isso com:

```powershell
docker info
```

Procure por linhas como:

```text
HTTP Proxy:
HTTPS Proxy:
```

Para testar se o Docker consegue baixar o runtime do Supabase:

```powershell
docker pull public.ecr.aws/supabase/edge-runtime:v1.74.1
```

## Interpretação

| Resultado | Diagnóstico |
|---|---|
| Download concluído | Rede, proxy e acesso ao registry estão funcionando. |
| `timeout`, `TLS`, `x509` | Possível proxy, firewall, antivírus ou problema de certificado. |
| `connection refused` | Docker Desktop ou proxy interno não está respondendo. |
| `unauthorized` | Problema de autenticação no registry, incomum para essa imagem pública. |

---

# Ver logs do Docker Desktop

## Logs pelo comando do Docker

```powershell
docker desktop logs
```

Para salvar somente erros mais relevantes na Área de Trabalho:

```powershell
docker desktop logs 2>&1 |
  Select-String -Pattern "error|fatal|500|edge-runtime|public.ecr.aws|proxy|image|wsl" |
  Set-Content "$HOME\Desktop\docker-erros-filtrados.txt"
```

## Diagnóstico completo

```powershell
docker desktop diagnose
```

> Revise o conteúdo antes de enviar logs para terceiros. Eles podem conter caminhos locais, nomes de projetos e detalhes do ambiente.

---

# Alternativa estável: deploy sem Docker

Quando o objetivo for apenas publicar uma Edge Function, é possível usar o bundle remoto pela API do Supabase.

```powershell
npx supabase functions deploy import_project_forecast --project-ref lcusxnhhrjosxqgiphgp --use-api
```

Esse modo:

- não cria container local;
- não precisa compartilhar pastas com o Docker;
- não depende da imagem `edge-runtime` local;
- evita erros do Docker Desktop/WSL.

## Script recomendado para deploy sem Docker

No `package.json`:

```json
{
  "scripts": {
    "fn:deploy:forecast": "npm run db:check-link && npx supabase functions deploy import_project_forecast --project-ref lcusxnhhrjosxqgiphgp --use-api"
  }
}
```

Depois, o uso permanece igual:

```powershell
npm run fn:deploy:forecast
```

---

# Checklist de verificação

## Antes do deploy

- [ ] Estou na pasta `D:\Fabricio\Projetos SaaS\Indica-controle`.
- [ ] `npm run db:check-link` confirmou o ref `lcusxnhhrjosxqgiphgp`.
- [ ] O Docker Desktop está com status `running`.
- [ ] `docker version` mostra Client e Server.
- [ ] O contexto ativo é `desktop-linux`.
- [ ] O engine ativo é `linux`.
- [ ] A pasta `supabase/functions` pode ser montada em um container.
- [ ] A imagem `public.ecr.aws/supabase/edge-runtime:v1.74.1` está disponível ou pode ser baixada.

## Durante o deploy

- [ ] Se o Docker pedir acesso à pasta, cliquei em `Yes`.
- [ ] O comando passou de `Bundling Function`.
- [ ] O comando mostrou `Deploying Function`.

## Após o deploy

- [ ] Apareceu `Deployed Functions on project ...`.
- [ ] Foi feito um teste pequeno no sistema.
- [ ] Os logs da Edge Function foram verificados no Supabase Dashboard.
- [ ] Não houve duplicidade nem gravação indevida nos dados.

---

# Regra de decisão rápida

| Situação | Ação |
|---|---|
| `403` ao listar/publicar funções | Fazer `npx supabase login` e testar `npx supabase functions list`. |
| `500` ao inspecionar imagem | Fazer `docker pull public.ecr.aws/supabase/edge-runtime:v1.74.1`. |
| Docker pede acesso à pasta | Clicar em `Yes` e repetir o deploy. |
| `EOF` ao criar container | Autorizar a pasta, aguardar e abrir terminal novo. |
| Docker continua falhando | `docker desktop restart`; se necessário, `wsl --shutdown`. |
| Só precisa publicar rapidamente | Usar `--use-api`. |
| Deploy mostra `Deployed Functions` | Publicação concluída. Testar a função e conferir logs. |
