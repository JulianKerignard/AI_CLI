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

# Extraction + install deps dans Temp (hors AppData où Defender est agressif),
# puis install -g du dossier déjà résolu : plus rien à extraire dans AppData.
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

$packageDir = Join-Path $extractDir "package"

Write-Host "Installation des dependances (hors AppData)..." -ForegroundColor White
Push-Location $packageDir
try {
  npm install --omit=dev --no-audit --no-fund 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "npm install deps exit $LASTEXITCODE" }
} catch {
  Pop-Location
  Write-Host "Install deps echoue : $_" -ForegroundColor Red
  exit 1
}
Pop-Location

Write-Host "Installation globale de aicli..." -ForegroundColor White
npm install -g $packageDir

# Vérif que dist/index.js a bien été installé (Defender peut avoir mange le fichier).
$npmRoot = (npm root -g).Trim()
$installedIndex = Join-Path $npmRoot "aicli\dist\index.js"
$installedOk = Test-Path $installedIndex

# Nettoie les fichiers temporaires.
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue

Write-Host ""

if ($installedOk -and (Test-Command "aicli")) {
  Write-Host "AI_CLI installe avec succes !" -ForegroundColor Green
  Write-Host ""
  Write-Host "Lance-le : aicli" -ForegroundColor Yellow
  Write-Host "Configure la connexion : aicli puis /login" -ForegroundColor Yellow
  Write-Host "Liste des commandes : /help" -ForegroundColor Yellow
} elseif (-not $installedOk) {
  Write-Host "Installation incomplete : dist/index.js manquant." -ForegroundColor Red
  Write-Host ""
  Write-Host "C'est Windows Defender qui supprime les fichiers pendant l'install." -ForegroundColor Yellow
  Write-Host "Fix : ouvre PowerShell EN ADMIN et lance :" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  Add-MpPreference -ExclusionPath `"$npmRoot`"" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Puis relance ce script :" -ForegroundColor Yellow
  Write-Host "  iwr -useb https://chat.juliankerignard.fr/install-aicli.ps1 | iex" -ForegroundColor Cyan
  exit 1
} else {
  Write-Host "aicli n'est pas dans le PATH." -ForegroundColor Yellow
  $npmPrefix = (npm prefix -g)
  Write-Host "Ajoute $npmPrefix a ton PATH, ou lance via :"
  Write-Host "  $npmPrefix\aicli.cmd"
}
