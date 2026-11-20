# ADR-0007 — Administration des accès et amorçage

Date : 20 novembre 2026. Statut : accepté. Exigences : REQ-IAM-001, 006 à 011, 014, REQ-SEC.

## Contexte

Jusqu'au lot 010, aucun compte, rôle ni attribution ne pouvait être créé sans SQL : la plateforme
n'était pas administrable depuis une base vierge (PLAN §1, MATRICE_ACCES §1 à 3, CARTOGRAPHIE IAM).

## Décision

1. **Catalogue des permissions** inséré par migration : ce sont les contrôles effectués par le code
   (technique, non académique), avec module, libellé et sensibilité. Chaque nouvelle permission
   introduite par un lot est ajoutée par sa migration.
2. **Rôles composés par l'administration** dans `/administration/acces?vue=roles` ; seul le rôle
   d'amorçage `platform_admin` est livré, protégé, et reçoit automatiquement toute nouvelle permission.
3. **Écritures par fonctions contrôlées** (`SECURITY DEFINER`) : le rôle web ne peut toujours pas écrire
   `role_grant`, `access_role`, `role_permission` ni lire l'audit directement. Les fonctions vérifient
   l'acteur de session : pas d'auto-attribution, pas d'escalade (on n'attribue ou ne compose qu'un rôle
   dont on détient toutes les permissions dans la portée), délégation ≤ 90 jours et bornée par la source,
   révocation en cascade, justification obligatoire, audit dans la même transaction.
4. **Attributions jamais réécrites** : seules la réduction de période et la révocation sont permises.
5. **Entrée des personnes** : invitation à lien personnel (empreinte SHA-256 en base, usage unique,
   ≤ 30 jours) acceptée à la connexion OIDC ; création de compte en libre accès décidée **par site**
   (candidats, apprenants), sans aucun rôle.
6. **Amorçage** : `unoa.bootstrap_platform(...)`, exécutable seulement par le propriétaire du schéma
   (`pnpm db:bootstrap` ou éditeur SQL Neon avec `--sql`), refusé dès qu'un administrateur existe.

## Conséquences

Une base vierge devient administrable sans SQL métier : amorçage → invitation des responsables →
composition des rôles → configuration académique par l'administration. L'envoi automatique des
invitations par courriel dépend d'EXT-004 ; le lien est remis par l'administrateur.
