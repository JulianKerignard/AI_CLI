# AI_CLI installer pour Windows PowerShell.
#
# Usage :
#   iwr -useb https://chat.juliankerignard.fr/install-aicli.ps1 | iex
#
# Ou direct depuis le repo :
#   iwr -useb https://raw.githubusercontent.com/JulianKerignard/AI_CLI/main/scripts/install.ps1 | iex
#
# Prérequis : Node.js 18+, npm, git.

$ErrorActionPreference = "Stop"
$Repo = "github:JulianKerignard/AI_CLI"

Write-Host "AI_CLI installer" -ForegroundColor Blue -NoNewline
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
  Write-Host "Node.js n'est pas installé." -ForegroundColor Red
  Write-Host "Télécharge depuis https://nodejs.org/ ou via winget :" -ForegroundColor Yellow
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
Write-Host "✓ Node $(node -v) détecté" -ForegroundColor Green

# 2. Check npm.
if (-not (Test-Command "npm")) {
  Write-Host "npm n'est pas installé (devrait venir avec Node)." -ForegroundColor Red
  exit 1
}
Write-Host "✓ npm $(npm -v) détecté" -ForegroundColor Green

# 3. Check git.
if (-not (Test-Command "git")) {
  Write-Host "git n'est pas installé (requis pour l'install depuis GitHub)." -ForegroundColor Red
  Write-Host "Installe via winget install Git.Git" -ForegroundColor Yellow
  exit 1
}
Write-Host "✓ git détecté" -ForegroundColor Green
Write-Host ""

# 4. Install global via npm + GitHub.
Write-Host "Installation de aicli..." -ForegroundColor White
npm install -g $Repo

Write-Host ""

# 5. Vérif.
if (Test-Command "aicli") {
  Write-Host "✓ AI_CLI installé avec succès !" -ForegroundColor Green
  Write-Host ""
  Write-Host "Lance-le : aicli" -ForegroundColor Yellow
  Write-Host "Configure la connexion : aicli puis /login" -ForegroundColor Yellow
  Write-Host "Liste des commandes : /help" -ForegroundColor Yellow
} else {
  Write-Host "⚠ aicli n'est pas dans le PATH." -ForegroundColor Yellow
  $npmPrefix = (npm prefix -g)
  Write-Host "Ajoute $npmPrefix à ton PATH, ou lance via :"
  Write-Host "  $npmPrefix\aicli.cmd"
}
