# supabase-check-link.ps1
# Verifica se o Supabase CLI esta linkado ao projeto correto antes de comandos criticos.
# Executar antes de: migration list, db lint, db push.

$expectedRef = "lcusxnhhrjosxqgiphgp"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$legacyStateFile = Join-Path $repoRoot ".supabase\state.toml"
$projectRefFile = Join-Path $repoRoot "supabase\.temp\project-ref"
$linkedProjectFile = Join-Path $repoRoot "supabase\.temp\linked-project.json"

$currentRef = $null
$source = $null

if (Test-Path $projectRefFile) {
    $currentRef = (Get-Content $projectRefFile -Raw -ErrorAction SilentlyContinue).Trim()
    $source = "supabase/.temp/project-ref"
} elseif (Test-Path $legacyStateFile) {
    $content = Get-Content $legacyStateFile -Raw -ErrorAction SilentlyContinue
    if ($content -match 'project_ref\s*=\s*"([^"]+)"') {
        $currentRef = $matches[1]
    } elseif ($content -and $content.Contains($expectedRef)) {
        $currentRef = $expectedRef
    }
    $source = ".supabase/state.toml"
}

if (-not $currentRef) {
    Write-Host ""
    Write-Host "ERRO: Supabase CLI nao esta linkado a nenhum projeto." -ForegroundColor Red
    Write-Host ""
    Write-Host "Execute o comando abaixo e informe a senha do banco quando solicitado:" -ForegroundColor Yellow
    Write-Host "  npm run db:link" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "O link local pode ficar em supabase/.temp/ ou .supabase/, conforme a versao do Supabase CLI." -ForegroundColor DarkGray
    exit 1
}

if ($currentRef -ne $expectedRef) {
    Write-Host ""
    Write-Host "ERRO: CLI linkado ao projeto errado." -ForegroundColor Red
    Write-Host "  Esperado : $expectedRef" -ForegroundColor Yellow
    Write-Host "  Atual    : $currentRef" -ForegroundColor Yellow
    Write-Host "  Fonte    : $source" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Execute para corrigir:" -ForegroundColor Yellow
    Write-Host "  npm run db:link" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

Write-Host "OK: CLI linkado ao projeto correto ($expectedRef)" -ForegroundColor Green

if (Test-Path $linkedProjectFile) {
    try {
        $projectInfo = Get-Content $linkedProjectFile -Raw -ErrorAction Stop | ConvertFrom-Json
        if ($projectInfo.name) {
            Write-Host "Projeto: $($projectInfo.name)" -ForegroundColor Green
        }
    } catch {
        # O arquivo e apenas informativo; o project-ref acima e a fonte de verdade.
    }
}

Write-Host "Fonte: $source" -ForegroundColor DarkGray
