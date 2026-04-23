#!/usr/bin/env bash
# Publie une version DEV (prerelease) sur npm avec le tag "dev".
# Les users stables continuent de recevoir @latest sans impact.
#
# Usage :
#   ./scripts/publish-dev.sh
#
# Ce que ça fait :
# 1. npm version prerelease --preid=dev (ex: 0.1.0 → 0.1.1-dev.0, puis → 0.1.1-dev.1)
# 2. npm run build
# 3. npm publish --tag dev
# 4. git push --follow-tags (propage le tag sur GitHub)
#
# Les users installent la dev avec :
#   npm install -g "@juliank./aicli@dev"
# ou via le one-liner install-dev (curl/iwr).

set -e

cd "$(dirname "$0")/.."

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

echo "=== Tag git + push ==="
git add package.json
git commit -m "chore(dev): bump $NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "dev release $NEW_VERSION"
git push origin main --follow-tags

echo ""
echo "Publié : @juliank./aicli@$NEW_VERSION (tag dev)"
echo ""
echo "Install dev côté user :"
echo "  npm install -g \"@juliank./aicli@dev\""
echo ""
echo "Ou re-point latest vers une version stable :"
echo "  npm dist-tag add \"@juliank./aicli@X.Y.Z\" latest"
