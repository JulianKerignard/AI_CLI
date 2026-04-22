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
# Tarball npm pré-packé : install direct sans git clone, sans pack local,
# sans problème Windows Defender qui interfère pendant l'extraction.
$TarballUrl = "https://github.com/JulianKerignard/AI_CLI/releases/latest/download/aicli-0.1.0.tgz"

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

Write-Host ""

# 3. Télécharge le tarball + install.
$tmpDir = Join-Path $env:TEMP "aicli-install-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$tarballPath = Join-Path $tmpDir "aicli.tgz"

Write-Host "Téléchargement du package..." -ForegroundColor White
try {
  Invoke-WebRequest -Uri $TarballUrl -OutFile $tarballPath -UseBasicParsing
} catch {
  Write-Host "✗ Téléchargement échoué : $_" -ForegroundColor Red
  exit 1
}

# Extraction manuelle avec tar natif (Win10+). Contourne Windows Defender qui
# intercepte l'extraction streaming de npm fichier par fichier dans AppData.
Write-Host "Extraction du package..." -ForegroundColor White
$extractDir = Join-Path $tmpDir "extracted"
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
try {
  tar -xzf $tarballPath -C $extractDir
  if ($LASTEXITCODE -ne 0) { throw "tar exit code $LASTEXITCODE" }
} catch {
  Write-Host "Extraction echouee : $_" -ForegroundColor Red
  exit 1
}

Write-Host "Installation de aicli..." -ForegroundColor White
$packageDir = Join-Path $extractDir "package"
npm install -g $packageDir

# Nettoie les fichiers temporaires.
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue

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
