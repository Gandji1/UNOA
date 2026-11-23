# Architecture du dépôt UNOA

Carte de lecture du code. Les règles fonctionnelles restent celles du TDR et de
ses annexes ; ce document dit **où** elles sont implémentées. À mettre à jour à
chaque lot qui ajoute un module, une table ou une route.

## 1. Principes

1. **Plateforme multi-établissements configurable.** Une installation sert
   plusieurs établissements. Chaque site public est rattaché à une portée
   (plateforme, territoire ou établissement), joint par ses noms d'hôte, et ne
   montre que les données publiées de sa portée.
2. **Aucun contenu en dur.** Le code ne contient ni nom d'établissement, ni
   formation, ni faculté, ni barème, ni texte institutionnel. Il ne contient que
   des libellés d'interface (boutons, titres d'écrans), destinés à
   l'internationalisation (module I18N). Marque, accroche, textes d'accueil,
   mentions légales, structures, programmes et cours sont des données créées par
   l'administration habilitée.
3. **Le serveur et la base décident.** Chaque action est autorisée par
   `unoa.has_scope_permission` (portée, période, révocation) ou par une relation
   (membre d'une offre de cours). Les invariants métier (versions immuables,
   double validation, absence de cycle, historique conservé) sont des contraintes
   et déclencheurs PostgreSQL : une erreur applicative ne peut pas les contourner.
4. **Tout acte sensible est audité** dans `unoa.audit_event`, en ajout seul,
   dans la même transaction que l'acte ; chaque refus d'accès aussi.

## 2. Arborescence

```text
apps/web/                     Application Next.js : pages, API /api/v1, serveur
  app/                        Écrans (routes) — voir §4
  app/api/v1/<module>/        Routes HTTP, une par module, sans logique métier
  lib/shared/validation.ts    Validation commune (Problem, ensure, formats)
  lib/server/                 Socle serveur : db.ts (transactions, audit),
                              route.ts (pipeline HTTP unique), request.ts,
                              responses.ts (JSON privé, problème normalisé)
  lib/<module>/               Logique métier par module (tableau §3)
  test/recette.test.mjs       Recette HTTP : base éphémère, OIDC de recette
  test/fixtures/              Un scénario par module, données fictives
packages/db/                  Migrations SQL numérotées, exécuteur, tests
packages/domain/              Règles pures sans E/S (maquette, apprentissage, fuseaux)
packages/config/              Résolution des paramètres hiérarchiques
infra/postgres/               Rôle web : préparation, droits, contrôle
tests/e2e/                    Sondes contre un serveur démarré
automation/                   Contrôle de traçabilité TDR ↔ matrice
docs/                         TDR et annexes, ADR, lots (docs/lots), registres
prototype/                    Maquette visuelle de référence (non exécutée)
```

## 3. Modules

| Code TDR | Dossier `lib/` | Migrations | Routes API | Écrans |
|---|---|---|---|---|
| IAM | `iam/` | 0002, 0003 | `/auth/*`, `/me`, `/access/check` | `/connexion`, `/espace` |
| CFG | `config/` | 0004 | `/config/*` | `/administration/parametres` |
| TEN | `territory/` | 0001, 0005 | `/territories/*` | `/administration/territoires` |
| ORG | `org/` | 0006 | `/org/*`, `/public/organisation` | `/administration/structures`, `/structures` |
| CAT | `catalog/` (access, references, programs, curriculum, public) | 0007 | `/catalog/*`, `/public/programs/*` | `/administration/catalogue`, `/formations` |
| LMS | `lms/` (studio, offerings, forum) | 0008 | `/lms/*` | `/administration/cours`, `/apprendre` |
| LIVE | `live/` (store, provider) | 0008 | `/live/*` | `/apprendre/{offre}` |
| NOT | `notifications/` (store, admin) ; `packages/jobs` ; `apps/worker` | 0008, 0012 | `/lms/notifications`, `/notifications/*`, `/jobs/run` | `/administration/notifications`, `/apprendre`, `/espace` |
| CMS | `site/` | 0009 | `/site/*` | `/administration/site`, `/`, `/mentions-legales`, `/confidentialite`, `/a-propos` |
| IAM | `iam/` (settings, oidc, sessions, navigation, admin) | 0002, 0003, 0011 | `/auth/*`, `/me`, `/iam/*` | `/administration`, `/administration/acces`, `/invitation/{jeton}`, `/espace` |
| SIS | `students/` | 0014 | `/sis/*` | `/administration/scolarite`, `/etudiant` |
| ADM | `admissions/` | 0010 | `/admissions/*`, `/admissions-documents/{id}` | `/administration/admissions`, `/candidature`, `/formations/{id}` |

## 4. Couches et dépendances

`app/` (écran ou route) → `lib/<module>` (cas d'usage, SQL paramétré) →
`lib/server` et `lib/shared` → PostgreSQL. Un module peut lire l'accès d'un
autre par sa fonction exportée (`offeringFor`, `program`, `context`), jamais par
ses tables privées. Les règles calculables sans base vivent dans
`packages/domain` et sont testées seules.

## 5. Portées et multi-établissement

`scope` porte une nature : `platform` → `territory` / `jurisdiction` →
`institution` / `centre` → `academic_unit`. La hiérarchie autorisée est une
donnée (`scope_type_parent`). Les droits sont accordés sur une portée, avec ou
sans descendants. Un site (`site`) sert une portée ; les fonctions publiques
`unoa.public_*(site)` filtrent par `unoa.scope_within`. Deux sites sur deux
hôtes de la même installation ne voient jamais les données publiques l'un de
l'autre (recette `site.fixture.mjs`).

## 6. Conventions

- Migrations additives, jamais réécrites une fois appliquées en recette ou en
  production ; les corrections passent par une nouvelle migration.
- Toute route d'écriture passe par `studioPost` : contrôle d'origine, taille,
  format, réponse JSON ou redirection 303 avec statut, audit des refus.
- Erreurs : `Problem(status, message)` ; 400 entrée, 403 droit, 404 absent,
  409 conflit d'état, 422 règle métier, 423/425/428/410 états de séance ou de
  leçon, 503 indisponibilité.
- Textes saisis par les utilisateurs : balisage restreint (`packages/domain`
  `parseMarkup`), rendu en éléments React, jamais de HTML injecté.
- Pour ajouter un module : migration + droits (`grant-web.psql`, contrôle dans
  `verify-web.psql`), `lib/<module>`, route `app/api/v1/<module>`, écran,
  scénario `test/fixtures/<module>.fixture.mjs`, ligne de ce tableau, fiche de
  lot et matrice.
