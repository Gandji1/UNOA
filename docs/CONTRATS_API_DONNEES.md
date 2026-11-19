# CONTRATS DE DONNÉES, API, WORKFLOWS ET ÉVÉNEMENTS — UNOA

**Statut :** contrats de référence à rendre OpenAPI/SQL exécutables et à valider par tests de contrat. L'agent doit lire ce document avant de créer une table ou une route métier. Les entités ci-dessous sont conceptuelles : leur découpage final en tables SQL/agrégats relève d'une ADR vérifiable, sans perte de règle ni doublon.

## A. Convention des objets

- Identifiant technique opaque ULID/UUID ; numéro métier configuré et scoped ; `institution_id`, `jurisdiction_id`, `scope_id` si pertinents ; auteur, horodatage UTC, `row_version` ; `effective_from` et `effective_to` pour faits datés.
- Publication immuable par version : `program_version`, `course_version`, `form_version`, `workflow_version`, `rule_snapshot`. La modification d'une version publiée crée une nouvelle version ; l'ancienne reste liée aux enregistrements historiques.
- Éviter les tables polymorphes fourre-tout où les FK sont perdues ; pour schéma dynamique utiliser `form_schema_version` + validation JSON Schema et `form_submission` liée à un objet métier typé.
- Montants : unités mineures `bigint` + code ISO 4217 et règle d'arrondi ; jamais `float` ; calculs monétaires exacts en décimal.
- Dates académiques : date locale séparée d'un instant UTC ; règle IANA explicite ; fenêtres d'évaluation cohérentes en cas de fuseaux différents.
- Fichiers : métadonnées en DB, objets privés hors DB, checksum SHA-256, type/extension vérifiés, analyse antivirus, téléchargement autorisé par URL éphémère ; versions, licence et rétention.
- Enum technique stable pour transitions système ; labels et catégories métiers extensibles par configuration, sans perdre la sémantique des transitions.

## B. Principaux agrégats et invariants

| Agrégat | Entités/objets | Invariants obligatoires |
|---|---|---|
| Portée | Scope, Territory, Jurisdiction, LegalEntity, Campus | Hiérarchie sans cycle, appartenance datée, isolation par portée |
| Paramètres | ConfigDefinition, ConfigValue, ConfigVersion, Constraint, RuleSnapshot | Paramètre typé ; date et origine ; réglementation non dérogeable |
| Identité | Person, User, LoginIdentity, RoleGrant, Permission, Consent | Une identité par personne reconnue ; droits datés et minimaux |
| Structure | OrgUnit, UnitType, Position, Board, Mandate | Unité inactive ne peut ouvrir de nouvelle offre ; historisation des rattachements |
| Programme | Program, ProgramVersion, Course, CurriculumNode, CreditPolicy | Une version publiée est immuable ; prérequis sans cycle |
| Offre | ProgramOffering, CourseOffering, Cohort, Calendar, TeachingAssignment | Offre liée à version et dates, enseignants habilités affectés |
| Candidature | Application, ApplicationRevision, Evidence, Review, AdmissionDecision | Décision après instruction ; une candidature n'est pas une inscription |
| Étudiant | Student, Enrollment, StudyPlan, Transfer, Equivalence | Inscription liée à cohorte/version ; crédits corrélés à décision |
| Enseignant | TeacherCandidate, Qualification, Interview, Contract, Appointment | Affectation dans la période contrat et validité de qualification |
| Contenu | Syllabus, CourseVersion, Lesson, LearningAsset, Activity | Ressource publiée versionnée, droit d'auteur vérifié |
| Évaluation | QuestionBank, Assessment, Attempt, Submission, Rubric, Feedback | Un reçu de soumission correspond à un enregistrement persistant |
| Résultats | Grade, CreditAward, JuryDecision, Appeal, Transcript | Pas de publication officielle sans validation/règle/autorité |
| Finances | Invoice, PaymentIntent, ProviderEvent, LedgerEntry, Refund | Pas de crédit suite au seul callback navigateur ; idempotence |
| Titre | Authorization, CredentialTemplate, Issuance, Verification | Emission = habilitation prouvée et parcours validé |
| Entreprise | Company, KYBCase, CompanyUser, Opportunity, CandidateApplication | Entreprise vérifiée ; contrôle de consentement et ACL |
| Stage | InternshipAgreement, InternshipAssignment, Logbook, StageAssessment | Encadreur(s) et convention ; crédits uniquement après décision |
| Recherche | ResearchProject, Lab, Thesis, EthicsCase, Defense | Traçabilité scientifique et des comités ; embargo |
| Support | Ticket, Case, Attachment, Response, Escalation | Tickets cloisonnés par auteur et habilitation |
| Qualité | Standard, Criterion, Audit, Finding, CorrectiveAction, Evidence | Statut accréditation uniquement sur preuve officielle vérifiée |
| Audit | AuditEvent, ActorContext, Correlation, EventOutbox | Écriture append-only ; intégrité et conservation documentées |

