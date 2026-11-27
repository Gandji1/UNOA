# ADR-0017 — Plusieurs comptes ouverts dans le même navigateur

- Date : 2026-11-27
- Statut : appliqué
- Contexte : le propriétaire veut passer d’un compte à l’autre (super-administrateur, administrateur pays, recteur, doyen, chef de département, enseignant) sans se déconnecter à chaque fois.

## Décision

- Chaque connexion ajoute son jeton de session à un cookie `unoa_accounts` (HttpOnly, Secure, SameSite=Lax, préfixe `__Host-` en HTTPS), six comptes au plus ; le compte actif reste le cookie de session habituel.
- Le menu du compte (en-tête) liste les comptes encore valides (session non expirée, non révoquée, compte actif, même époque de session), propose « Ajouter un compte » et « Se déconnecter ».
- `POST /api/v1/auth/switch` (contrôle d’origine) ne bascule que vers un jeton déjà présent et toujours valide ; sinon renvoi vers la connexion.
- « Se déconnecter » révoque seulement la session active ; s’il reste un compte ouvert, il devient actif.
- Les droits restent évalués côté serveur pour la seule session active : aucun cumul de droits entre comptes.

## Conséquences

Un poste partagé garde plusieurs comptes ouverts : se déconnecter de chacun reste nécessaire en fin d’utilisation (mention à rappeler à l’ouverture).
