# ADR-0009 — Liaison Vercel ↔ Neon par l'intégration native

Date : 20 novembre 2026. Statut : accepté. Exigences : SEC-006, OPS-002, IAM-010.

## Contexte

Le propriétaire souhaite une liaison sans jeton manuel. L'intégration Neon ↔ Vercel dépose dans Vercel
l'adresse du rôle propriétaire (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`), pas celle d'un rôle restreint.

## Décision

- Le site lit `UNOA_IAM_DATABASE_URL` (rôle restreint dédié) en priorité ; à défaut, il utilise
  l'adresse directe déposée par l'intégration et ouvre chaque session avec le paramètre de démarrage
  `role=unoa_web` : toutes les requêtes s'exécutent avec les seuls droits du rôle web ; un rôle invalide
  fait échouer la connexion (fermeture sûre). Certificat vérifié (`sslmode=verify-full`).
- Le traitement « Base Neon » accorde `unoa_web` au propriétaire avec `SET TRUE, INHERIT FALSE`
  et vérifie que la session du site est bien `unoa_web`, sans écriture directe des droits.
- L'origine publique est `UNOA_WEB_ORIGIN` ou, à défaut, l'adresse de production Vercel.
- La connexion institutionnelle (OIDC) devient facultative : sans elle, les pages publiques
  fonctionnent et la connexion affiche « non activée ».

## Conséquences

Le secret propriétaire est stocké par Vercel (chiffré, hors dépôt). Le passage à un rôle de connexion
dédié reste possible en renseignant `UNOA_IAM_DATABASE_URL`.
