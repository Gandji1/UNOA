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

## Connexion institutionnelle

Le site public fonctionne en attendant l’activation de la connexion. La page
`/connexion` indique son état. Le raccordement suit ce parcours :

1. Appliquer les migrations sur PostgreSQL, puis créer un rôle de service
   dédié, sans privilège d’administration. Avec le compte de migration, exécuter
   `psql -v web_role=<rôle-de-service> -f infra/postgres/grant-web.psql`.
2. Enregistrer un client OIDC confidentiel auprès du fournisseur institutionnel.
   Déclarer le rappel exact `<origine-du-site>/api/v1/auth/callback` et activer
   Authorization Code, PKCE S256, RS256 et `client_secret_basic`. Définir le
   niveau d’assurance MFA reconnu par le fournisseur. Il doit être renvoyé
   dans le champ `acr` du jeton d’identité.
3. Configurer les valeurs du fichier `.env.example` dans l’environnement
   serveur Vercel, uniquement pour le site correspondant. Pour
   `UNOA_OIDC_TRANSACTION_KEY`, générer 32 octets aléatoires encodés en
   base64url. L’URL PostgreSQL du rôle de service doit inclure
   `sslmode=verify-full` en production.
4. Rattacher chaque compte habilité au couple `(issuer, subject)` vérifié dans
   `unoa.login_identity`. Vérifier la connexion sur un compte de recette,
   les autorisations par portée et la fermeture de session avant l’ouverture.

La commande `pnpm --filter @unoa/web test:iam` utilise le même serveur de
recette PostgreSQL que les autres tests d’intégration. Son compte doit pouvoir
créer une base et un rôle temporaires. L’émetteur local de recette et ses
identités fictives ne sont pas déployés.

## Paramètres et versions

Une fois le socle OIDC connecté et la migration 0004 appliquée, relancer le
script d’attribution des droits PostgreSQL du rôle web. Attribuer à chaque
groupe les permissions requises dans les portées concernées. Le point
d’entrée se trouve dans « Mon espace ».

| Permission | Effet |
|---|---|
| `config.read` | Consulte le catalogue et les versions de la portée |
| `config.define` à la racine | Crée une définition typée |
| `config.write` | Propose une valeur et la soumet à la revue |
| `config.review` | Approuve la proposition d’une autre personne |
| `config.publish` | Programme ou renvoie en revue une version approuvée |

La publication se fait depuis la prévisualisation. Les dates sont en UTC.
Le choix d’un territoire n’accorde aucun droit. Les migrations n’ajoutent
aucune définition ou valeur de démonstration.