## C. Exemple de schéma SQL conceptuel

```sql
CREATE TABLE config_definition (
  key text PRIMARY KEY,
  value_schema jsonb NOT NULL,
  allowed_scopes text[] NOT NULL,
  is_security_floor boolean NOT NULL DEFAULT false,
  requires_approval boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE config_value (
  id uuid PRIMARY KEY,
  definition_key text NOT NULL REFERENCES config_definition(key),
  scope_id uuid NOT NULL,
  value jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  version integer NOT NULL,
  status text NOT NULL,
  author_id uuid NOT NULL,
  approved_by uuid,
  reason text NOT NULL,
  UNIQUE (definition_key, scope_id, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX config_value_effective_idx ON config_value(definition_key,scope_id,effective_from);
-- Exécuter validation value_schema dans service métier + tests ; ajouter exclusion SQL contre périodes contradictoires.
```

Le schéma ci-dessus **illustre** la structure et n'est pas une migration finale. Le SQL livré devra créer les références manquantes (`scope`, `user`), contraintes d'exclusion pour chevauchements, contrôles de portée et stratégie de migration.

## D. Catalogue des familles d'API (à générer sous `/api/v1`)

**Conventions universelles** : `/api/v1/<resources>`, `GET` liste/détail, `POST` création ou action, `PATCH` changement contrôlé, absence de `DELETE` physique sur traces réglementées, `PUT` seulement remplacement complet documenté. Toute méthode comporte contrôle d'accès serveur, schéma d'entrée/sortie, erreur stable, pagination, version, logs et tests de contrat. `POST` critique exige `Idempotency-Key` ; `PATCH` sensible exige `If-Match`/version.

