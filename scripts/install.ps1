# AI_CLI installer pour Windows PowerShell.
#
# Usage :
#   iwr -useb https://chat.juliankerignard.fr/install-aicli.ps1 | iex
#
# Strategie : installe aicli dans $HOME\.aicli (hors AppData) pour eviter
# Windows Defender qui mange des fichiers dans AppData\Roaming\npm. Ajoute
# automatiquement le dossier au PATH user (persistant). Pas besoin d'admin.

$ErrorActionPreference = "Stop"

Write-Host "AI_CLI installer" -ForegroundColor Blue
Write-Host ""

function Test-Command($cmd) {
  try { Get-Command $cmd -ErrorAction Stop | Out-Null; return $true }
  catch { return $false }
}

# 1. Check Node.
if (-not (Test-Command "node")) {
  Write-Host "Node.js n'est pas installe." -ForegroundColor Red
  Write-Host "Installe via : winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
  exit 1
}
$nodeMajor = [int](((node -v) -replace "v", "").Split(".")[0])
if ($nodeMajor -lt 18) {
  Write-Host "Node $nodeMajor trop ancien (requis >= 18)." -ForegroundColor Red
  exit 1
}
Write-Host "OK Node $(node -v)" -ForegroundColor Green

# 2. Prefix npm custom hors AppData.
$installDir = Join-Path $env:USERPROFILE ".aicli"
$binDir = $installDir
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

# 3. Clean previous installs (peuvent etre verrouillees par Defender).
Write-Host "Nettoyage installs precedentes..." -ForegroundColor White
npm uninstall -g aicli 2>&1 | Out-Null
npm uninstall -g "@juliank./aicli" 2>&1 | Out-Null
Remove-Item -Recurse -Force "$env:APPDATA\npm\node_modules\aicli" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:APPDATA\npm\node_modules\@juliank." -ErrorAction SilentlyContinue
Remove-Item -Force "$env:APPDATA\npm\aicli*" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$installDir\node_modules" -ErrorAction SilentlyContinue

# 4. Install avec prefix custom (Defender ne surveille pas $HOME\.aicli).
Write-Host "Installation de @juliank./aicli dans $installDir..." -ForegroundColor White
$env:NPM_CONFIG_PREFIX = $installDir
npm install -g "@juliank./aicli@latest" 2>&1 | Where-Object { $_ -notmatch "npm warn" } | Out-Host
if ($LASTEXITCODE -ne 0) {
  Write-Host "Install echouee." -ForegroundColor Red
  exit 1
}

# 5. Verifie que dist/index.js existe bien.
$entrypoint = Join-Path $installDir "node_modules\@juliank.\aicli\dist\index.js"
if (-not (Test-Path $entrypoint)) {
  Write-Host "dist/index.js manquant apres install (Defender ?)." -ForegroundColor Red
  Write-Host "Ajoute l'exclusion en admin :" -ForegroundColor Yellow
  Write-Host "  Add-MpPreference -ExclusionPath `"$installDir`"" -ForegroundColor Cyan
  exit 1
}

# 6. Ajoute au PATH user si pas deja present (persistant).
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$binDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$binDir;$userPath", "User")
  $env:Path = "$binDir;$env:Path"
  Write-Host "PATH mis a jour (effectif pour les nouveaux terminaux)." -ForegroundColor White
}

Write-Host ""
Write-Host "AI_CLI installe !" -ForegroundColor Green
Write-Host ""
Write-Host "Lance : aicli" -ForegroundColor Yellow
Write-Host "Login : aicli puis /login" -ForegroundColor Yellow
Write-Host ""
Write-Host "Note : si 'aicli' n'est pas reconnu, OUVRE UN NOUVEAU TERMINAL." -ForegroundColor DarkYellow
