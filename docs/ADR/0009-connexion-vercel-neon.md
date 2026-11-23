# ADR-0009 — Liaison Vercel ↔ Neon par l'intégration native

Date : 20 novembre 2026. Statut : accepté. Exigences : SEC-006, OPS-002, IAM-010.

## Contexte

Le propriétaire souhaite une liaison sans jeton manuel. L'intégration Neon ↔ Vercel dépose dans Vercel
l'adresse du rôle propriétaire (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`), pas celle d'un rôle restreint.

## Décision

- Le site lit `UNOA_IAM_DATABASE_URL` (rôle restreint dédié) en priorité ; à défaut, il utilise
  l'adresse directe déposée par l'intégration ; chaque connexion du pool exécute `SET ROLE unoa_web` et
  vérifie `current_user` avant d'être confiée à l'application (le proxy Neon refuse le paramètre de
  démarrage `role`, code 22023) ; tout échec ferme la connexion (fermeture sûre). Les requêtes sont
  toutes paramétrées, ce qui écarte un `RESET ROLE` injecté. Certificat vérifié (`sslmode=verify-full`).
- Le traitement « Base Neon » accorde `unoa_web` au propriétaire avec `SET TRUE, INHERIT FALSE`
  et vérifie que la session du site est bien `unoa_web`, sans écriture directe des droits.
- L'origine publique est `UNOA_WEB_ORIGIN` ou, à défaut, l'adresse de production Vercel.
- La connexion institutionnelle (OIDC) devient facultative : sans elle, les pages publiques
  fonctionnent et la connexion affiche « non activée ».

## Conséquences

Le secret propriétaire est stocké par Vercel (chiffré, hors dépôt). Le passage à un rôle de connexion
dédié reste possible en renseignant `UNOA_IAM_DATABASE_URL`.

## Complément (23 novembre 2026)

L'intégration a relié Vercel à la base `neondb` d'une autre branche que celle migrée par GitHub, et ses
variables ne sont exposées qu'à l'exécution. La première connexion de chaque instance exécute donc
`provisionDatabase` (`packages/db/src/provision.mjs`) : migrations sous verrou consultatif, rôle `unoa_web`,
droits et 40 contrôles ; tant que ce n'est pas réussi, aucune connexion n'est servie (nouvel essai après
une minute). Les scripts SQL sont embarqués dans les fonctions (`outputFileTracingIncludes`). La même
fonction sert en ligne de commande (`pnpm --filter @unoa/db deploy`). Le workflow GitHub reste
disponible pour la base `unoa`.
