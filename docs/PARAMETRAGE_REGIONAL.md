# PARAMÉTRAGE RÉGIONAL — SPÉCIFICATION NON NÉGOCIABLE

## 1. Anti-modèle explicitement rejeté

Il est **interdit** de construire `if country == 'BJ' then gradeScale = 20`, `switch(region) { ...liste fixée... }`, `const filieres = [...]`, ou d'ajouter un module métier par pays. Les moteurs sont communs et les paramètres proviennent de la base, validés, datés, versionnés et publiés par l'administration habilitée.

## 2. Hiérarchie configurable

Global → zone référentielle transnationale → pays/juridiction → région/territoire → entité légale → campus → faculté → département → programme/version → cohorte/offre → utilisateur (préférences personnelles seulement). Les organisations peuvent avoir des hiérarchies locales différentes ; conserver un graphe de rattachements typés et acyclique. La région peut désigner un département, une ville, une implantation ou une unité opérationnelle ; l'administrateur définit son type. Une juridiction est distincte d'une région ; elle porte des contraintes non dérogeables.

## 3. Résolution algorithmique

```pseudo
resolve(key, context, effectiveAt):
  definition = getDefinition(key)
  assert definition.exists
  applicableScopes = orderedApplicableScopes(context)
  candidates = publishedValues(key, applicableScopes, effectiveAt)
  candidates = rejectInvalidTypesAndUnauthorizedOverrides(candidates, definition)
  value = highestPriorityCandidateOrSafeDefault(candidates)
  legalConstraints = effectiveLegalConstraints(key, context, effectiveAt)
  securityFloor = effectiveSecurityFloor(key, context, effectiveAt)
  assert satisfies(value, legalConstraints, securityFloor)
  return { value, sourceScope, valueVersion, ruleVersion, effectiveAt,
           inheritanceTrace, legalConstraintsApplied, hash }
```

Si une valeur locale enfreint une contrainte supérieure, refuser la **publication** ; pour un enregistrement ancien encore actif, appliquer la stratégie de transition réglementaire explicitement approuvée et bloquer l'opération exposant un risque. Chaque lecture effective critique (inscription, paiement, examen interne, diplôme) enregistre le `RuleSnapshot` utilisé.

## 4. Catalogue de familles de clés (pas de valeurs imposées)

| Famille | Exemples de clés, toutes typées et configurables |
|---|---|
| Identité | `institution.legal_name`, `institution.logo_asset`, `institution.issuer_authority` |
| Pays | `locale.default`, `timezone.default`, `currency.default`, `country.dialing_code` |
| Admission | `admission.required_documents`, `.min_qualification`, `.review_workflow`, `.application_fee` |
| Académie | `academic.period_scheme`, `.credit_schema`, `.progression_rules`, `.grading_scheme` |
| Notes | `grading.scale`, `.rounding`, `.compensation`, `.jury_quorum`, `.resit_policy` |
| Cours | `learning.allowed_formats`, `.max_file_size`, `.attendance_mode`, `.review_workflow` |
| Enseignants | `teacher.required_qualifications`, `.evaluation_rubric`, `.contract_workflow` |
| Réglementation | `credential.allowed_types`, `.licensing_evidence`, `.issuer_rules`, `.expiration` |
| Paiements | `payments.providers`, `.invoice_tax_rules`, `.due_policy`, `.refund_policy` |
| Relations entreprises | `company.verification_fields`, `.job_moderation`, `.agreement_template` |
| Doctorat | `doctoral.enrollment_duration`, `.annual_review`, `.defense_workflow` |
| Documents | `documents.templates`, `.signature_policy`, `.retention`, `.allowed_storage_regions` |
| Communication | `notification.channels`, `.consent_policy`, `.quiet_hours` |
| Qualité | `quality.criteria`, `.audit_periodicity`, `.evidence_types` |
| Accessibilité | `accessibility.defaults`, `.offline_limits`, `.low_bandwidth_mode` |
| Sécurité | `security.mfa_policy`, `.session_ttl`, `.data_retention_floor` |

## 5. Exemples de configurations fictives (uniquement sandbox)

```yaml
# À placer uniquement dans tests/fixtures. Ce fichier n'est pas une règle béninoise ni une règle du Ghana.
scopes:
  - code: LAB_ALPHA
    type: country
    label: "Pays fictif Alpha"
  - code: LAB_BETA
    type: country
    label: "Pays fictif Beta"
config:
  LAB_ALPHA:
    locale.default: fr
    currency.default: XOF
    academic.period_scheme: semester
    grading.scheme: "Echelle fictive A, créée par UI"
  LAB_BETA:
    locale.default: en
    currency.default: GHS
    academic.period_scheme: trimester
    grading.scheme: "Echelle fictive B, créée par UI"
```

Ne pas utiliser ces exemples comme données réelles de production. Le test doit être reproductible via UI/API administrative et démontrer l'absence de changement de code.

## 6. Tests d'héritage, de compatibilité et de publication

1. Créer Alpha/Beta et leurs établissements, créer deux programmes de durées différentes.
2. Définir une même clé au niveau global puis une override pour Alpha seulement ; vérifier valeurs résolues et provenance.
3. Interdire l'override locale d'une contrainte de protection de données supérieure ; requête refusée.
4. Publier version 1 du barème Alpha ; inscrire cohorte 2027 ; créer version 2 effective 2029 ; résultats 2027 restent sur version 1.
5. Charger programme Beta anglais sur calendrier trimestriel ; tester navigation dans la même application sans redéploiement.
6. Tester cache après publication, rollback, période expirée, portée supprimée et fuite de droits.
7. Tester un étudiant multi-territoires : chaque acte s'appuie sur la portée et date réglementaire adéquates.
8. Tester droits : administrateur Beta ne peut lire/éditer paramètres privés Alpha ; admin global ne peut lever un verrou de diplôme.
9. Tester export/import de configuration entre deux environnements sans importer secrets ni données personnelles.
10. Exiger simulation et aperçu avant tout changement impactant diplômes, notes, admission et paiement.

## 7. Publication administrative avec garde-fous

Brouillon → validation schéma → simulation sur données fictives → revue par responsable → approbation selon séparation des fonctions → publication programmée → propagation cache → journal/référence de version. Les opérations réversibles disposent d'une action « retourner à version antérieure » qui **crée un nouvel événement**, sans effacer les versions précédentes.

## 8. Exigences d'administration sans code

Interface pour créer pays/région/campus, langues, modèles et calendriers ; constructeur programme ; formulaire conditionnel ; règle déclarative ; workflow ; tarification ; matrice de droits ; rubriques de dashboard ; modèles de notifications ; modèles documentaires ; suivi fournisseur. Un admin doit pouvoir simuler un changement et voir précisément **qui est impacté**, avant publication.
