# check-security-definer.ps1
# Verifica estaticamente que toda migration apos a 210 com SECURITY DEFINER
# tem REVOKE de public/anon/authenticated explicito.
# Nao requer conexao com o banco. Roda sem link.

$migrationsDir = Join-Path $PSScriptRoot "..\supabase\migrations"
$hardenedFrom  = 210
$errors        = [System.Collections.Generic.List[string]]::new()
$checked       = 0

# Violations historicas corrigidas por migrations subsequentes.
# Chave = numero da migration com o problema.
$knownNoRevoke = @{
    245 = "Corrigida pela migration 250"
    259 = "Corrigida pelas migrations 278/285/298"
    260 = "Corrigida pelas migrations 278/298"
    261 = "Corrigida pelas migrations 278/298"
    262 = "Corrigida pelas migrations 278/298"
    263 = "Corrigida pelas migrations 278/298"
    269 = "Recria assinatura existente com grants preservados; sem alerta live"
}

# Migrations que fizeram grant desnecessario a authenticated.
# Corrigidas pela migration 251 (revoke de authenticated para todas).
$knownAuthGrant = @{
    212 = "Corrigida pela migration 251"
    214 = "Corrigida pela migration 251"
    216 = "Corrigida pela migration 251"
    217 = "Corrigida pela migration 230"
    218 = "Corrigida pela migration 251"
    219 = "Corrigida pela migration 251"
    243 = "Corrigida pela migration 251"
    247 = "Corrigida pela migration 251"
    253 = "Corrigida pela migration 298"
    263 = "Corrigida pela migration 298"
    278 = "Corrigida pela migration 298"
    285 = "Corrigida pela migration 298"
}

function Remove-SqlComments {
    param([string]$Sql)

    $withoutBlockComments = [regex]::Replace($Sql, '(?s)/\*.*?\*/', '')
    return [regex]::Replace($withoutBlockComments, '(?m)--.*$', '')
}

Get-ChildItem $migrationsDir -Filter "*.sql" -ErrorAction Stop | Where-Object {
    [int]($_.Name -replace '^(\d+).*', '$1') -gt $hardenedFrom
} | ForEach-Object {
    $content = Remove-SqlComments (Get-Content $_.FullName -Raw)
    if (-not ($content -imatch '\bSECURITY DEFINER\b')) { return }

    $num  = [int]($_.Name -replace '^(\d+).*', '$1')
    $name = $_.Name

    $functionBlocks = [regex]::Matches(
        $content,
        '(?is)\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\..*?(?=\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.|\z)'
    )

    $hasSecurityDefinerFunctionBlock = $false
    $hasRevoke  = $false
    $grantsAnon = $false
    $grantsAuth = $false

    foreach ($match in $functionBlocks) {
        $block = $match.Value
        if (-not ($block -imatch '\bSECURITY\s+DEFINER\b')) { continue }

        $hasSecurityDefinerFunctionBlock = $true
        $hasRevoke  = $hasRevoke  -or ($block -imatch '(?s)REVOKE\s+(ALL|EXECUTE)\b[^;]*(public|anon|authenticated)')
        $grantsAnon = $grantsAnon -or ($block -imatch '(?s)GRANT\s+EXECUTE\b[^;]*\bTO\b[^;]*\banon\b')
        $grantsAuth = $grantsAuth -or ($block -imatch '(?s)GRANT\s+EXECUTE\b[^;]*\bTO\b[^;]*\bauthenticated\b')
    }

    if (-not $hasSecurityDefinerFunctionBlock) { return }

    $checked++

    if (-not $hasRevoke -and -not $knownNoRevoke.ContainsKey($num)) {
        $errors.Add("CRITICO  [$name]  SECURITY DEFINER sem REVOKE de public/anon/authenticated")
    }
    if ($grantsAnon) {
        $errors.Add("ERRO     [$name]  GRANT EXECUTE para anon em funcao SECURITY DEFINER")
    }
    if ($grantsAuth -and -not $knownAuthGrant.ContainsKey($num)) {
        $errors.Add("ERRO     [$name]  GRANT EXECUTE para authenticated - use somente service_role")
    }
}

Write-Host ""
if ($errors.Count -gt 0) {
    Write-Host "=== FALHA: funcoes SECURITY DEFINER nao protegidas ===" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "Corrija adicionando em cada migration:" -ForegroundColor Yellow
    Write-Host "  revoke all on function public.nome_funcao(args) from public, anon, authenticated;" -ForegroundColor Cyan
    Write-Host ""
    exit 1
} else {
    Write-Host "OK: $checked migration(s) com SECURITY DEFINER verificadas - todas protegidas." -ForegroundColor Green
}
