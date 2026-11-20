# Plan des lots — suivi par phase du PLAN_EXECUTION_AUTONOME

Ordre topologique imposé par `PLAN_EXECUTION_AUTONOME.md` §3. Un lot n'est `VERIFIE` qu'avec la
définition de Done complète ; tant qu'un élément manque, ses exigences restent `EN_COURS`.

| Phase | Modules | Lots livrés | Reste à faire (prochains lots) |
|---|---|---|---|
| P0 | CORE OPS | 001 socle, 009 restructuration | sauvegarde/restauration, observabilité (OPS) |
| P1 | TEN CFG IAM I18N A11Y SEC WF DOC NOT INTG | 002 OIDC, 003–004 paramètres, 005 territoires, **011 administration des accès** | 012 moteur de processus et formulaires (WF), GED (DOC), messagerie (NOT), langues (I18N), accessibilité outillée (A11Y) |
| P2 | ORG GOV CAT CMS ADM SIS | 006–007 structures et catalogue, 009 sites, 010 admissions | 013 scolarité (inscription, matricule, dossier), 014 gouvernance et conseils |
| P3 | TEA LMS LIVE LAB ASS | 008 cours et classes virtuelles | enseignants, laboratoires, évaluations |
| P4 | GRD EXN FIN CRED SHORT | — | notes et jurys, examens externes (suivi documentaire), finances, documents, formations courtes |
| P5 | ENT JOB CAR STG B2B MEM PHD RND LIB | — | Campus-Entreprise, stages, mémoires, doctorat, recherche, bibliothèque |
| P6 | CAMP SUP ALUM QMS DPO ANA AI | — | vie universitaire, support, alumni, qualité, protection des données, statistiques, IA |
| P7 | toutes | — | tests globaux, durcissement, déploiement |

## Mise en service d'une base vierge (sans contenu prédéfini)

1. Migrations (`pnpm db:migrate`), droits du rôle web (`infra/postgres/grant-web.psql`), contrôle (`verify-web.psql`).
2. Amorçage du premier administrateur : `pnpm db:bootstrap -- --issuer <émetteur OIDC> --subject <identifiant> --name "<nom>"`
   (ou `--sql` pour l'éditeur SQL Neon).
3. Connexion de l'administrateur → `/administration` : territoires et types de structures, établissements,
   facultés, départements, filières, spécialités, programmes, cours, site public, paramètres.
4. Invitation des responsables depuis `/administration/acces` ; composition des rôles par l'administration.
