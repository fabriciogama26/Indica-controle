$ErrorActionPreference = "Stop"

function Stop-WithMessage {
    param([string]$Message)
    Write-Host ""
    Write-Host $Message -ForegroundColor Red
    Write-Host ""
    exit 1
}

function Run-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Args
    )

    & git @Args
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Args -join ' ') falhou com exit code $LASTEXITCODE"
    }
}

Write-Host ""
Write-Host "============================================================"
Write-Host " BAIXAR REMOTO PRESERVANDO ALTERACOES LOCAIS"
Write-Host "============================================================"
Write-Host ""

try {
    $insideRepo = git rev-parse --is-inside-work-tree 2>$null
} catch {
    Stop-WithMessage "ERRO: esta pasta nao parece ser um repositorio Git."
}

if ($insideRepo -ne "true") {
    Stop-WithMessage "ERRO: esta pasta nao parece ser um repositorio Git."
}

$currentBranch = (git branch --show-current).Trim()
if ([string]::IsNullOrWhiteSpace($currentBranch)) {
    Stop-WithMessage "ERRO: HEAD destacado (detached HEAD). Sincronizacao cancelada."
}

$upstream = (git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null).Trim()
if ([string]::IsNullOrWhiteSpace($upstream)) {
    Stop-WithMessage "ERRO: a branch '$currentBranch' nao tem upstream configurado. Configure o tracking antes de sincronizar."
}

Write-Host "Branch atual : $currentBranch"
Write-Host "Upstream     : $upstream"
Write-Host ""

$dirty = git status --porcelain
$stashRef = $null

if ($dirty) {
    Write-Host "Alteracoes locais encontradas. Criando stash com arquivos nao rastreados..." -ForegroundColor Yellow
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $stashMessage = "sync-preservando-alteracoes | $currentBranch | $timestamp"

    Run-Git @("stash", "push", "--include-untracked", "--message", $stashMessage)
    $stashRef = (git stash list --format="%gd" -n 1).Trim()

    if ([string]::IsNullOrWhiteSpace($stashRef)) {
        Stop-WithMessage "ERRO: stash nao foi criado. Sincronizacao cancelada."
    }

    Write-Host "Backup criado em $stashRef." -ForegroundColor Green
} else {
    Write-Host "Working tree limpa. Nenhum stash necessario." -ForegroundColor Green
}

Write-Host ""
Write-Host "Buscando atualizacoes do remoto..."
Run-Git @("fetch", "--prune", "origin")

Write-Host ""
Write-Host "Atualizando a branch local com fast-forward apenas..."
try {
    Run-Git @("pull", "--ff-only")
} catch {
    Write-Host ""
    Write-Host "Nao foi possivel atualizar com fast-forward." -ForegroundColor Red
    if ($stashRef) {
        Write-Host "Suas alteracoes continuam guardadas em $stashRef." -ForegroundColor Yellow
        Write-Host "Para reaplicar manualmente depois: git stash apply $stashRef" -ForegroundColor Cyan
    }
    throw
}

if ($stashRef) {
    Write-Host ""
    Write-Host "Reaplicando suas alteracoes locais a partir de $stashRef..."
    try {
        Run-Git @("stash", "apply", "--index", $stashRef)
        Write-Host ""
        Write-Host "Alteracoes reaplicadas. O stash foi mantido como backup: $stashRef" -ForegroundColor Green
        Write-Host "Depois de conferir tudo, voce pode remover com: git stash drop $stashRef" -ForegroundColor Cyan
    } catch {
        Write-Host ""
        Write-Host "Houve conflito ou falha ao reaplicar o stash." -ForegroundColor Red
        Write-Host "O backup continua em $stashRef." -ForegroundColor Yellow
        Write-Host "Resolva os conflitos ou reaplique manualmente com: git stash apply $stashRef" -ForegroundColor Cyan
        throw
    }
}

Write-Host ""
Write-Host "Sincronizacao concluida." -ForegroundColor Green
Write-Host ""
git status --short --branch
