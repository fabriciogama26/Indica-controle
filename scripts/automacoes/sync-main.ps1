$ErrorActionPreference = "Stop"

function Pause-Exit {
    param([string]$Message = "Pressione Enter para fechar.")
    Write-Host ""
    Read-Host $Message | Out-Null
    exit
}

Write-Host ""
Write-Host "============================================================"
Write-Host " SINCRONIZAR MAIN LOCAL COM origin/main"
Write-Host "============================================================"
Write-Host ""

# Garante que o script esta sendo executado dentro de um repositorio Git.
try {
    $insideRepo = git rev-parse --is-inside-work-tree 2>$null
} catch {
    Write-Host "ERRO: esta pasta nao parece ser um repositorio Git." -ForegroundColor Red
    Pause-Exit
}

if ($insideRepo -ne "true") {
    Write-Host "ERRO: esta pasta nao parece ser um repositorio Git." -ForegroundColor Red
    Pause-Exit
}

$currentBranch = (git branch --show-current).Trim()

if ([string]::IsNullOrWhiteSpace($currentBranch)) {
    Write-Host "ERRO: HEAD destacado (detached HEAD). Sincronizacao cancelada." -ForegroundColor Red
    Pause-Exit
}

Write-Host "Branch atual: $currentBranch"

# NUNCA faz reset da branch de feature para origin/main.
if ($currentBranch -ne "main") {
    Write-Host ""
    Write-Host "ATENCAO: voce nao esta na branch main." -ForegroundColor Yellow
    Write-Host "O script NAO executara 'reset --hard origin/main' nesta branch,"
    Write-Host "pois isso poderia mover uma branch de feature para a main e causar perda de trabalho."
    Write-Host ""

    $dirty = git status --porcelain
    if ($dirty) {
        Write-Host "Tambem existem alteracoes locais nao commitadas." -ForegroundColor Yellow
        Write-Host "Salve, faça commit ou stash antes de trocar de branch."
        Pause-Exit
    }

    $switch = Read-Host "Deseja trocar para a branch main e continuar? [s/N]"
    if ($switch -notmatch '^[sS]([iI][mM])?$') {
        Write-Host "Cancelado. Nenhuma alteracao foi feita."
        Pause-Exit
    }

    git switch main
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERRO ao trocar para a branch main." -ForegroundColor Red
        Pause-Exit
    }

    $currentBranch = "main"
}

Write-Host ""
Write-Host "Este processo executara:" -ForegroundColor Cyan
Write-Host "  git fetch origin"
Write-Host "  git reset --hard origin/main"
Write-Host ""
Write-Host "Resultado: a main local ficara EXATAMENTE igual a origin/main." -ForegroundColor Cyan

$changes = git status --porcelain
if ($changes) {
    Write-Host ""
    Write-Host "ATENCAO: existem alteracoes locais NAO COMMITADAS na main:" -ForegroundColor Red
    git status --short
    Write-Host ""
    Write-Host "O reset --hard APAGARA essas alteracoes." -ForegroundColor Red
} else {
    Write-Host ""
    Write-Host "Working tree limpa: nao ha alteracoes locais nao commitadas." -ForegroundColor Green
}

Write-Host ""
$confirm = Read-Host "Deseja realmente sincronizar agora? Digite SIM para continuar"

if ($confirm -cne "SIM") {
    Write-Host ""
    Write-Host "Cancelado. Nenhuma alteracao foi feita."
    Pause-Exit
}

Write-Host ""
Write-Host "Buscando atualizacoes do GitHub..."
git fetch origin

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO no 'git fetch origin'. O reset NAO foi executado." -ForegroundColor Red
    Pause-Exit
}

# Confirma que origin/main existe antes do comando destrutivo.
git rev-parse --verify origin/main *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: origin/main nao foi encontrada. O reset NAO foi executado." -ForegroundColor Red
    Pause-Exit
}

Write-Host ""
Write-Host "Sincronizando main local..."
git reset --hard origin/main

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO no reset." -ForegroundColor Red
    Pause-Exit
}

Write-Host ""
Write-Host "Sincronizacao concluida." -ForegroundColor Green
Write-Host ""
git status
Write-Host ""
git log --oneline -1

Pause-Exit