| Domaine | Routes contractuelles minimales | Autorisations et effets |
|---|---|---|
| Sessions | `POST /auth/login`, `/auth/logout`, `/auth/refresh`, `GET /me` | Auth centralisée, MFA, session sûre |
| Permissions | `GET/POST /role-grants`, `POST /role-grants/{id}/revoke`, `GET /access/check` | Gestionnaire IAM par scope et justification |
| Territoires | `GET/POST /territories`, `GET/PATCH /territories/{id}`, `GET/POST /jurisdictions` | Hiérarchie, interdiction de cycle |
| Entités | `GET/POST /institutions`, `/campuses`, `/org-units`, `POST /org-units/{id}/reorganize` | Gouvernance et approbations |
| Configuration | `GET/POST /config/definitions`, `/config/values`, `POST /config/simulate`, `POST /config/versions/{id}/approve`, `POST /config/versions/{id}/publish` | Héritage, versions, garde-fou légal |
| Workflows | `GET/POST /workflow-definitions`, `POST /workflows/{id}/simulate`, `/instances`, `/instances/{id}/transition` | Transition métier idempotente et auditée |
| Programmes | `GET/POST /programs`, `/programs/{id}/versions`, `POST /program-versions/{id}/submit-review`, `/publish` | Création sans cours en dur, publication contrôlée |
| Maquettes | `GET/POST /program-versions/{id}/curriculum-nodes`, `/prerequisites`, `/competencies`, `/transition-maps` | Version/contrainte/crédits |
| Offres de programme | `GET/POST /program-offerings`, `POST /program-offerings/{id}/open`, `/close` | Droits d'ouverture selon statut |
| CMS | `GET/POST /pages`, `/content-blocks`, `/announcements`, `/program-directory` | Publication et contrôle date/version |
| Candidatures | `GET/POST /applications`, `POST /applications/{id}/submit`, `/request-documents`, `/review`, `/decide`, `/appeal` | Candidat puis instructeur selon étape |
| Scolarité | `GET/POST /enrollments`, `POST /enrollments/{id}/confirm`, `/suspend`, `/resume`, `/transfer` | Vérifications programme, admission et financement |
| Étudiants | `GET /students/{id}/study-plan`, `/progress`, `/transcript`, `GET/POST /students/{id}/requests` | Sujet ou service autorisé |
| Enseignants | `GET/POST /teacher-applications`, `POST /teacher-applications/{id}/evaluate`, `/decide`; `/teacher-assignments` | Qualifications, recrutement et séparation |
| Cours | `GET/POST /courses`, `/courses/{id}/versions`, `/course-versions/{id}/modules`, `/assets`, `/activities` | Auteurs + relecteurs ; autorisation de diffusion |
| Validation cours | `POST /course-versions/{id}/submit-review`, `/approve`, `/publish`, `/withdraw` | Édition immuable et licence |
| Offres cours | `GET/POST /course-offerings`, `/course-offerings/{id}/enrollments`, `/sessions` | Groupe, calendrier et enseignant actif |
| Classes virtuelles | `GET/POST /live-sessions`, `/live-sessions/{id}/join`, `/cancel`, `/attendance` | Lien signé et consentement enregistrement |
| Laboratoires | `GET/POST /lab-templates`, `/lab-instances`, `POST /lab-instances/{id}/stop` | Sandboxes isolées et quotas |
| Épreuves | `GET/POST /question-banks`, `/assessments`, `/assessments/{id}/versions`, `/assessments/{id}/sessions` | Questions privées, versionnées |
| Copies | `POST /assessment-sessions/{id}/attempts`, `/attempts/{id}/autosave`, `/submit`; `GET /submissions/{id}` | Délais serveur, accusé, idempotence |
| Correction | `POST /submissions/{id}/grade`, `/moderate`, `GET /rubrics/{id}` | Grilles, autorisation et double correction |
| Notes/jurys | `GET/POST /gradebooks`, `/juries`, `POST /juries/{id}/deliberate`, `/publish`, `/appeals` | Jury/état/PV/quorum |
| Paiement | `GET/POST /price-rules`, `/invoices`, `POST /payment-intents`, `POST /provider-webhooks/{provider}`, `GET /payments/{id}` | Webhook vérifié, ledger immuable |
| Bourses | `GET/POST /scholarships`, `/grants`, `POST /scholarships/{id}/approve` | Critères et financement |
| Titres | `GET/POST /credential-templates`, `/authorizations`, `POST /credential-requests`, `/credentials/{id}/issue`, `/revoke` | Habilitation obligatoire |
| Vérification | `GET /verify/credentials/{opaqueToken}` | Réponse minimale, quota et anti-énumération |
| Examens externes | `GET/POST /external-credentials`, `POST /external-credentials/{id}/verify` | Archivage uniquement, sans résultats officiels fictifs |
| Entreprises | `GET/POST /companies`, `POST /companies/{id}/submit-verification`, `/approve`, `/members` | Mandat, KYB et scope entreprise |
| Offres | `GET/POST /opportunities`, `/opportunities/{id}/publish`, `/close`, `/report` | Modération et entreprise vérifiée |
| Candidature emploi | `POST /opportunities/{id}/apply`, `GET /job-applications`, `POST /job-applications/{id}/transition` | Consentement, copie candidature |
| Carrière | `GET/POST /career-profiles`, `/portfolios`, `/skills`, `/cv-versions` | Profil visible selon consentement |
| Stages | `GET/POST /internships`, `/internships/{id}/agreements`, `/logbook`, `/reviews`, `/validate` | Université+entreprise+étudiant |
| B2B | `GET/POST /b2b-requests`, `/partnerships`, `/sponsorships`, `/enterprise-projects` | Contrats et approbations |
| Mémoire | `GET/POST /thesis-topics`, `/thesis-projects`, `/thesis-projects/{id}/drafts`, `/defenses` | Encadrement/jury/intégrité |
| Doctorat | `GET/POST /doctoral-admissions`, `/doctoral-enrollments`, `/supervision-committees`, `/phd-defenses` | Règlement doctoral/version |
| Recherche | `GET/POST /research-projects`, `/labs`, `/publications`, `/ethics-applications` | Accès et embargo |
| Bibliothèque | `GET/POST /library-items`, `/collections`, `/licenses`, `/repository-deposits` | Licence et droits d'accès |
| Communauté | `GET/POST /communities`, `/posts`, `/events`, `/moderation-cases` | Modération et consentement |
| Support | `GET/POST /tickets`, `/service-requests`, `POST /tickets/{id}/transition`, `/escalate` | Permission/scope/SLA |
| Notifications | `GET/POST /notification-templates`, `/notification-preferences`, `/messages`, `/delivery-attempts` | Consentement, canal et langue |
| Alumni | `GET/POST /alumni-profiles`, `/mentorships`, `/alumni-events` | Opt-in |
| Qualité | `GET/POST /quality-standards`, `/audits`, `/findings`, `/corrective-actions`, `/evidence` | Dossier accréditation probant |
| Données personnelles | `GET/POST /data-subject-requests`, `/processing-activities`, `/retention-policies` | Contrôles légaux |
| Tableaux de bord | `GET/POST /dashboards`, `/report-definitions`, `/exports` | Filtres serveur et anonymisation |
| IA | `POST /assistants/{id}/query`, `GET /ai-usage`, `GET/POST /ai-policies` | Sources approuvées, pas de décision automatique |
| GED | `POST /assets/upload-intents`, `/assets/{id}/complete`, `GET /assets/{id}/download` | Scan et lien temporaire |
| Intégrations | `GET/POST /integrations`, `/integrations/{id}/test`, `/webhook-deliveries` | Secrets hors BD, callbacks fiables |
| Ops | `GET /health`, `/ready`, `/metrics`, `/admin/audit-events`, `/admin/jobs` | Niveau d'accès strict et réseau restreint |

