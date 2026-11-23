# ADR-0010 — Connexion locale sécurisée et installation unique

Date : 23 novembre 2026. Statut : accepté. Exigences : IAM-002, IAM-003, IAM-011, SEC-006.

## Contexte

ADR-0003 retient un fournisseur OIDC éprouvé, qui n'est pas encore fourni (EXT-001). Le propriétaire doit
pouvoir se connecter dès maintenant pour configurer la plateforme et recetter les écrans.

## Décision

- Connexion locale en complément d'OIDC : identifiant, mot de passe haché par scrypt (N = 2^15, sel de
  16 octets, comparaison à temps constant), code TOTP (RFC 6238) exigé pour les comptes dotés d'un secret
  (tous les administrateurs créés par installation), verrouillage 15 minutes après 5 échecs, même coût de
  calcul pour un identifiant inconnu, chaque tentative auditée, mot de passe provisoire à changer.
- Installation unique `POST /api/v1/installation` : jeton secret détenu par l'opérateur (seule son
  empreinte SHA-256 est dans le code, remplaçable par `UNOA_SETUP_TOKEN_SHA256`), refusée dès qu'un
  administrateur existe ; mot de passe et secret TOTP générés côté serveur et rendus une seule fois.
- Le rôle web ne peut ni créer ni supprimer d'identifiants (fonction `install_platform` contrôlée).

## Conséquences

Le jour où un fournisseur OIDC est configuré, il s'ajoute sans retirer la connexion locale ; la
récupération de compte locale (IAM-004) reste à livrer avec l'envoi de courriels (EXT-004).
