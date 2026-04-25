# Versioning AI_CLI

Le projet suit [SemVer](https://semver.org) avec deux canaux npm :

- **`@latest`** (stable, prod) — bump manuel, releases marquées
- **`@dev`** (prerelease, staging) — bump auto à chaque push sur `develop`

## Canaux

| Canal | Tag npm | Branche source | Trigger | Bump |
|---|---|---|---|---|
| Stable | `@latest` | `main` | `workflow_dispatch` (manuel) | `patch`/`minor`/`major` au choix |
| Dev | `@dev` | `develop` | `push` (auto sur `src/**`, `package*.json`, `tsconfig`) | `prerelease --preid=dev` |

Exemple de progression :

```
0.2.0          ← stable initial
0.2.1-dev.0    ← 1er push develop après stable
0.2.1-dev.1
0.2.1-dev.2    ← itérations dev
…
0.3.0          ← merge develop → main + publish-stable bump=minor
0.3.1-dev.0    ← reprend en dev
```

## Quand bumper en patch / minor / major

| Bump | Quand | Exemples |
|---|---|---|
| **patch** | Bug fix, optim, doc, sans changement d'API ni feature | Fix d'un crash, perf interne, message corrigé |
| **minor** | Nouvelle feature, sans breaking | Nouveau tool (`AskUser`), nouvelle commande (`/fav`), nouveau flag (`--all`), favoris ajoutés |
| **major** | Breaking change | Format des credentials changé, suppression d'une commande, signature d'un tool modifiée |

Règle simple : si un user qui upgrade sans rien faire d'autre verra son flow casser → **major**. Sinon **minor** ou **patch**.

## Workflow stable (release prod)

1. Travailler sur `develop`. Chaque push publie automatiquement une `0.X.Y-dev.N` testable via `@juliank./aicli@dev`.
2. Quand un set de features/fixes est validé en dev :
   ```bash
   git checkout main
   git pull --ff-only origin main
   git merge --ff-only develop
   git push origin main
   ```
   Le push **ne déclenche pas** de release auto (pour éviter de publier sur chaque merge).
3. Déclencher la release manuellement :
   ```bash
   gh workflow run publish-stable.yml -f bump=minor
   ```
   Ou via l'UI GitHub : Actions → "Publish @latest" → Run workflow → choisir bump.
4. Le workflow :
   - Checkout main
   - `npm ci` + `tsc --noEmit` + `npm run build`
   - `npm version <bump>` (modifie package.json)
   - `npm publish` (tag implicite = `latest`)
   - Commit `chore(release): X.Y.Z [skip ci]` + tag git `vX.Y.Z` + push
5. Vérifier :
   ```bash
   npm view "@juliank./aicli" dist-tags
   # { latest: '0.3.0', dev: '0.2.1-dev.X' }
   ```

## Workflow dev (prerelease auto)

1. Push sur `develop`. Le workflow `publish-dev.yml` se déclenche si `src/**`, `package.json`, `package-lock.json`, `tsconfig.json`, ou le workflow lui-même sont modifiés.
2. Pipeline :
   - `npm ci` + `tsc --noEmit` + `npm run build`
   - `npm version prerelease --preid=dev` (0.2.1-dev.0 → 0.2.1-dev.1)
   - Rebuild après bump (le `set-version.mjs` capture le SHA git)
   - `npm publish --tag dev`
   - Commit `chore(dev): bump X.Y.Z-dev.N [skip ci]` + tag `vX.Y.Z-dev.N` + push develop
3. Le `[skip ci]` dans le commit message empêche le workflow de se re-déclencher en boucle sur son propre commit.

## Synchroniser develop avec main après une release stable

Après un `publish-stable` (qui crée `0.3.0` sur main), `develop` est en retard de 1 commit (`chore(release): 0.3.0`). Pour resynchroniser :

```bash
git checkout develop
git pull --rebase origin develop
git merge --ff-only main
git push origin develop
```

Le prochain push fonctionnel sur `develop` repartira du nouveau plancher (par ex. `0.3.1-dev.0`).

## Versions à éviter de toucher manuellement

- **Ne jamais** éditer `package.json::version` à la main et committer. Les workflows s'en chargent.
- **Ne jamais** publier `npm publish` en local : pas de typecheck, pas de tag git, pas de `[skip ci]`. Toujours via le workflow.
- **Ne jamais** force-push sur `main` : casserait l'historique des tags `vX.Y.Z`.

## Installation pour les users

```bash
# Stable (recommandé)
curl -fsSL https://chat.juliankerignard.fr/install-aicli.sh | bash       # Unix
iwr https://chat.juliankerignard.fr/install-aicli.ps1 -useb | iex          # Windows
npm install -g "@juliank./aicli@latest"                                    # via npm

# Dev (testeurs / early adopters)
curl -fsSL https://chat.juliankerignard.fr/install-aicli-dev.sh | bash
iwr https://chat.juliankerignard.fr/install-aicli-dev.ps1 -useb | iex
npm install -g "@juliank./aicli@dev"
```

Les users peuvent aussi update depuis le REPL avec `/update` (relance in-place sans `/exit`).

## Tags git

Chaque publish crée un tag git annoté :
- Stable : `vX.Y.Z` (ex: `v0.3.0`)
- Dev : `vX.Y.Z-dev.N` (ex: `v0.2.1-dev.5`)

Pour rollback à une version précédente :
```bash
git checkout v0.2.0   # navigation read-only
# ou
npm install -g "@juliank./aicli@0.2.0"   # install npm direct
```

## Contribution / commits

[Conventional Commits](https://www.conventionalcommits.org) :

| Préfixe | Usage |
|---|---|
| `feat:` | Nouvelle feature → suggère minor au prochain release |
| `fix:` | Bug fix → suggère patch |
| `perf:` | Optim de perf sans changement de comportement |
| `refactor:` | Refacto sans nouvelle feature ni fix |
| `docs:` | Documentation |
| `chore:` | Maintenance, deps, config |

Le `[skip ci]` est réservé aux commits auto des workflows publish — ne pas l'utiliser manuellement.
