# JOURNAL D'IMPLÉMENTATION

**État initial :** spécifications rédigées ; aucun logiciel fourni dans ce dossier et aucun test applicatif exécuté. Les éléments ci-dessous sont des entrées à renseigner par Claude Code pendant la réalisation.

## Template d'entrée

```markdown
### 2026-..-.. — LOT-... — <titre>
- TDR relus : <sections et IDs>
- Audit de l'existant : <constat>
- Exigences concernées : <REQ-..>
- Entités / migrations : <liste>
- Interfaces / APIs / événements : <liste>
- Vérifications exécutées : <commandes + PASS/FAIL>
- Preuves : <fichiers/logs/snapshots + commit>
- Sécurité/régions/accessibilité : <preuves>
- Décisions et ADR : <liens>
- Écarts / bugs / blocages : <liens>
- Gate Done : PASS/FAIL
```

## 19 novembre 2026 — Lot 001

Voir LOT_001.md. Compilation Next.js, cinq tests et contrôles HTTP locaux réussis. Aucune migration. Recette de production en attente.

## 19 novembre 2026 — Lot 002

- PostgreSQL 18.6. Deux migrations testées sur base vierge et peuplée, en concurrence et en réexécution. Échec transactionnel et contrôle des empreintes vérifiés.
- Deux territoires fictifs. Droits atomiques et refus transversal, descendant sans délégation explicite, expiration, révocation et compte désactivé vérifiés.
- Modification, suppression et vidage du journal d’audit refusés par PostgreSQL.
- Le site public reste opérationnel sans configuration PostgreSQL. Aucune migration appliquée à une base institutionnelle.
- Le compte applicatif, le raccordement OIDC et les écrans protégés sont à intégrer. Les exigences restent en cours.

## 19 novembre 2026 — Lot 003

- Connexion, rappel OIDC, espace connecté et déconnexion via Next.js. Routes `/api/v1/me` et `/api/v1/access/check`.
- Migration 0003, sessions à empreinte, compte de service restreint. Révocation du droit ou de la session visible sur la requête suivante.
- Tests HTTP sur PostgreSQL 18.6 et fournisseur protocolaire de recette. Voir LOT_003.md et ADR-0003.
- Fournisseur institutionnel et secret à configurer avant activation. Récupération et gestion administrative des sessions restent à traiter.

## 19 novembre 2026 — Lot 004

- Migration 0004 et studio « Paramètres et versions » pour les portées autorisées. Catalogue typé, héritage, justification, prévisualisation, revue distincte et publication datée.
- Écritures sérialisées par clé. Toute publication enregistre un événement et une trace d’audit dans PostgreSQL.
- La recette HTTP sur PostgreSQL couvre les variantes Alpha et Bêta, la provenance, les refus et la concurrence.
- L’activation du studio institutionnel dépend du raccordement OIDC et PostgreSQL mentionné au lot 003. Le moteur légal par juridiction, les snapshots et les transferts de configurations restent ouverts.

## 19 novembre 2026 — Lot 005

- Migration 0005 et studio « Territoires et implantations ». Natures de portée,
  table de hiérarchie, attributs régionaux, désignations traduites, présence datée
  et rattachements multiples motivés.
- Fuseaux contrôlés contre `pg_timezone_names`, monnaies et formats régionaux
  contre les données ICU du moteur. Aucun découpage territorial dans le code.
- Règles tenues par des déclencheurs PostgreSQL : hiérarchie non déclarée, identité
  légale hors établissement, présence hors de celle de la mère, clôture d’une portée
  avant ses filles et rattachement de nature incompatible sont refusés en base.
- Recette HTTP sur PostgreSQL 16.15 et fournisseur protocolaire de recette :
  `node --test apps/web/test/iam.test.mjs` (3 tests PASS) et
  `node --test packages/db/test/postgres.test.mjs` (7 tests PASS), `pnpm test`
  (5 PASS), `pnpm build` et `python3 automation/verifier_tracabilite.py` PASS.
  La recette précédente des lots 002 à 004 utilisait PostgreSQL 18.6 ; l’écart de
  version est consigné et la CI reste sur 18.6.
