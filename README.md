# UNOA
Université Numérique Ouest Africaine

## Démarrage

Utiliser Node.js 24 et la version de pnpm fixée dans package.json. Depuis la racine, exécuter `pnpm install --frozen-lockfile`, puis `pnpm dev`. L’application se trouve dans apps/web. Le répertoire prototype conserve la maquette.

## Vérification

Exécuter `pnpm test`, `pnpm trace` et `pnpm build`. Démarrer le serveur compilé avec `pnpm --filter @unoa/web start --hostname 127.0.0.1 --port 3912` puis lancer `node tests/smoke.mjs` dans un second terminal.

## Livraison

Dans Vercel, relier le dépôt Gandji1/UNOA, sélectionner apps/web comme répertoire racine et master comme branche de production. Vérifier les sondes sur le domaine attribué avec UNOA_TEST_URL et le script de vérification HTTP.
