# UNOA
Université Numérique Ouest Africaine

## Démarrage

Utiliser Node.js 24 et la version de pnpm fixée dans package.json. Depuis la racine, exécuter `pnpm install --frozen-lockfile`, puis `pnpm dev`. L’application se trouve dans apps/web. Le répertoire prototype conserve la maquette.

## Vérification

Exécuter `pnpm test`, `pnpm trace` et `pnpm build`. Démarrer le serveur compilé avec `pnpm --filter @unoa/web start --hostname 127.0.0.1 --port 3912` puis lancer `node tests/smoke.mjs` dans un second terminal.

## Livraison

Dans Vercel, relier le dépôt Gandji1/UNOA, sélectionner apps/web comme répertoire racine et master comme branche de production. Vérifier les sondes sur le domaine attribué avec UNOA_TEST_URL et le script de vérification HTTP.

## Base locale

Le campus public peut démarrer seul. Les migrations et la recette d’intégration
utilisent PostgreSQL 18.6. Sur un poste disposant de Docker Compose, choisir un
mot de passe local et le définir dans `UNOA_LOCAL_DB_PASSWORD`. Exécuter
`docker compose up -d --wait db`. Le port n’est accessible qu’en local.

Définir `UNOA_MIGRATION_DATABASE_URL` avec le compte de migration
`unoa_migrator`, l’hôte `127.0.0.1`, le port local et la base `unoa`. Exécuter
`pnpm db:migrate` depuis la racine. La commande peut être relancée. Conserver les
migrations appliquées et introduire les corrections dans de nouveaux fichiers SQL.

Pour `pnpm test:integration`, définir `UNOA_TEST_DATABASE_URL` avec un compte de
test autorisé à créer une base éphémère sur un serveur réservé à la recette.
Ne placer aucune URL de connexion dans le dépôt. Séparer les futurs accès
applicatifs des accès de migration.
