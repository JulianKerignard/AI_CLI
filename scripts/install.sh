#!/usr/bin/env bash
# AI_CLI installer — une commande pour Mac / Linux / WSL / Git Bash Windows.
#
# Usage :
#   curl -fsSL https://chat.juliankerignard.fr/install-aicli.sh | bash
#
# Ou direct depuis le repo :
#   curl -fsSL https://raw.githubusercontent.com/JulianKerignard/AI_CLI/main/scripts/install.sh | bash
#
# Prérequis : Node.js 18+ (le script propose un install si absent).

set -e

# Tarball npm pré-packé sur GitHub Releases : install direct sans
# git clone, sans pack local, plus rapide.
TARBALL_URL="https://github.com/JulianKerignard/AI_CLI/releases/latest/download/aicli-0.1.0.tgz"

# Couleurs ANSI pour un output lisible.
RED=$'\e[31m'
GREEN=$'\e[32m'
YELLOW=$'\e[33m'
BLUE=$'\e[34m'
RESET=$'\e[0m'
BOLD=$'\e[1m'

printf "${BOLD}${BLUE}AI_CLI installer${RESET}\n\n"

# 1. Check Node >= 18.
if ! command -v node >/dev/null 2>&1; then
  printf "${RED}Node.js n'est pas installé.${RESET}\n"
  printf "Installe-le depuis https://nodejs.org/ ou via nvm :\n"
  printf "  ${YELLOW}curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash${RESET}\n"
  printf "  ${YELLOW}nvm install 20${RESET}\n"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  printf "${RED}Node.js $NODE_VERSION est trop ancien (requis : >= 18).${RESET}\n"
  printf "Upgrade via ${YELLOW}nvm install 20${RESET} ou https://nodejs.org/\n"
  exit 1
fi

printf "${GREEN}✓${RESET} Node $(node -v) détecté\n"

# 2. Check npm.
if ! command -v npm >/dev/null 2>&1; then
  printf "${RED}npm n'est pas installé (devrait venir avec Node).${RESET}\n"
  exit 1
fi

printf "${GREEN}✓${RESET} npm $(npm -v) détecté\n"

printf "\n"

# 3. Download + install le tarball pré-packé.
TMPDIR=$(mktemp -d -t aicli-install.XXXXXX)
TARBALL="$TMPDIR/aicli.tgz"

printf "${BOLD}Téléchargement du package...${RESET}\n"
if ! curl -fsSL -o "$TARBALL" "$TARBALL_URL"; then
  printf "${RED}Téléchargement échoué.${RESET}\n"
  exit 1
fi

printf "${BOLD}Installation de aicli...${RESET}\n"
npm install -g "$TARBALL"

rm -rf "$TMPDIR"

printf "\n"

# 5. Vérif.
if command -v aicli >/dev/null 2>&1; then
  printf "${GREEN}${BOLD}✓ AI_CLI installé avec succès !${RESET}\n\n"
  printf "Lance-le : ${YELLOW}aicli${RESET}\n"
  printf "Configure la connexion : ${YELLOW}aicli${RESET} puis ${YELLOW}/login${RESET}\n"
  printf "Liste des commandes : ${YELLOW}/help${RESET}\n"
else
  printf "${YELLOW}⚠ aicli n'est pas dans le PATH.${RESET}\n"
  printf "Ajoute ${BOLD}$(npm prefix -g)/bin${RESET} à ton PATH, ou lance via :\n"
  printf "  ${YELLOW}$(npm prefix -g)/bin/aicli${RESET}\n"
fi
