# ADR-0002 — Migrations PostgreSQL

PostgreSQL 18.6 exécute des scripts SQL numérotés sous `packages/db/migrations`.
SQL rend explicites les index partiels, fonctions et triggers. Le processus
Node.js utilise le client PostgreSQL `pg` et garde ce chemin indépendant du web.
Le choix de l’ORM typé pour les futurs dépôts métier reste ouvert.

Chaque exécution acquiert un verrou consultatif transactionnel et vérifie la
suite ordonnée et les empreintes de l’historique avant de jouer les migrations
en attente. Les nouvelles migrations forment une transaction. Sur échec, les
objets et leur journal reviennent à l’état précédent. Après application, la
réversibilité repose sur une migration compensatoire ou la restauration vérifiée.

Les portées forment pour ce lot un arbre d’autorisation à racine unique. Un parent
doit précéder son enfant. Toute modification future du rattachement devra
conserver l’historique et recalculer explicitement les droits descendants.
Les juridictions et rattachements temporels multiples relèvent d’entités liées
et de migrations ultérieures.

Le propriétaire du schéma exécute les migrations. Le futur rôle applicatif
recevra des droits limités, sans propriété du schéma. Le déclencheur d’audit
rejette les modifications des lignes par SQL ordinaire. La protection contre
un administrateur de base dépend de la séparation des rôles et des sauvegardes.
