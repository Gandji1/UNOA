# ADR-0008 — File durable PostgreSQL et notifications multicanal

Date : 20 novembre 2026. Statut : accepté. Exigences : CORE-006, CORE-010, NOT-002 à 010, IAM-013.

## Contexte

Le TDR (§15) propose Redis et BullMQ pour les traitements asynchrones. L'hébergement retenu (Vercel +
Neon, ADR-0001/0002) n'offre pas de Redis géré sans nouveau fournisseur ni coût.

## Décision

- File durable dans PostgreSQL (`unoa.job`) : insertion dans la transaction métier (outbox), clé
  d'idempotence unique, prise en charge `FOR UPDATE SKIP LOCKED`, verrou à expiration, report
  exponentiel plafonné, état `dead` puis rejeu tracé par une personne `ops.jobs`.
- Trois moteurs de consommation du même code (`@unoa/jobs`) : `apps/worker` (hébergement continu),
  `/api/v1/jobs/run` (tâche planifiée protégée par jeton), et drainage juste après chaque écriture.
- Notifications : texte interne rendu dans la transaction ; canaux externes seulement avec consentement
  courant, coordonnée et préférence active, revérifiés à l'envoi ; événement sensible = avis générique.
- Adaptateurs : `sandbox` (boîte de recette, interdit en production), `http` (relais JSON avec jeton et
  `Idempotency-Key`). Les textes par défaut sont des gabarits du logiciel (fr, en), surchargés par les
  modèles publiés par l'administration selon la hiérarchie des portées.

## Conséquences

Pas de dépendance supplémentaire ; débit adapté à un établissement. Un passage à BullMQ reste possible
derrière la même interface. Le fournisseur réel courriel/SMS reste à contractualiser (EXT-004).
