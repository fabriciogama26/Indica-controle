param(
    [string]$Destination = "D:\Indica-controle",
    [switch]$Mirror,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Stop-WithMessage {
    param([string]$Message)
    Write-Host ""
    Write-Host $Message -ForegroundColor Red
    Write-Host ""
    exit 1
}

function Test-CommandExists {
    param([string]$CommandName)
    $null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Convert-RobocopyExitCode {
    param([int]$ExitCode)

    if ($ExitCode -le 7) {
        return 0
    }

    return $ExitCode
}

if (-not (Test-CommandExists "robocopy")) {
    Stop-WithMessage "ERRO: robocopy nao foi encontrado neste Windows."
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path.TrimEnd("\")
$sourceGit = Join-Path $repoRoot ".git"
$sourcePackage = Join-Path $repoRoot "package.json"

if (-not (Test-Path -LiteralPath $sourceGit)) {
    Stop-WithMessage "ERRO: a origem nao parece ser o repositorio Indica-controle: $repoRoot"
}

if (-not (Test-Path -LiteralPath $sourcePackage)) {
    Stop-WithMessage "ERRO: package.json nao encontrado na origem: $repoRoot"
}

if ([string]::IsNullOrWhiteSpace($Destination)) {
    Stop-WithMessage "ERRO: informe uma pasta de destino."
}

$destinationRoot = $Destination.TrimEnd("\")

if ($destinationRoot -ieq $repoRoot) {
    Stop-WithMessage "ERRO: o destino nao pode ser igual a origem."
}

Write-Host ""
Write-Host "============================================================"
Write-Host " ATUALIZAR COPIA DO INDICA-CONTROLE NO HD EXTERNO"
Write-Host "============================================================"
Write-Host ""
Write-Host "Origem : $repoRoot"
Write-Host "Destino: $destinationRoot"
Write-Host ""

if ($Mirror) {
    Write-Host "Modo: ESPELHO (/MIR)." -ForegroundColor Yellow
    Write-Host "Arquivos que existirem apenas no destino poderao ser apagados." -ForegroundColor Yellow
    Write-Host ""
    $confirm = Read-Host "Digite SIM para continuar em modo espelho"

    if ($confirm -cne "SIM") {
        Write-Host ""
        Write-Host "Cancelado. Nenhuma alteracao foi feita."
        exit 0
    }
} else {
    Write-Host "Modo: atualizar novos/alterados, sem apagar arquivos extras do destino." -ForegroundColor Cyan
}

if ($DryRun) {
    Write-Host "Simulacao ativada: robocopy vai listar sem copiar." -ForegroundColor Yellow
}

if (-not $DryRun) {
    New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null
}

$excludedDirs = @(
    "node_modules",
    ".next",
    ".tmp",
    ".vercel",
    "coverage",
    "out",
    "build",
    "Backup",
    "supabase\.temp"
)

$excludedFiles = @(
    "*.tsbuildinfo",
    "next-env.d.ts",
    "*.tmp",
    "npm-debug.log*",
    "yarn-debug.log*",
    "yarn-error.log*"
)

$robocopyArgs = @(
    $repoRoot,
    $destinationRoot
)

if ($Mirror) {
    $robocopyArgs += "/MIR"
} else {
    $robocopyArgs += "/E"
}

$robocopyArgs += @(
    "/COPY:DAT",
    "/DCOPY:DAT",
    "/R:2",
    "/W:2",
    "/XD"
)

$robocopyArgs += $excludedDirs
$robocopyArgs += "/XF"
$robocopyArgs += $excludedFiles

if ($DryRun) {
    $robocopyArgs += "/L"
}

Write-Host ""
Write-Host "Executando robocopy..."
& robocopy @robocopyArgs
$robocopyExit = $LASTEXITCODE
$normalizedExit = Convert-RobocopyExitCode $robocopyExit

Write-Host ""
Write-Host "Robocopy exit code: $robocopyExit"

if ($normalizedExit -ne 0) {
    Stop-WithMessage "ERRO: robocopy encontrou falha. Verifique as mensagens acima."
}

if (-not $DryRun) {
    $safeDirectory = $destinationRoot.Replace("\", "/")
    git config --global --add safe.directory $safeDirectory

    Write-Host ""
    Write-Host "Git safe.directory configurado para: $safeDirectory" -ForegroundColor Green

    $destinationGit = Join-Path $destinationRoot ".git"
    if (Test-Path -LiteralPath $destinationGit) {
        Write-Host ""
        Write-Host "Status Git no destino:"
        git -C $destinationRoot status --short
        Write-Host ""
        Write-Host "Remote Git no destino:"
        git -C $destinationRoot remote -v
    }
}

Write-Host ""
if ($DryRun) {
    Write-Host "Simulacao concluida. Nenhum arquivo foi copiado." -ForegroundColor Green
} else {
    Write-Host "Atualizacao do HD externo concluida." -ForegroundColor Green
}
