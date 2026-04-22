# AI_CLI installer pour Windows PowerShell.
#
# Usage :
#   iwr -useb https://chat.juliankerignard.fr/install-aicli.ps1 | iex
#
# Ou direct depuis le repo :
#   iwr -useb https://raw.githubusercontent.com/JulianKerignard/AI_CLI/main/scripts/install.ps1 | iex
#
# Prerequis : Node.js 18+, npm. Le CLI est publie sur npm registry
# (fiable contre Windows Defender, contrairement aux tarballs GitHub Release).

$ErrorActionPreference = "Stop"

Write-Host "AI_CLI installer" -ForegroundColor Blue
Write-Host ""

function Test-Command($cmd) {
  try {
    Get-Command $cmd -ErrorAction Stop | Out-Null
    return $true
  } catch {
    return $false
  }
}

# 1. Check Node.
if (-not (Test-Command "node")) {
  Write-Host "Node.js n'est pas installe." -ForegroundColor Red
  Write-Host "Telecharge depuis https://nodejs.org/ ou via winget :" -ForegroundColor Yellow
  Write-Host "  winget install OpenJS.NodeJS.LTS"
  exit 1
}

$nodeVersion = (node -v) -replace "v", ""
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 18) {
  Write-Host "Node.js $nodeMajor est trop ancien (requis : >= 18)." -ForegroundColor Red
  Write-Host "Upgrade via winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
  exit 1
}
Write-Host "OK Node $(node -v) detecte" -ForegroundColor Green

# 2. Check npm.
if (-not (Test-Command "npm")) {
  Write-Host "npm n'est pas installe (devrait venir avec Node)." -ForegroundColor Red
  exit 1
}
Write-Host "OK npm $(npm -v) detecte" -ForegroundColor Green
Write-Host ""

# 3. Desinstalle silencieusement toute version precedente cassee
# (les v0.1.x installees via tarball GitHub ont souffert de Defender mangeant dist/).
if (Test-Command "aicli") {
  Write-Host "Version precedente detectee, nettoyage..." -ForegroundColor White
  npm uninstall -g aicli 2>&1 | Out-Null
}

# 4. Install depuis npm registry (whitelist Defender/SmartScreen).
Write-Host "Installation depuis npm registry..." -ForegroundColor White
npm install -g aicli@latest
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Install echoue. Essaye :" -ForegroundColor Red
  Write-Host "  npm cache clean --force" -ForegroundColor Yellow
  Write-Host "  npm install -g aicli@latest" -ForegroundColor Yellow
  exit 1
}

Write-Host ""

# 5. Verif.
if (Test-Command "aicli") {
  Write-Host "AI_CLI installe avec succes !" -ForegroundColor Green
  Write-Host ""
  Write-Host "Lance-le : aicli" -ForegroundColor Yellow
  Write-Host "Configure la connexion : aicli puis /login" -ForegroundColor Yellow
  Write-Host "Liste des commandes : /help" -ForegroundColor Yellow
} else {
  Write-Host "aicli n'est pas dans le PATH." -ForegroundColor Yellow
  $npmPrefix = (npm prefix -g)
  Write-Host "Ajoute $npmPrefix a ton PATH, ou lance via :"
  Write-Host "  $npmPrefix\aicli.cmd"
}