**Ne pas recopier automatiquement ces routes sans analyser les agrégats.** La route finale et les DTO exacts doivent être générés dans OpenAPI, avec invariants métier et tests de contrat. Un endpoint listé mais non codé reste ouvert.

## E. Contrat d'erreur

```json
{
  "type": "https://unoa.example/errors/insufficient-authorization",
  "title": "Action non autorisée",
  "status": 403,
  "detail": "L'utilisateur ne possède pas la délégation requise dans cette portée.",
  "instance": "/api/v1/credentials/requests/demo/issue",
  "correlationId": "corr_demo_unique"
}
```

Codes : 400 entrée invalide ; 401 non authentifié ; 403 action interdite ; 404 absent **ou** dissimulé pour empêcher énumération ; 409 conflit de version/état ; 422 règle métier non satisfaite ; 429 limite ; 502/503 fournisseur. Les erreurs ne doivent jamais divulguer informations confidentielles d'une autre portée.

## F. Enveloppe d'événements

```json
{
  "eventId": "uuid",
  "eventType": "grade.validated",
  "eventVersion": 1,
  "occurredAt": "2026-11-18T11:00:00Z",
  "aggregateId": "uuid",
  "aggregateVersion": 4,
  "institutionId": "uuid",
  "scopeId": "uuid",
  "actorId": "uuid",
  "correlationId": "uuid",
  "payload": {"gradeId": "uuid", "programVersionId": "uuid"}
}
```

Produire l'événement dans la **même transaction** que le changement métier (outbox), publier ensuite. Les consommateurs enregistrent `eventId` traité et possèdent un comportement idempotent. Aucun événement de diplôme n'est publié si l'émission est rejetée. Éviter de placer noms, notes ou pièces dans les événements lorsqu'un ID et contrôle d'accès suffisent.

## G. Machines d'état obligatoires (sémantique, labels configurables)

| Objet | États minimaux | Interdictions |
|---|---|---|
| Configuration | draft → review → approved → scheduled → active → superseded | Pas d'activation avant contrôle contrainte/règle |
| Programme | draft → academic_review → approved → published → admissions_open/closed → archived | Pas d'admission officiellement diplômante sans droit |
| Candidature | draft → submitted → incomplete/review → admitted/conditional/waitlisted/rejected → accepted/enrolled | Rejet motivé ; pas de paiement qui force admission |
| Enseignant | draft → submitted → screened → reviewed → accepted/rejected → contracted/assigned → inactive | Pas d'affectation active sans habilitation/contrat si requis |
| Contenu | draft → peer_review → quality_review → approved → published → withdrawn | Ancienne version reste accessible aux étudiants concernés |
| Copie | open → in_progress → submitted → accepted_for_grading → graded → moderated → closed | Pas de correction avant copie reçue, pas de double réception |
| Note | draft → proposed → reviewed → validated → published → rectified | Changement publié par avenant et droit spécifique |
| Jury | convened → quorum_checked → deliberated → signed → published | Aucune publication sans quorum et approbations nécessaires |
| Paiement | initiated → pending_provider → confirmed/failed/cancelled → refunded/chargeback | La redirection navigateur ne confirme rien |
| Titre | requested → validated → authorized → issued → revoked/replaced | Pas de titre officiel sans habilitation |
| Entreprise | registered → verification_pending → approved/rejected/suspended → closed | Pas de publication libre d'offres avant approbation |
| Stage | proposed → accepted → agreement_approved → active → reported → evaluated → validated/closed | Pas de crédits sur stage non validé |
| Doctorat | application → admitted → enrolled → supervised → pre_defense → defended → archived | Aucune soutenance officielle sans procédure validée |
| Ticket | new → triaged → assigned → in_progress → awaiting_user → resolved → closed/reopened | Historiser les escalades et répondants |

