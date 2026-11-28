# État actuel de UNOA — 28 novembre 2026

Source : `docs/MATRICE_EXIGENCES.csv` (533 exigences, 44 modules), `python automation/verifier_tracabilite.py`, recettes HTTP (18/18) et base (7/7).

## 1. Synthèse

| Statut | Exigences | Sens |
|---|---:|---|
| VERIFIE | 0 | Aucune exigence n’est encore déclarée « vérifiée » : la recette navigateur complète, l’accessibilité et la sécurité outillée manquent pour atteindre la définition de Done. |
| EN_COURS | 259 | Implémenté (interface, API, base, droits, tests HTTP) mais sans toutes les preuves exigées. |
| NON_DEMARRE | 274 | Rien de livré. |

## 2. Modules livrés (EN_COURS, 25 modules)

Socle et administration : CORE, TEN, CFG, IAM, ORG, NOT, CMS (site public), ADM (admissions), SIS (scolarité), GOV (conseils).
Pédagogie : CAT (catalogue), LMS (cours), LIVE (séances en direct), TEA (enseignants), ASS (évaluations), GRD (notes et jurys).
Services : EXN (suivi des examens nationaux), FIN (finances, bac à sable), CRED (documents et vérification), SHORT (formations courtes).
Transverses partiels : A11Y, SEC, OPS.

Parcours réel en production : Bénin → Campus IA → Faculté de l’IA → 2 départements → 6 filières, 10 cours, 4 enseignants recrutés sur dossier.

## 3. Manques dans les modules commencés (48 exigences)

| Module | Manques principaux |
|---|---|
| CORE / OPS | observabilité, sauvegardes chiffrées et restauration prouvée, quotas, runbooks, SLO, charge, rétention, export total, CI bloquante |
| CFG | contraintes légales non dérogeables, instantané de configuration par transaction, moteur de règles déclaratif, rollback, export/import |
| IAM | récupération de compte, accès de secours (break-glass) |
| CMS | formulaire de renseignements anti-spam, actualités et événements, tarifs et calendrier publiés, SEO et plan du site, campagnes |
| LMS / A11Y | import de fichiers (PDF, DOCX…), hors-ligne, sous-titres, version texte téléchargeable, brouillons synchronisés |
| SEC | modèle de menaces, tests d’isolation dédiés, contrôle des fichiers, rotation des secrets, SAST/SCA/DAST, ASVS, revues d’accès, anti-fraude |
| TEN | mobilité et transfert entre territoires |

## 4. Modules non démarrés (19 modules)

| Phase | Modules |
|---|---|
| P5 | MEM (mémoires), PHD (doctorat) — travail préparé, à intégrer ; STG (stages), ENT (Campus-Entreprise), JOB (emplois), CAR (carrières), B2B (entreprises clientes), RND (recherche), LIB (bibliothèque) |
| P6 | CAMP (vie universitaire), SUP (support), ALUM (anciens), QMS (qualité), DPO (protection des données), ANA (statistiques), AI (assistants IA) |
| P1 | WF (moteur de circuits de validation), DOC (gestion documentaire), I18N (langues), INTG (intégrations), LAB (laboratoires virtuels) |

## 5. Blocages externes connus

- Visioconférence : fournisseur (Jitsi/JaaS) non configuré — séances planifiées, salle non ouverte.
- Paiement réel : aucun contrat prestataire — bac à sable uniquement.
- Publication des formations diplômantes : preuve d’habilitation officielle requise.
- Envoi réel de courriels et SMS : prestataire non contractualisé.

## 6. Ordre d’exécution retenu

1. Lots 025 MEM et 026 PHD (intégration du travail préparé, migrations 0032–0033).
2. P5 : STG, puis ENT/JOB/CAR, B2B, RND, LIB.
3. Compléments des modules commencés (CMS, IAM, CFG, LMS/A11Y).
4. P6, puis P1 restants (WF, DOC, I18N, INTG, LAB).
5. P7 : recette navigateur complète, sécurité outillée, exploitation, passage des exigences en VERIFIE.
