# Runbook — Deploy de Edge Functions no Supabase

> Fusão de `GUIA_DEPLOY_EDGE_FUNCTIONS_SUPABASE.md` + `GUIA_DOCKER_SUPABASE_VERIFICAR_E_REPARAR.md` (originais arquivados em `_archive/docs/`). Objetivo: fazer deploy de uma Edge Function do projeto **Indica Controle** no Supabase evitando falhas de autenticação/permissão (403), Docker Desktop local, projeto Supabase errado, ou deploy sem confirmação.

## Dados do projeto

| Item | Valor |
|---|---|
| Projeto Supabase | `indicadatesupabase` |
| Project ref | `lcusxnhhrjosxqgiphgp` |
| Caminho local | `D:\Fabricio\Projetos SaaS\Indica-controle` |
| Exemplo de função | `import_project_forecast` |
| Imagem usada no bundle (modo Docker) | `public.ecr.aws/supabase/edge-runtime:v1.74.1` |
| Método recomendado de deploy | `--use-api` (evita depender do Docker Desktop) |

> Nunca usar ou compartilhar o token da Supabase CLI, links de login temporários ou valores de `.env`.

---

## Fluxo normal de deploy (recomendado: sem Docker)

```powershell
cd "D:\Fabricio\Projetos SaaS\Indica-controle"

# 1. Confirmar que o projeto local está ligado ao Supabase correto
npm run db:check-link
```

Resultado esperado:
```text
OK: CLI linkado ao projeto correto (lcusxnhhrjosxqgiphgp)
Projeto: indicadatesupabase
Fonte: supabase/.temp/project-ref
```
Se o `project-ref` for diferente de `lcusxnhhrjosxqgiphgp`, **parar** — não fazer deploy antes de corrigir o vínculo.

```powershell
# 2. Confirmar que a função existe localmente
Test-Path "supabase/functions/import_project_forecast/index.ts"   # esperado: True

# 3. Deploy via API (não depende de Docker)
npx supabase functions deploy import_project_forecast --project-ref lcusxnhhrjosxqgiphgp --use-api
```

Resultado esperado:
```text
Deployed Functions on project lcusxnhhrjosxqgiphgp: import_project_forecast
```

Script recomendado em `package.json` (já existente): `npm run fn:deploy:forecast`.

Depois do deploy: validar no sistema com uma importação pequena e conferir os logs da função no Dashboard do Supabase (`Project > Edge Functions > <funcao> > Logs`).

---

## Erro 1 — 403 ao listar ou publicar Functions

```text
unexpected list functions status 403:
Your account does not have the necessary privileges to access this endpoint.
```

Não tem relação com o código da função, RLS, `service_role` ou banco — é autenticação/permissão da CLI.

```powershell
npx supabase projects list        # confirmar que lcusxnhhrjosxqgiphgp aparece na lista
npx supabase login                # se não aparecer, logar com a conta correta
npx supabase functions list --project-ref lcusxnhhrjosxqgiphgp   # deve listar sem erro 403
npm run fn:deploy:forecast        # repetir o deploy
```

---

## Erro 2 — Docker Desktop / edge-runtime (só relevante se NÃO usar `--use-api`)

```text
failed to inspect docker image:
request returned 500 Internal Server Error
```
ou
```text
failed to create docker container:
error during connect: Post ".../containers/create": EOF
```

### Diagnóstico

```powershell
docker desktop status
docker version
docker info
docker context ls        # esperado: asterisco em "desktop-linux"
docker desktop engine ls # esperado: asterisco em "linux" (se estiver em "windows", alternar para Linux containers)
wsl -l -v
```

### Reparo — imagem do runtime ausente/corrompida (erro 500 ao inspecionar)

```powershell
$img = "public.ecr.aws/supabase/edge-runtime:v1.74.1"
docker image inspect $img   # "No such object" = não baixada; "500" = falha ao consultar cache local
docker pull $img
docker image inspect $img   # confirmar RepoTags/Architecture/Os/Size
```

### Reparo — Docker pede compartilhamento da pasta

Se aparecer a janela pedindo acesso a `...\Indica-controle\supabase\functions`, clicar **Yes**, aguardar alguns segundos e repetir o deploy.

### Reparo — EOF ao criar container

1. Clicar em **Yes** se pedir acesso à pasta.
2. Aguardar 10-20s, fechar o terminal, abrir um novo.
3. Testar a montagem da pasta antes de repetir:
   ```powershell
   docker run --rm -v "D:\Fabricio\Projetos SaaS\Indica-controle\supabase\functions:/functions:ro" alpine ls -la /functions
   ```
   Esperado: listar `_shared`, `import_project_forecast`, etc.

### Quando reiniciar o Docker Desktop

Reiniciar (`docker desktop restart`) quando: `docker version` não mostra `Server`; `docker info` dá erro; `docker image inspect` continua `500` após o pull; o teste de montagem falha; o `EOF` persiste após autorizar a pasta.

Se reiniciar não resolver, encerrar o WSL:
```powershell
wsl --shutdown
# reabrir o Docker Desktop, aguardar "running", então:
docker version
docker info
```

### Rede/proxy

```powershell
docker info   # procurar "HTTP Proxy" / "HTTPS Proxy"
docker pull public.ecr.aws/supabase/edge-runtime:v1.74.1
```
`timeout`/`TLS`/`x509` → proxy/firewall/antivírus/certificado. `connection refused` → Docker/proxy não respondendo.

### Logs do Docker Desktop

```powershell
docker desktop logs
docker desktop diagnose
```
Revisar o conteúdo antes de enviar a terceiros — pode conter caminhos locais e detalhes do ambiente.

---

## Alternativa estável — sempre preferir

Quando o objetivo é só publicar, usar a API em vez de Docker evita todos os erros acima:

```powershell
npx supabase functions deploy import_project_forecast --project-ref lcusxnhhrjosxqgiphgp --use-api
```

Não cria container local, não precisa compartilhar pastas com o Docker, não depende da imagem `edge-runtime` local.

---

## Checklist antes de publicar

- [ ] Estou na pasta `D:\Fabricio\Projetos SaaS\Indica-controle`.
- [ ] `npm run db:check-link` confirma `lcusxnhhrjosxqgiphgp`.
- [ ] O arquivo `supabase/functions/<nome-da-funcao>/index.ts` existe.
- [ ] A alteração foi revisada; não há token/chave/`service_role` exposto no código.
- [ ] `npx supabase functions list --project-ref lcusxnhhrjosxqgiphgp` funciona sem 403.
- [ ] O comando de deploy contém `--use-api` (a menos que haja motivo documentado para usar Docker).
- [ ] Após o deploy: teste funcional pequeno + logs da função verificados no Dashboard.

## Regra de decisão rápida

| Situação | Ação |
|---|---|
| `403` ao listar/publicar funções | `npx supabase login`, depois `npx supabase functions list` |
| `500` ao inspecionar imagem | `docker pull public.ecr.aws/supabase/edge-runtime:v1.74.1` |
| Docker pede acesso à pasta | Clicar `Yes` e repetir o deploy |
| `EOF` ao criar container | Autorizar a pasta, aguardar, abrir terminal novo |
| Docker continua falhando | `docker desktop restart`; se necessário, `wsl --shutdown` |
| Só precisa publicar rapidamente | Usar `--use-api` |
| Deploy mostra `Deployed Functions` | Publicação concluída — testar e conferir logs |
