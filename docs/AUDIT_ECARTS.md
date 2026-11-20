# Audit des écarts — 20 novembre 2026

Relecture : TDR §1–3, 15–24 (architecture, API, formulaires, UX), modules CORE à OPS ; PLAN_EXECUTION
§3 ; CARTOGRAPHIE ; MATRICE (533 exigences : 120 EN_COURS, 413 NON_DEMARRE, 0 VERIFIE).

## 1. Étapes sautées dans les phases déjà engagées (P0–P2)

| Phase | Exigences non démarrées | Conséquence |
|---|---|---|
| P0 CORE/OPS | CORE-004 observabilité, CORE-006 worker et file durable, CORE-008 sauvegardes, CORE-010 files mortes et rejeu, CORE-011 quotas, CORE-014 runbook ; OPS-002 à 014 | aucun traitement asynchrone fiable : notifications, imports, exports impossibles hors requête |
| P1 NOT | NOT-002 à 010 (modèles multilingues, règles par événement, préférences, courriel/SMS sandbox, relances, preuve de livraison) | les notifications actuelles sont internes, sans canal externe ni préférence |
| P1 CFG | CFG-004 contraintes non dérogeables, 008 instantané par transaction, 009 moteur de règles, 010 rollback, 011 caches, 013 export/import | règles régionales non exécutables par un moteur commun |
| P1 IAM | IAM-004 récupération (fournisseur OIDC), 012 break-glass, 013 export consentements, 015 fin de contrat | — |
| P1 SEC | SEC-001, 003, 005, 006, 009 à 014 | pas d'analyse SAST/SCA en CI, fichiers non analysés |
| P1 WF, DOC, I18N, A11Y, INTG | tous non démarrés | formulaires et processus codés par module ; pas de GED ; interface en français seul ; accessibilité non outillée ; pas d'idempotency-key ni de webhooks |
| P2 CMS | CMS-005 contact anti-spam, 006 actualités/événements, 007 tarifs et calendrier, 009 SEO/sitemap, 011 campagnes, 012 accessibilité mobile | site public incomplet par rapport au prototype (actualités, événements, contact) |
| P2 GOV, SIS | tous non démarrés | inscription administrative et conseils absents |
| P3 LMS | LMS-003 import de documents, LMS-015 hors ligne | — |

## 2. Partiellement implémenté (EN_COURS) — élément manquant commun

Tous les lots 001 à 011 ont interface, API, base, droits et recette HTTP, mais il leur manque :
tests navigateur de bout en bout, contrôle d'accessibilité outillé (axe), version anglaise de
l'interface, et preuve sur l'environnement déployé (Neon + Vercel). Aucune exigence ne peut passer
`VERIFIE` tant que ces quatre éléments manquent.

## 3. Plan d'exécution (ordre imposé par les dépendances)

| Lot | Contenu | Exigences |
|---|---|---|
| 012 | File durable et worker (outbox, rejeu, files mortes) ; moteur de notifications (modèles versionnés multilingues, règles par événement et portée, préférences et consentements, adaptateurs courriel/SMS sandbox, relances, preuve de livraison, anti-fuite) | CORE-006, CORE-010, NOT-002 à 010, IAM-013, ADM-013 |
| 013 | Recette navigateur (Playwright) et accessibilité outillée (axe) sur tous les écrans existants ; contrôle mobile | A11Y, CMS-012, critère Done des lots 001–012 |
| 014 | Compléments du paramétrage : moteur de règles déclaratives, contraintes non dérogeables, instantanés, rollback, export/import | CFG-004, 008 à 013 |
| 015 | GED et pièces : stockage objet (adaptateur), analyse antivirus (adaptateur sandbox), import de documents de cours | DOC, SEC-005, LMS-003, LMS-015 |
| 016 | Moteur de formulaires et de processus configurables (définitions versionnées, transitions, délais) | WF, formulaires §17 |
| 017 | Internationalisation de l'interface (fr/en), formats régionaux | I18N |
| 018 | Site public complet du prototype : actualités, événements, contact anti-spam, tarifs et calendrier, SEO et sitemap | CMS-005 à 011 |
| 019 | Exploitation et sécurité : observabilité, sauvegarde/restauration, CI SAST/SCA, runbooks, idempotency-key | CORE-004/008/011/014, OPS, SEC, INTG-002 |
| 020+ | P2 : scolarité (SIS), gouvernance (GOV) ; puis P3 à P7 selon PLAN §3 | — |

Chaque lot suit la boucle de CLAUDE.md §2 et se termine par son rapport ; rien n'est laissé « à corriger
plus tard » : un élément non livré reste explicitement `EN_COURS` ou `BLOQUE_EXTERNE`.

## 4. Environnements

- Vercel : https://unoa-web.vercel.app — déployé depuis `master`, sondes `live` et `ready` en 200 ;
  connexion institutionnelle non configurée (variables `UNOA_IAM_*` absentes).
- Neon : projet `raspy-pond-30211501` ; clé d'API enregistrée sur l'environnement, refusée par Neon
  (« not authenticated ») au 20 novembre — à renouveler (EXT-005).
- OIDC de production : non fourni (EXT-001).
