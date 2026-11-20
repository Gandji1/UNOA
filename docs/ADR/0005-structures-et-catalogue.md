# ADR-0005 — Structures académiques comme portées et catalogue versionné

**Statut :** retenue le 20 novembre 2026 (lot 007).

## Contexte
Les TdR (§4.1, §5.1, ORG, CAT) exigent des composantes librement créées, une
résolution des règles qui descend jusqu'à la faculté et au département, des
programmes dont les versions publiées sont immuables et une ouverture des
candidatures soumise à une habilitation prouvée.

## Décision
- Une composante académique est une **portée** de nature `academic_unit`. Les
  droits par portée, l'héritage de configuration et les fenêtres de présence
  s'appliquent sans hiérarchie parallèle. Les types (faculté, école, institut,
  département, laboratoire…) et leur imbrication restent des données déclarées
  dans le registre territorial. Le profil `org_unit` ajoute code, statut et
  visibilité ; seul le studio des structures crée ces portées.
- Les identifiants de portée sont immuables : un transfert crée une unité
  successeur sous la nouvelle structure mère, clôt l'ancienne et enregistre la
  filiation (`org_succession`), sans perdre les liens historiques.
- La taxonomie (domaines, filières, mentions, spécialités, parcours) est un
  arbre de types déclarés (`field_type`) distinct des structures.
- Le programme appartient à un établissement ou à une composante active. Le
  contenu de maquette porte `version_id` et des clés étrangères composites ; un
  déclencheur commun refuse toute écriture hors brouillon. Les prérequis sont
  contrôlés deux fois : en base (cycle, période antérieure) et par le moteur pur
  `packages/domain/src/curriculum.ts`, partagé par le studio, l'API et le
  simulateur public.
- Le statut réglementaire est calculé à partir de la pièce vérifiée la plus
  récente en vigueur ; un compte distinct de l'auteur la vérifie. L'ouverture
  des candidatures est refusée en base sans statut compatible, et l'affichage
  public combine l'ouverture et le statut courant (une suspension prend effet
  sans action manuelle).
- Les pages publiques lisent des fonctions `SECURITY DEFINER` qui ne renvoient
  que des versions publiées et des unités publiques actives.

## Écart au TdR §16.1
Comme dans les lots précédents, l'API reste dans les routes Next.js (pas de
NestJS séparé) : un seul déploiement Vercel, mêmes contrôles serveur. La
séparation `apps/api` reste ouverte pour l'industrialisation (ADR-0001).

## Conséquences
Pas de duplication des droits ni des règles. Les étudiants futurs (SIS)
référenceront une version publiée intacte. Les tarifs (FIN) et les événements
d'outbox (`course.version_published`…) sont à brancher dans les lots suivants.
