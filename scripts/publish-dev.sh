#!/usr/bin/env bash
# Publie une version DEV (prerelease) sur npm avec le tag "dev".
# Doit être lancé depuis la branche `develop`.
#
# Usage :
#   ./scripts/publish-dev.sh
#
# Workflow :
# 1. Check branche = develop
# 2. Check working tree clean
# 3. npm version prerelease --preid=dev (0.1.0 → 0.1.1-dev.0 → 0.1.1-dev.1)
# 4. npm run build
# 5. npm publish --tag dev (2FA OTP demandé interactivement)
# 6. Push develop + tag git
#
# Les users installent la dev avec :
#   curl -fsSL https://chat.juliankerignard.fr/install-aicli-dev.sh | bash
# ou
#   npm install -g "@juliank./aicli@dev"

set -e

cd "$(dirname "$0")/.."

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "develop" ]; then
  echo "Erreur : publish-dev doit être lancé depuis la branche 'develop'."
  echo "Branche courante : $BRANCH"
  echo ""
  echo "  git checkout develop"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree dirty. Commit ou stash avant de publier."
  git status --short
  exit 1
fi

echo "=== Build ==="
npm run build

echo "=== Bump version (prerelease dev) ==="
npm version prerelease --preid=dev --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "Nouvelle version : $NEW_VERSION"

echo "=== Publish @dev ==="
npm publish --tag dev --access public

echo "=== Tag git + push develop ==="
git add package.json package-lock.json dist/.version
git commit -m "chore(dev): bump $NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "dev release $NEW_VERSION"
git push origin develop --follow-tags

echo ""
echo "Publié : @juliank./aicli@$NEW_VERSION (tag dev)"
echo ""
echo "Install dev côté user :"
echo "  curl -fsSL https://chat.juliankerignard.fr/install-aicli-dev.sh | bash"
echo "  npm install -g \"@juliank./aicli@dev\""
