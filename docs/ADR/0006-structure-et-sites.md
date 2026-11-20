# ADR-0006 — Structure du code et sites publics multi-établissements

**Statut :** retenue le 20 novembre 2026 (lot 009).

## Contexte
L'audit des lots 001 à 008 a relevé : textes institutionnels écrits dans le code
(contraire au §1.3), données publiques agrégées entre établissements, outils
génériques rangés dans des modules métiers, chaîne HTTP dupliquée, fichiers de
plus de 700 lignes et tests regroupés dans un fichier au nom trompeur.

## Décision
- Noyau `lib/shared` (validation) et `lib/server` (transactions, audit,
  réponses, pipeline HTTP) ; chaque module métier sous `lib/<module>` découpé
  par responsabilité ; carte dans `docs/ARCHITECTURE.md`.
- Un **site public** est une donnée : portée servie, noms d'hôte, textes
  versionnés par langue et publiés par une autre personne, mise en ligne
  explicite. Le site est résolu par l'hôte de la requête. Les fonctions
  publiques prennent le site en paramètre et filtrent sa portée.
- Sans site, l'interface reste neutre et invite à la configuration.
- Tests : recette HTTP `apps/web/test/recette.test.mjs` + `fixtures/`, tests
  unitaires dans chaque paquet, sondes dans `tests/e2e/`.

## Écart au TDR §16.2
L'arborescence cible prévoit `apps/api`, `apps/worker`, `packages/ui`,
`packages/contracts` et `packages/testing`. L'API reste dans Next.js
(ADR-0001, 0005) ; les autres paquets seront créés quand un besoin réel
apparaîtra (worker et outbox : lot CORE/WF ; contrats OpenAPI : lot INTG),
sans dossier vide anticipé.

## Conséquences
Une installation peut servir plusieurs établissements sous leurs propres
adresses et marques, sans modification du code. La lecture du dépôt suit le
tableau des modules. Les libellés d'interface restent en français en attendant
le module I18N.
