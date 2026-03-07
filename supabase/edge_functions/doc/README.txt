Edge Functions

Arquivos implementados
- supabase/edge_functions/login_matricula/index.ts
- supabase/edge_functions/auth-recover/index.ts
- supabase/edge_functions/verify_admin_pin/index.ts
- supabase/edge_functions/logout/index.ts
- supabase/edge_functions/log_error/index.ts
- supabase/edge_functions/sync_run/index.ts
- supabase/edge_functions/submit_material_request/index.ts
- supabase/edge_functions/get_inventory_balance/index.ts
- supabase/edge_functions/get_project_material_balance/index.ts
- supabase/edge_functions/get_materials/index.ts
- supabase/edge_functions/get_responsaveis/index.ts

Resumo
login_matricula
- Login por matricula, senha e IMEI.

auth-recover
- Recuperacao de senha por login_name para o SaaS web.

verify_admin_pin
- Valida o PIN admin do usuario autenticado.

logout
- Fecha o registro da sessao em login_audit.

log_error
- Grava erros do app em app_error_logs.

sync_run
- Recebe resumo de sincronizacao do app.

submit_material_request
- Recebe requisicao/devolucao e chama a RPC de materiais.

get_inventory_balance
- Consulta estoque fisico.

get_project_material_balance
- Consulta saldo liquido por projeto.

get_materials
- Baixa catalogo de materiais para cache local do app.

get_responsaveis
- Baixa responsaveis permitidos: ENCARREGADO e SUPERVISOR.

Secrets obrigatorios para todas
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

Lacunas ainda nao versionadas
- nenhuma Edge Function obrigatoria do app ficou faltando

Observacao
- O que ainda depende de definicao e a modelagem final de projects.
- Fluxos web de recuperacao de senha ficam cobertos por `auth-recover`.
