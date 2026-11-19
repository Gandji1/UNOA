# CONTRÔLE D'ACCÈS — RBAC + ABAC + PORTÉES

## 1. Philosophie

Les personnes peuvent être simultanément étudiant, enseignant, chercheur, membre de jury ou recruteur ; un rôle n'est pas un compte. Une action est autorisée **uniquement si** l'identité est vérifiée, une permission explicite existe, le contexte et la portée sont valides, le statut de la ressource permet la transition, l'accès n'enfreint pas une politique supérieure et aucun verrou légal ne l'empêche. **Refus par défaut.** Chaque permission métier doit être vérifiée dans l'API, pas seulement cachée dans les menus.

```pseudo
allow(actor, action, resource, context):
  if !authenticated(actor): deny
  if !mfaSatisfiedFor(action, actor): deny
  if !activeGrant(actor,action,resource.scope,now): deny
  if !relationshipAllowed(actor,resource,action): deny
  if !resourceStateAllows(resource,action): deny
  if conflictsWithDutySegregation(actor,action,resource): deny
  if violatesLegalOrSecurityPolicy(action,resource,context): deny
  recordDecisionForSensitiveAction()
  allow
```

## 2. Permissions atomiques

Préfixes stables `scope.view/manage`, `config.read/propose/approve/publish`, `institution.manage`, `program.draft/review/approve/publish`, `application.create/review/decide`, `enrollment.manage`, `course.author/review/publish`, `assessment.author/grade`, `grade.propose/moderate/validate/publish`, `jury.convene/deliberate/sign`, `payment.view/record/refund`, `credential.request/issue/revoke`, `company.verify`, `opportunity.post/moderate/apply`, `internship.supervise/validate`, `thesis.supervise/defend`, `research.manage`, `qms.audit`, `analytics.view/export`, `role.assign`, `audit.view`, `support.manage`, `ai.admin`.

L'agent doit documenter les permissions **par endpoint et par transition** dans OpenAPI et générer les tests d'accès en fonction de cette matrice.

## 3. Matrice de principe

Légende : `R` lecture propre/périmètre ; `C` créer/agir ; `V` valider ; `A` administrer limité ; `–` refus. Un symbole n'autorise pas les cas non prévus par l'attribution précise de permission.

| Profil | Dossier étudiant | Cours | Notes | Programme | Finances | Titres | Offres entreprise | Recherche | Configuration |
|---|---|---|---|---|---|---|---|---|---|
| Visiteur | – | Public | – | Public | – | Vérification minimale | Offres publiques | Publications publiques | – |
| Candidat | R/C candidature | – | – | Public | R propre | – | – | – | Préférences |
| Étudiant | R propre | R inscrit, devoirs | R propre publiées | R, choix autorisé | R propres | R propres | R/C candidatures | Selon affectation | Préférences |
| Alumni | R historique limité | R droit conservé | R documents autorisés | Public | R archives propres | R propres | R/C | Selon rôle | Préférences |
| Enseignant | R étudiants affectés minimum | C/A affectés | C proposer pour cours | R maquette ; C proposition | R prestations propres | – | R public | C si chercheur | – |
| Responsable programme | R inscrits propres | V revue/affectation | V selon mandat | C/V périmètre | – | Proposer | R stages | R lié | Config acad. permises |
| Scolarité | C dossiers autorisés | R planning | R résultats publiés | R | R état administratif minimal | C demande de documents | R stages | – | Config procédure si mandat |
| Admissions | C candidatures | – | – | R | R frais dossier minimisés | – | – | – | Formulaires admission selon mandat |
| Finances | R identité de facture minimal | – | – | R barème coût | C/A périmètre | R reçus | R facturation B2B | R budget si mandat | Tarifs avec approbation |
| Jury | R dossiers nécessaires | R pièces nécessaires | V décisions de jury | R règlements | – | Avis autorisé | – | V soutenance si jury | – |
| Qualité/Audit | R preuves minimisées | R syllabus et preuves | R agrégats ou cas autorisés | R et audit | R agrégats | R registre vérification | R qualité | R preuves | R auditée |
| Entreprise vérifiée | – | – | – | Public | R propres factures | Vérification publique minimale | C/A propres ; R candidats consentants | C projet partenaire | R profil entreprise |
| Maître de stage | R stagiaire affecté limité | – | C évaluation stage | R objectifs stage | – | – | R propre | – | – |
| Doctorant | R propre | R cours affectés | R propre | R doctorat | R propre | R propre | R/C | C recherche propre | Préférences |
| Directeur de recherche | R doctorants affectés limité | R | C avis | R politique | – | – | – | C/V encadrement | – |
| Admin institutionnel | A selon mandat | A habilitations | Administrer workflow sans changer note | A création | A paramètres, pas solde arbitraire | Gérer modèles, **pas contourner habilitation** | A partenaires | A | A de sa portée |
| Admin plateforme | Métadonnées de diagnostic, pas dossiers libres | Ops technique | – | Paramétrage moteur | – | **Jamais émission hors droit** | – | – | A technique avec audit |

## 4. Séparation des tâches (SoD)

- Auteur du cours ≠ unique approbateur final de son propre cours lorsque revue indépendante requise.
- Candidat enseignant ≠ évaluateur de sa candidature.
- Enseignant correcteur ≠ personne pouvant effacer l'historique des notes.
- Gestionnaire de facturation ≠ seul approbateur du remboursement élevé ; seuils configurés.
- Agent chargé de saisir un diplôme ≠ autorité juridique d'émission.
- Membre de jury en conflit déclaré ≠ participant à la décision sur le dossier concerné.
- Admin technique ≠ signataire de diplômes, décideur d'admission ou auteur des politiques réglementaires.

## 5. Tests droits obligatoires

Pour **chaque** API de lecture, création, modification, transition et téléchargement : anonyme → refus ; rôle erroné → refus ; bon rôle autre portée → refus ; bon rôle ancienne date/mandat révoqué → refus ; relation personnelle absente → refus ; bon rôle et relation active → succès ; audit correct. Tester BOLA par substitution d'ID, filtrage des exports, pièces sensibles, URLs signées expirées, SSRF sur liens fournis, affichage côté client. Tester changement de rôle pendant session et cache invalidé.
