# ADR-0015 — Remise à zéro de la base en mode développement

Date : 25 novembre 2026. Statut : accepté (décision du propriétaire). Exigences : OPS, IAM-001, CLAUDE.md §1 (aucune donnée provisoire en production).

## Décision

Pendant le développement, le propriétaire peut repartir d'une base vide : `POST /api/v1/installation/reset`
supprime tous les objets UNOA (schémas `unoa` et `unoa_meta`), réapplique migrations et droits du rôle web,
puis installe un seul super-administrateur (identifiant et mot de passe choisis, mode développement actif).
Conditions cumulatives : jeton d'installation (seule son empreinte est dans le code), mode développement
actif, phrase de confirmation exacte, mode intégration (adresse propriétaire). Rien n'est journalisé
puisque le journal est lui-même effacé ; l'opération est consignée dans le journal d'implémentation.

## Conséquences

À supprimer ou désactiver avec le retour des verrous (fin du mode développement) : l'opération est refusée
dès que le mode développement est désactivé.
