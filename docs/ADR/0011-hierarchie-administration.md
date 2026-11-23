# ADR-0011 — Hiérarchie d'administration choisie par le propriétaire

Date : 23 novembre 2026. Statut : accepté. Exigences : TEN-001/002/007, IAM-006/007, ORG, CAT.

## Décision

Super-administrateur (plateforme : crée les pays) → Administrateur pays (crée les établissements et campus de son
pays) → Administrateur d'établissement / campus (crée facultés puis départements) → Doyen → Chef de département
(filières, formations, matières, nomination des enseignants) → Enseignant (cours, contenus, séances en direct).

## Conformité au TDR

- La hiérarchie reste **configurable** : « pays », « faculté », « département » sont des types de portées
  déclarés par le super-administrateur (aucun type codé) ; un autre pays peut avoir des régions intermédiaires.
- Les rôles sont des **gabarits modifiables** avec un niveau (plateforme, pays, établissement, composante) ;
  un rôle ne s'attribue qu'au niveau prévu (`unoa.role_level_allows`), avec héritage aux portées filles.
- Anti-escalade et séparation des tâches conservées : chacun ne nomme que des rôles dont il détient les
  permissions dans son périmètre ; validation et publication par une autre personne.
- Filières, formations et cours peuvent appartenir à un département actif (`academic_owner`), ce qui
  réalise « filière au sein du département » sans modèle supplémentaire.
