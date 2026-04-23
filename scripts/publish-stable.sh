#!/usr/bin/env bash
# Publie une version STABLE sur npm avec le tag "latest".
# Doit être lancé depuis la branche `main`.
#
# Usage :
#   ./scripts/publish-stable.sh [patch|minor|major]
#   (défaut = patch)
#
# Workflow typique :
# 1. Tu bosses sur develop, publies régulièrement en @dev (publish-dev.sh)
# 2. Quand une dev est validée : merge develop → main
# 3. Sur main : ./scripts/publish-stable.sh
#    → bump version stable (0.1.0 → 0.1.1 par défaut)
#    → publish @latest
#    → les users stable reçoivent la nouvelle version
#
# Les users installent avec :
#   curl -fsSL https://chat.juliankerignard.fr/install-aicli.sh | bash
# ou
#   npm install -g @juliank./aicli@latest

set -e

cd "$(dirname "$0")/.."

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "Erreur : publish-stable doit être lancé depuis la branche 'main'."
  echo "Branche courante : $BRANCH"
  echo ""
  echo "  git checkout main && git merge develop"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree dirty. Commit ou stash avant de publier."
  git status --short
  exit 1
fi

BUMP="${1:-patch}"
if [ "$BUMP" != "patch" ] && [ "$BUMP" != "minor" ] && [ "$BUMP" != "major" ]; then
  echo "Argument invalide : $BUMP. Utiliser patch/minor/major."
  exit 1
fi

echo "=== Build ==="
npm run build

echo "=== Bump version stable ($BUMP) ==="
npm version "$BUMP" --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "Nouvelle version : $NEW_VERSION"

echo "=== Publish @latest ==="
npm publish --access public

echo "=== Tag git + push main ==="
git add package.json package-lock.json dist/.version
git commit -m "chore(release): $NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "stable release $NEW_VERSION"
git push origin main --follow-tags

echo ""
echo "Publié : @juliank./aicli@$NEW_VERSION (tag latest)"
echo ""
echo "Users stable reçoivent la nouvelle version via :"
echo "  npm install -g @juliank./aicli@latest"