- Un agent local n’obtient aucune lecture ni écriture hors de son territoire ; chaque
  refus est inscrit dans le journal d’audit.
- Les découpages réels, juridictions, identités légales et contacts restent à fournir
  (EXT-001, EXT-002, EXT-012). REQ-TEN-008 dépend du dossier étudiant.

## 20 novembre 2026 — Lot 006

- Création du projet Neon UNOA à Francfort sur le plan gratuit et séparation de la recette et de la production.
- Migrations 0001 à 0005 appliquées sur les deux branches. Les empreintes correspondent à master. Vérification de réexécution sur la recette.
- Rôle web préparé et contrôlé sur les deux bases. Production vierge confirmée.
- Les secrets de connexion et le fournisseur OIDC restent à configurer pour la recette du parcours avec Vercel.

## 20 novembre 2026 — Lot 007

- TDR relus : §1 à 5, 16 à 24, 26 (ORG, CAT, CMS) et annexes ; fiche `LOT_007.md`, ADR-0005.
- Migrations 0006 (organisation) et 0007 (catalogue), droits du rôle web et contrôles `verify-web.psql`.
- Studios `/administration/structures` et `/administration/catalogue`, API `/api/v1/org`, `/api/v1/catalog`,
  pages publiques `/formations`, `/formations/{id}`, `/formations/comparer`, `/structures`.
