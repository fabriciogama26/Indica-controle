# check-view-security-invoker.ps1
# Verifica estaticamente que toda `CREATE VIEW` em `public` declara
# `security_invoker = true`. Nao requer conexao com o banco. Roda sem link.
#
# Motivo: view sem `security_invoker` executa com privilegio do owner e ignora a
# RLS das tabelas base. Producao pode estar correta por correcao manual, mas um
# ambiente reconstruido das migrations nasce vulneravel -- foi exatamente o caso
# de v_stock_conflicts / v_stock_conflict_items (007 -> removidas pela 377).

$migrationsDir = Join-Path $PSScriptRoot "..\supabase\migrations"
$errors        = [System.Collections.Generic.List[string]]::new()
$checked       = 0

# Violations historicas ja resolvidas por migrations subsequentes.
# Chave = numero da migration com o problema.
$knownFixed = @{
    7 = "v_stock_conflicts / v_stock_conflict_items removidas pela migration 377"
}

function Remove-SqlComments {
    param([string]$Sql)

    $withoutBlockComments = [regex]::Replace($Sql, '(?s)/\*.*?\*/', '')
    return [regex]::Replace($withoutBlockComments, '(?m)--.*$', '')
}

Get-ChildItem $migrationsDir -Filter "*.sql" -ErrorAction Stop | ForEach-Object {
    $content = Remove-SqlComments (Get-Content $_.FullName -Raw)
    if (-not ($content -imatch '(?s)\bCREATE\s+(OR\s+REPLACE\s+)?VIEW\b')) { return }

    $num  = [int]($_.Name -replace '^(\d+).*', '$1')
    $name = $_.Name

    # Cada bloco vai do CREATE VIEW ate o proximo CREATE VIEW ou o fim do arquivo.
    $viewBlocks = [regex]::Matches(
        $content,
        '(?is)\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?(\w+)\b(.*?)(?=\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b|\z)'
    )

    foreach ($match in $viewBlocks) {
        $viewName = $match.Groups[1].Value
        # So a parte antes do AS carrega as opcoes da view.
        $head = ($match.Groups[2].Value -split '(?i)\bAS\b', 2)[0]

        $checked++

        if (-not ($head -imatch 'security_invoker\s*=\s*true')) {
            if ($knownFixed.ContainsKey($num)) { continue }
            $errors.Add("CRITICO  [$name]  view public.$viewName criada sem security_invoker = true")
        }
    }

    # Materialized view nao suporta security_invoker e nunca aplica RLS.
    if ($content -imatch '(?s)\bCREATE\s+(OR\s+REPLACE\s+)?MATERIALIZED\s+VIEW\b') {
        $errors.Add("ATENCAO  [$name]  MATERIALIZED VIEW nao aplica RLS - exige revoke de anon/authenticated e filtro por tenant no servidor (regra 25)")
    }
}

Write-Host ""
if ($errors.Count -gt 0) {
    Write-Host "=== FALHA: views sem security_invoker ===" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "Corrija declarando a opcao na criacao da view:" -ForegroundColor Yellow
    Write-Host "  create view public.nome_view with (security_invoker = true) as ..." -ForegroundColor Cyan
    Write-Host ""
    exit 1
} else {
    Write-Host "OK: $checked view(s) verificadas em migrations - todas com security_invoker." -ForegroundColor Green
}