Chaque transition doit avoir un acteur permis, des gardes, une validation de version, un audit, des événements et des tests. Les processus peuvent comporter sous-états selon pays/programme. Les machines d'état ne doivent pas être des chaînes arbitraires assignables directement par `PATCH` public.

## H. Exemples de règles métier à test obligatoire

- `R-A01` : une inscription doit référencer la **version effective** du programme à la date d'admission.
- `R-A02` : un programme publié a un hash ou version immuable ; aucune modification sans nouvelle version.
- `R-A03` : la somme des crédits attribués reflète strictement les résultats académiques validés, pas les vues de vidéos.
- `R-A04` : une compensation est impossible lorsque son paramètre versionné ne la permet pas.
- `R-A05` : une décision de jury n'est valide qu'avec membres, quorum et signatures prescrits.
- `R-B01` : un paiement provider doit être cryptographiquement vérifié et lié à facture/devise/montant.
- `R-B02` : la même notification de paiement ne crée jamais deux écritures.
- `R-C01` : toute émission de titre requiert habilitation valant pour le programme, territoire, période et émetteur.
- `R-C02` : un diplôme national externe n'est jamais émis par l'UNOA ; uniquement archivé comme pièce externe.
- `R-D01` : les données d'une autre entreprise ne sont jamais visibles même par manipulation d'ID.
- `R-D02` : une copie transmise n'est visible qu'au candidat et aux intervenants autorisés.
- `R-E01` : un étudiant ancien ne change pas de barème rétroactivement après changement régional.
- `R-E02` : un utilisateur ne perd pas ses dossiers en changeant de rôle, mais perd immédiatement les accès révoqués.
- `R-F01` : pas d'examen national organisé dans le module d'évaluation de l'UNOA.
- `R-F02` : une sortie du mode hors ligne conserve l'accusé horodaté côté serveur ou signale l'échec, jamais un faux dépôt « accepté ».

## I. Indexation, partitionnement et migrations

Indexer par portée, statut, dates, IDs externes, délibérations et principales FK ; éviter index inutiles sur données sensibles ; unicité sur numérotations métier dans leur portée. Réviser index avec `EXPLAIN ANALYZE` et volumes pilotes réalistes. Les rapports lourds utilisent projections contrôlées et vues matérialisées actualisées, sans perturber le transactionnel. Les migrations de schéma doivent fonctionner sur jeux vierges et peuplés, inclure tests rollback ou correctifs compensatoires et préservation des anciennes versions.

## J. Contrat actif du studio de paramétrage

Les routes suivantes utilisent la session institutionnelle et un accès
`config.read` à la portée. Les POST navigateur ou JSON exigent l’origine
du site. Les accès refusés ou les entrées invalides répondent en
`application/problem+json` aux clients JSON.

| Route | Entrée et effet |
|---|---|
| `GET /api/v1/config/definitions` | `scopeId` UUID et `after` facultatif. Renvoie 24 définitions et le curseur suivant. |
| `GET /api/v1/config/resolve` | `scopeId`, `key` et date UTC facultative `at`. Renvoie la valeur, la portée source, la version et la justification ou la valeur par défaut. |
| `POST /api/v1/config/definitions` | `scopeId` racine, `key`, `label`, `description`, `kind`, `allowedTypes`, `inherits`, `allowOverride`. Bornes numériques, choix et valeur par défaut facultatifs selon le type. |
| `POST /api/v1/config/values` | `scopeId`, `key`, `value`, `reason`, `effectiveFrom` et en-tête `Idempotency-Key` UUID. Crée un brouillon. |
| `POST /api/v1/config/versions/{id}/{action}` | `scopeId`, `key` et `previewVersion` pour `approve` ou `publish`. Envoyer `null` si l’aperçu part du défaut. Les actions disponibles sont `submit`, `approve`, `reopen` et `publish`. |

Les valeurs datées sont sélectionnées d’abord par la proximité de la portée,
puis par la dernière date d’effet passée et le numéro de version. La
prévisualisation de la version se fait dans le studio à la date d’effet du
brouillon. Le champ `previewVersion` permet de signaler une référence périmée.
Chaque publication crée l’événement de sortie
`region.configuration_published` et une trace d’audit dans la même transaction.