- Moteur pur de maquette `packages/domain` (cohérence, cycles, bornes de crédits, simulation).
- Vérifications : unitaires 12 PASS, PostgreSQL 7 PASS, HTTP 3 PASS, build et sondes PASS, traçabilité PASS.
- Écart : recette locale sur PostgreSQL 16.15 (binaire 18.6 non installable dans l'environnement), CI sur 18.6.
- Gate Done : FAIL (E2E navigateur, accessibilité, i18n, tarifs et outbox ouverts) — exigences EN_COURS.

## 20 novembre 2026 — Lot 008

- TDR relus : §8, §14, §16.5 à 16.9, §17 à 19, modules LMS, LIVE, NOT ; fiche `LOT_008.md`.
- Migration 0008 : versions pédagogiques, modules, leçons, offres, membres, échéances, progression,
  notes privées, forum modéré, séances, événements, présences, consentements, ressources, notifications.
- Studio `/administration/cours`, portail `/apprendre` (cours, leçon avec lecteur sous-titré et chapitré,
  forum, présences), API `/api/v1/lms` et `/api/v1/live`, adaptateur de visioconférence JWT.
- Vérifications : unitaires 16 PASS, PostgreSQL 7 PASS, HTTP 4 PASS, build PASS, traçabilité PASS.
- Gate Done : FAIL (E2E navigateur, accessibilité, stockage de fichiers, fournisseur réel) — exigences EN_COURS.

## 20 novembre 2026 — Lot 009

- Audit des lots 001 à 008 (fiche `docs/lots/LOT_009.md`) et restructuration : `lib/shared`, `lib/server`,
  découpage des modules catalogue et LMS, module notifications, pipeline HTTP unique, tests par paquet.
- Contenu institutionnel retiré du code ; sites publics multi-établissements (migration 0009, studio
  `/administration/site`, pages légales par site). ADR-0006, carte `docs/ARCHITECTURE.md`.
- Vérifications : unitaires 16, PostgreSQL 7, HTTP 4, build, sonde, traçabilité : PASS.
- Gate Done : FAIL (I18N, SEO, E2E navigateur) — exigences EN_COURS.

## 20 novembre 2026 — Lot 010

- TDR relus : §6.1, 6.2, 10.3, 11, 17, 18, module ADM, CAT-017 ; fiche `LOT_010.md`.
- Migration 0010 : campagnes, candidatures, révisions, pièces (format, signature, SHA-256, jamais réécrites),
  compléments, avis, convocations, décisions append-only, recours tranchés par un tiers ; `public_rounds`.
- Moteur de formulaires `packages/domain/src/forms.ts` ; module `lib/admissions` ; API `/api/v1/admissions`,
  téléchargement `/api/v1/admissions-documents/{id}` ; pipeline HTTP étendu au multipart borné.
- Écrans : `/candidature`, `/candidature/{id}`, `/administration/admissions`, bouton « Candidater » sur la fiche.
- Vérifications : unitaires 20 PASS, PostgreSQL 7 PASS, HTTP 6 PASS (dont admissions), build PASS, traçabilité PASS.
- Gate Done : FAIL (E2E navigateur, accessibilité, antivirus/stockage, envoi externe EXT-004) — exigences EN_COURS.

## 20 novembre 2026 — Lot 011

- Écart constaté : aucun administrateur ni rôle ne pouvait être créé sans SQL (phase P1 incomplète).
- Migration 0011, fonctions contrôlées d'administration, amorçage `pnpm db:bootstrap`, console
  `/administration` et `/administration/acces`, invitations, inscription par site, profil et délégation.
- Vérifications : unitaires 20, PostgreSQL 7, HTTP 7 (dont administration), build, traçabilité : PASS.
- Gate Done : FAIL (E2E navigateur, a11y, envoi courriel EXT-004) — exigences EN_COURS.

## 20 novembre 2026 — Audit des écarts et lot 012

- Audit `docs/AUDIT_ECARTS.md` : étapes P0–P2 non démarrées et éléments manquants des lots EN_COURS, plan 012 à 020.
- Lot 012 : migration 0012, `packages/jobs`, `apps/worker`, `/api/v1/jobs/run`, `/administration/notifications`,
  préférences et export dans `/espace`, événements ADM et LIVE via le moteur.
- Vérifications : unitaires 23, PostgreSQL 7, HTTP 8 (dont notifications), build, traçabilité : PASS.
- Environnements : Vercel en ligne (sondes 200) ; clé Neon refusée par l'API (« not authenticated »).

## 20 novembre 2026 — Base Neon par GitHub Actions

- Intégration GitHub de Neon activée par le propriétaire ; workflow `.github/workflows/neon.yml`.
- Exécution 44743359866 : migrations 0001–0012 appliquées sur `unoa`, rôle `unoa_web` créé, droits
  appliqués, `verify-web.psql` sans aucun contrôle en échec. SSL `verify-full`.

## 23 novembre 2026 — Liaison Vercel ↔ Neon en production

- Intégration Neon ↔ Vercel activée par le propriétaire ; elle lie la base `neondb` et n'expose son adresse
  qu'à l'exécution. Le site applique migrations, rôle `unoa_web`, droits et 40 contrôles au premier accès
  (ADR-0009, `packages/db/src/provision.mjs`), puis ouvre chaque session en `SET ROLE unoa_web` vérifié.
- Preuve : `https://unoa-web.vercel.app/api/v1/health/database` →
  `{"database":"connected","restricted":true,"schema":true,"provision":{"status":"ok","checks":40}}`.
- Non-régression : unitaires 23, PostgreSQL 7, HTTP 8, build : PASS.
- Reste : fournisseur OIDC (EXT-001) puis amorçage du premier administrateur ; contenu créé par l'administration.

## 23 novembre 2026 — Lot 013 (recette navigateur et accessibilité)

- Chromium + axe-core dans la recette : 25 écrans (public, administrateur de plateforme, candidat) × bureau,
  Pixel 5 et 640 px (zoom 200 %) : 0 violation WCAG 2.2 A/AA ; clavier, focus, alerte, réseau dégradé : PASS.
- Correction : débordement horizontal des groupes de permissions à 200 % (fieldset).
- Vérifications : unitaires 23, PostgreSQL 7, HTTP 9, build : PASS. Captures : `docs/preuves/lot013/`.

## 23 novembre 2026 — Connexion locale et premier administrateur en production

- Lot connexion locale (ADR-0010) : migration 0013, scrypt, TOTP, verrouillage, installation unique.
- Vérifications : unitaires 25, PostgreSQL 7, HTTP 10, build : PASS.
- Production : installation exécutée le 23 novembre (compte `admin.unoa`, rôle d'amorçage sur la racine
  « Université Numérique Ouest-Africaine (UNOA) ») ; connexion mot de passe + code vérifiée sur
  https://unoa-web.vercel.app (redirection vers le changement du mot de passe provisoire). Les secrets ont
  été remis au propriétaire hors dépôt ; le jeton d'installation est désormais sans effet.

## 23 novembre 2026 — Lot 014 (scolarité)

- Migration 0014, module `lib/students`, API `/api/v1/sis`, écrans `/administration/scolarite` et `/etudiant`.
- Vérifications : unitaires 25, PostgreSQL 7, HTTP 11, build : PASS.

## 23 novembre 2026 — Lot 015 (qui fait quoi)

- Rôles types par niveau, console structurée, mise en route, guide, invitation par identifiant local.
- Vérifications : PostgreSQL 7, HTTP 11, build : PASS.

## 23 novembre 2026 — Lot 016 (hiérarchie d'administration)

- Migration 0016 : niveaux pays et composante, administrateur pays, doyen, chef de département, règle de niveau
  à l'attribution et à l'invitation ; console, mise en route et guide alignés (ADR-0011).
- Vérifications : PostgreSQL 7, HTTP 11, build : PASS.

## 23 novembre 2026 — Comptes de test par niveau (production)

- À la demande du propriétaire, créés par les API réelles (audités) : « Pays de test » → « Université de test »
  → « Faculté des sciences et techniques (test) » → « Département d’informatique (test) » ; comptes admin.pays.test,
  admin.univ.test, doyen.test, chef.dept.test, enseignant.test. Données marquées « test », à clore avant ouverture.

## 23 novembre 2026 — Vocabulaire simplifié et compte candidat

- Interface : Pays et établissements, Facultés et départements, Filières et formations, Cours en ligne,
  Utilisateurs et rôles, Réglages ; « périmètre » au lieu de « portée ».
- Migration 0017 : création de compte candidat par identifiant et mot de passe (`/inscription`) sur un site
  qui l'autorise. Vérifications : PostgreSQL 7, HTTP 11, build : PASS.
- Site public de « Université de test » relié à unoa-web.vercel.app (textes publiés par un tiers), création de compte ouverte ; compte etudiant.test créé par /inscription.

## 23 novembre 2026 — Assistants de création et mode développement

- Page `/administration/creer` : un assistant par élément (pays, établissement, campus, faculté, département,
  filière, formation, matière, responsable), limité à ce que la personne peut créer et où ; validation des
  composantes en attente ; types usuels créés en un clic par le super-administrateur (données modifiables).
- Migration 0018 : mode développement (mot de passe libre, sans blocage, affiché à la connexion, journalisé)
  décidé par le propriétaire jusqu'à la fin du développement ; réinitialisation de mot de passe par un administrateur.
- Vérifications : PostgreSQL 7, HTTP 11, build : PASS.

## 23 novembre 2026 — Menus pliables, actions par profil, relais hiérarchique

- Barre latérale en rubriques pliables (Site public, Mon espace, Tableau de bord, Créer, Organisation, Formations et cours,
  Étudiants, Utilisateurs, Réglages) ; rubrique « Créer » limitée à ce que le profil peut créer.
- Tableau de bord : boutons « Ce que vous pouvez créer », « Prochaines étapes » (tâches du profil, personnes invitées
  à qui demander de se connecter et pour quoi) ; étape suivante après chaque création.
- Définitions de types déplacées en réglage avancé. Vérifications : HTTP 11, build : PASS.

## 24 novembre 2026 — Lot 017 (gouvernance)

- Migration 0019, module `lib/governance`, écrans `/administration/gouvernance`, `/conseils`, `/decisions`.
- Correction : formulaires imbriqués dans des paragraphes sur `/espace` (HTML invalide, relevé par la recette navigateur).
- Vérifications : unitaires 27, PostgreSQL 7, HTTP 12, build : PASS.

## 24 novembre 2026 — Lot 018 (enseignants)

- Migration 0020, module `lib/teachers`, écrans `/enseignement` et `/administration/enseignants`, expiration quotidienne des missions.
- Vérifications : PostgreSQL 7, HTTP 13, build : PASS.

## 24 novembre 2026 — Lot 019 (évaluations internes)

- Migration 0021, domaine `assessment`, module `lib/assessments`, API `/api/v1/ass`, écrans `/evaluations`,
  `/evaluations/gestion`, `/evaluations/copie` ; entrée « Mes évaluations » dans la barre latérale.
- Correction pendant la recette : droit d'insertion manquant sur `attempt.id` (42501), note masquée pendant une procédure de fraude.
- Vérifications : unitaires 30, PostgreSQL 7, HTTP 14 (dont navigateur), build : PASS.

## 25 novembre 2026 — Lot 020 (notes, crédits et jurys)

- Migration 0022, domaine `grading`, module `lib/grades`, API `/api/v1/grd`, écrans « Notes et jurys » (règles,
  saisie, jury, contrôles) et « Mes résultats » ; ADR-0012.
- Corrections pendant la recette : droit de mise à jour du rôle d'un membre de jury, étudiants sans unité dans
  la période exclus de la délibération, colonne ambiguë dans les contrôles, avenant remplaçant un crédit compensé.
- Vérifications : unitaires 35, PostgreSQL 7, HTTP 15 (dont navigateur), build : PASS.

## 25 novembre 2026 — Lot 021 (examens nationaux, suivi documentaire)

- Migration 0023, module `lib/external`, API `/api/v1/exn`, écrans public, déclarant et administration.
- Corrections pendant la recette : paramètre manquant à la création d'une information, assertion HTML.

## 25 novembre 2026 — Lots 022 (finances), 023 (documents et diplômes), 024 (formations courtes)

- Migrations 0024 à 0026 ; domaine `finance` ; modules `lib/finance`, `lib/credentials`, `lib/short` ; API `/api/v1/fin`
  (+ `checkout`, `webhooks/{prestataire}`), `/api/v1/cred`, `/api/v1/short` ; écrans payeur, prestataire fictif,
  administration financière, registre des documents, mes documents, vue imprimable avec QR, vérificateur public,
  catalogue court, espace apprenant, administration des formations courtes ; ADR-0013 et ADR-0014 ;
  dépendance `qrcode` 1.5.4.
- Corrections pendant la recette : verrou `FOR SHARE` interdit sur une table append-only (remplacé par un verrou
  consultatif par facture), paramètre ambigu dans `verify_credential`, journal des consultations exact.
- Remise à zéro de développement (ADR-0015) : `POST /api/v1/installation/reset`, puis base de production vidée à la
  demande du propriétaire, un seul super-administrateur restant.
- Recette : délai global porté à 40 min (CI 50 min), la recette navigateur couvrant désormais tous les écrans.

## 25 novembre 2026 — Cascade administrative stricte (ADR-0016)

- Migration 0027 : `cascade_level`, `cascade_anchor`, `holds_here`, `may_create`, `cascade_head`, `cascade_allows` ;
  `grant_role` et `invite_account` refusent toute nomination hors cascade ; créations des studios territoires,
  structures et catalogue contrôlées ; menus « Créer », assistants et rôles nommables alignés ; libellés des rôles.
- Recettes adaptées (nominations à chaque niveau, refus explicites du super-administrateur et du recteur hors de leur niveau).
- Vérifications : unitaires 39, PostgreSQL 7, HTTP 18 (sans navigateur), build : PASS.

- Migration 0028 : permissions des rôles réduites à leur niveau (admin pays : pays et établissements ; recteur et doyen : lecture, validation et suivi du catalogue) ; nomination en cascade du responsable et des fonctions types sans escalade (`cascade_names`).

- Migration 0029 : rôles rattachés à un niveau (seuls ceux du niveau sont proposés et acceptés), noms clairs (Administrateur pays, Recteur, Doyen, Chef de département…), sélection des enseignants ouverte aux niveaux supérieurs ; formulaires « Créer » des studios affichés seulement là où la création est permise.

- Migration 0030 : faculté ou département créés par le responsable du niveau supérieur, actifs immédiatement (plus de blocage en attente de validation) ; noms courts (Recteur, Doyen, Chef de département) ; assistants et menus « Créer » aux libellés simples (« Nommer un recteur »…).

## 2026-11-27 — Changement de compte et leçons illustrées

- Menu du compte : comptes ouverts, « Ajouter un compte », déconnexion du seul compte actif (ADR-0017) ; route `POST /api/v1/auth/switch`.
- Leçons : images (`![texte](/cours/x.svg "légende")`, HTTPS ou chemin local uniquement) et encadrés (`> [info|cle|attention]`) ; six illustrations SVG sous `apps/web/public/cours/`.
- Preuves : `pnpm test` 40/40 ; recette HTTP 18/18 (`UNOA_TEST_SKIP_BROWSER=1`), recette navigateur non relancée.
- Menu « Mon espace » limité aux espaces qui concernent le compte (migration 0031, `unoa.account_spaces`) ; illustrations de leçon dimensionnées ; menu des comptes lisible ; accueil sans formation publiée orienté vers les structures.
- Parcours de démonstration Bénin / Campus IA créé en production par l’API publique (script hors dépôt) : 1 pays, 1 établissement, 1 faculté, 2 départements, 6 filières, 10 cours avec leçons illustrées, vidéo, exercice, petit test et séance en direct ; 4 enseignants recrutés sur dossier (vérification du diplôme, avis du doyen et du recteur, décision du chef, contrat signé des deux parties, affectation). Visioconférence : `BLOCKED_EXTERNAL` (fournisseur Jitsi non configuré, la séance est planifiée mais « Rejoindre » répond « non configuré »). Formations diplômantes non publiées : publication subordonnée à une preuve d’habilitation réelle.
- Preuves : base 7/7, recette HTTP 18/18.

## 2026-11-28 — Analyse d’état ; lots 025 (MEM) et 026 (PHD)

- `docs/ETAT_ACTUEL.md` : 533 exigences, 259 → 283 en cours, 250 non démarrées, 0 vérifiée ; ordre des prochains lots.
- Mémoires et soutenances (migration 0032) et doctorat (migration 0033) intégrés : écrans `/memoires`, `/memoires/mes`, `/doctorat`, `/administration/memoires`, `/administration/doctorat`, API `/api/v1/thesis` et `/api/v1/phd`.
- Correction : la liste des personnes sélectionnables (encadrants, jury, directeurs) passe par `unoa.scope_people` (SECURITY DEFINER) au lieu d’une lecture directe des attributions, refusée au rôle web (42501).
- Menu : « Mémoires publiés » (public), « Mon mémoire », « Mon doctorat », outils d’administration correspondants ; tableau de bord « Vos outils » complet.
- Preuves : base 7/7 (33 migrations), recette HTTP 20/20. Outil automatique de similarité : BLOCKED_EXTERNAL (rapport d’outil externe saisi).

## 2026-11-28 — Lot 027 : entreprises partenaires et stages

- Migration 0034, stores `lib/companies` et `lib/internships`, API `/api/v1/ent` et `/api/v1/stg`, six écrans, menus (« Entreprises partenaires », « Mes stages », « Mon entreprise », outils d’administration).
- Preuves : base 7/7, recette HTTP 21/21 (`internships.fixture.mjs`). Registre officiel des entreprises : BLOCKED_EXTERNAL.
