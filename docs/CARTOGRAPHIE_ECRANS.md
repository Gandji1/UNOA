# CARTOGRAPHIE DES INTERFACES, ÉCRANS ET FORMULAIRES — UNOA

## Règle de réalisation

Chaque vue listée dans ce catalogue exige : route nommée, permission côté serveur, breadcrumb/contextualisation, état vide, état chargement, erreur, sauvegarde, action principale, validation, confirmation si nécessaire, responsive mobile, i18n, tests clavier/lecteur d'écran et journal si action sensible. Le chemin proposé est une convention modifiable par ADR, jamais un contenu académique. Une vue disponible uniquement sous forme de maquette ne satisfait pas l'exigence.

## A. Navigation métier par portail

| Espace | Navigation et vues minimales |
|---|---|
| Site public `/` | Accueil ; à propos ; structures ; formations ; détail programme ; conditions ; coûts ; calendrier ; FAQ ; actualités ; événements ; partenaires ; contact ; publications légales ; vérification titre |
| Candidat `/candidate` | Démarrage ; choix programme ; candidatures ; formulaire dynamique ; pièces ; frais candidature ; dépôt ; boîte de demandes ; décisions ; admission ; acceptation ; recours |
| Étudiant `/student` | Dashboard ; programme ; plan d'études ; inscription ; cours ; calendrier ; séances ; devoirs ; évaluations ; notes ; compétences ; scolarité ; documents ; factures ; demandes ; bibliothèque ; communauté ; stages ; emplois ; CV/portfolio ; messagerie ; assistance |
| Enseignant `/teacher` | Profil ; candidature ; qualifications ; missions ; groupes ; cours ; studio ; syllabus ; ressources ; séances ; activités ; TD/TP ; examens ; copies ; correction ; notes proposées ; forums ; tutorat ; rapport activité ; contrat |
| Doctorat `/doctoral` | Dossier ; projet ; sujet ; directeurs ; comité de suivi ; réinscription ; formations doctorales ; rapports ; publications ; jalons ; thèse ; jury ; soutenance ; archives |
| Entreprise `/company` | Création/vérification ; tableau de bord ; équipe ; profil ; offres ; candidatures ; entretiens ; stages ; conventions ; maîtres de stage ; projets ; formations sur mesure ; partenariat ; paiements ; événements ; statistiques |
| Alumni `/alumni` | Profil ; annuaire volontaire ; diplômes archivés ; carrière ; mentorat ; offres ; formations ; événements ; réseau ; confidentialité |
| Administration `/admin` | Vue globale ; régions ; juridictions ; institutions ; unités ; gouvernance ; rôles ; configuration ; programmes ; admissions ; scolarité ; enseignants ; cours ; corrections ; jurys ; finances ; diplômes ; entreprises ; stages ; recherche ; qualité ; support ; rapports ; contenus ; intégrations ; sécurité ; audits |
| Qualité `/quality` | Référentiels ; audits ; preuves ; non-conformités ; plans d'action ; autoévaluation ; rapports ; accréditations et autorisations réelles |
| Support `/support` | Tickets ; bases connaissance ; demande service ; escalade ; rendez-vous ; recours ; tableaux de bord |
| Vérification publique `/verify` | Saisie code/QR ; réponse minimisée ; statut valide/révoqué/non vérifiable ; informations de recours |

## B. Principes communs des formulaires

Éditeur schématisé pour `FormDefinition` : champ `id/type/label/description/required/visibility/validation/scope/i18n/help/retention/permission`; composants texte/email/téléphone/date/liste/fichier/checkbox/radio/groupe répétable ; conditions déclaratives validées ; affichage de pièces en brouillon ; erreur par champ ; contrôle côté serveur ; prévisualisation pour admin ; publication de version immutable ; rendu WCAG ; gestion auto-save. Les formulaires d'admission, entreprise, candidature enseignant, tickets, qualité, conventions, paiements et programmes utilisent ce socle sans code particulier pour leurs champs configurables.

## C. Critères de validation des écrans

1. Chaque bouton est relié à une action effective et son résultat en base ou un message d'interdiction explicite.
2. Les menus visibles correspondent aux permissions ; en forçant l'URL, l'API reste protégée.
3. Les erreurs back-end sont affichées sans fuite de données personnelles ou trace technique.
4. Un document et une note n'apparaissent pas avant leur statut publié/autorisé.
5. Filtres, recherches et exports sont limités aux mêmes portées que la liste.
6. Une région supplémentaire ne nécessite ni nouveau menu codé ni branche de logique par pays.
7. Les traductions d'interface et les libellés propres aux programmes sont distincts.
8. Les formulaires volumineux restent utilisables au clavier, sur téléphone et après coupure temporaire.

## D. Inventaire détaillé par module

<!-- L'inventaire ci-dessous est généré à partir de la même liste que la matrice des exigences. -->

### CORE — Socle et disponibilité

**Écrans et composants à développer :** Console statut ; environnement ; logs ; jobs ; sauvegardes ; déploiement.

**Données affichées et éditées :** Environment, HealthCheck, Job, Backup, RestoreRun, Deployment, FeatureToggle.

**Workflow déclenché :** Installation → configuration → migration → vérification santé → exploitation → restauration.

**Actions et formulaires indispensables :** Initialiser monorepo documenté et compilation reproductible ; Fournir Docker Compose complet local avec services nécessaires ; Construire scripts de création et de migration des bases ; Installer observabilité des erreurs et traces corrélées ; Fournir endpoints readiness et liveness ; Déployer worker et file durable de traitements ; Fournir gestion sécurisée des secrets et configurations d'environnement ; Automatiser sauvegardes chiffrées et restauration testable.

**États/erreurs à mettre en scène :** Service externe indisponible ; job en double ; rupture de déploiement ; restauration échouée.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### TEN — Territoires et multi-entités

**Écrans et composants à développer :** Arbre territorial ; fiche pays/région ; entités légales ; centres ; simulations.

**Données affichées et éditées :** Territory, TerritoryType, Jurisdiction, Entity, Campus, Scope, Relationship.

**Workflow déclenché :** Créer territoire → rattacher juridiction → lier établissement → affecter programme → activer paramètres.

**Actions et formulaires indispensables :** Créer plusieurs types de territoires et hiérarchies non fixes ; Distinguer territoire, juridiction, établissement et centre ; Affecter une institution à plusieurs territoires autorisés ; Gérer fuseaux IANA par implantations et calendrier ; Associer monnaies et formats régionaux sans hardcode ; Publier identité légale et contacts propres à établissement ; Isoler données privées par portée territoriale ; Gérer mobilité et transfert interterritoires.

**États/erreurs à mettre en scène :** Territoires homonymes ; frontières de compétences ; création en cycle ; transfert établissement.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### CFG — Paramétrage hiérarchique

**Écrans et composants à développer :** Catalogue de clés ; éditeur typé ; héritage ; test de règle ; comparaison de versions.

**Données affichées et éditées :** ConfigDefinition, ConfigValue, ConfigVersion, ConfigApproval, RuleDefinition, RuleResult.

**Workflow déclenché :** Déclarer clé → valeurs portées → simulation → revue → publication datée → historisation.

**Actions et formulaires indispensables :** Créer des définitions de paramètres typés et validés ; Gérer portées globale zone pays région entité programme cohorte utilisateur ; Résoudre l'héritage avec provenance et justification ; Appliquer contraintes légales et sécurité non dérogeables ; Versionner et approuver les publications de paramètres ; Prévisualiser la différence avant publication ; Programmer date d'effet des changements ; Maintenir instantané de configuration de chaque transaction académique.

**États/erreurs à mettre en scène :** Conflit d'héritage ; override interdit ; données invalides ; rétroactivité ; cache périmé.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### IAM — Identité et permissions

**Écrans et composants à développer :** Connexion ; récupération ; sessions ; rôles ; délégations ; journaux.

**Données affichées et éditées :** User, Identity, Account, MFADevice, Role, Permission, Grant, Session, Consent.

**Workflow déclenché :** Compte → vérification → accès → rôle → délégation → révocation.

**Actions et formulaires indispensables :** Créer compte utilisateur unique et profils métiers multiples ; Authentifier via fournisseur OIDC éprouvé ; Activer MFA pour personnels sensibles ; Fournir récupération de compte sécurisée ; Gérer sessions actives et révocation à distance ; Définir rôles composables et permissions atomiques ; Limiter permissions par scope ressource période et relation ; Gérer délégations temporaires avec auteur et justification.

**États/erreurs à mettre en scène :** Prise de compte ; escalade de privilège ; identité doublon ; révocation en cours.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### ORG — Organisation institutionnelle

**Écrans et composants à développer :** Organigramme ; éditeur unité ; responsables ; historique.

**Données affichées et éditées :** OrgUnit, OrgUnitType, Position, Appointment, ReportingLine, OrgVersion.

**Workflow déclenché :** Proposition d'unité → validation → activation → réorganisation → archivage.

**Actions et formulaires indispensables :** Créer et nommer n'importe quel type d'unité organisationnelle ; Construire hiérarchies d'unités configurables ; Affecter responsables et suppléants datés ; Gérer historique des réorganisations sans perte des liens ; Configurer affectations multiples d'un personnel ; Gérer entités légales et composantes académiques distinctes ; Approuver fermeture fusion ou transfert d'une unité ; Publier organigramme public filtré.

**États/erreurs à mettre en scène :** Suppression unité active ; double responsabilité ; changement hiérarchique rétroactif.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### GOV — Gouvernance et conseils

**Écrans et composants à développer :** Conseils ; réunions ; avis ; votes ; décisions ; procès-verbaux.

**Données affichées et éditées :** Board, Committee, Meeting, AgendaItem, Vote, Decision, Minutes, Delegation.

**Workflow déclenché :** Convocation → ordre du jour → quorum → délibération → PV → publication.

**Actions et formulaires indispensables :** Créer types de conseils et instances via paramétrage ; Constituer membres et mandats datés ; Convocations et agendas versionnés ; Contrôler quorum et incompatibilités ; Consigner avis et votes selon règles applicables ; Générer procès-verbaux signables ; Enregistrer décisions et effets exécutoires ; Gérer conflits d'intérêts et abstentions.

**États/erreurs à mettre en scène :** Quorum insuffisant ; conflit d'intérêts ; signature absente ; décision contestée.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### CAT — Catalogue académique et maquettes

**Écrans et composants à développer :** Catalogue ; programme ; parcours ; UE ; cours ; maquette ; transitions.

**Données affichées et éditées :** Program, ProgramVersion, Pathway, Period, Unit, Course, CurriculumMap, Competency.

**Workflow déclenché :** Structure → programme → maquette → revue → validation → publication → évolution.

**Actions et formulaires indispensables :** Créer filières mentions spécialisations et parcours arbitraires ; Configurer programmes Licence Master Doctorat et non diplômants ; Configurer organisation semestrielle trimestrielle ou modulaire ; Créer UE et éléments constitutifs ou cours ; Gérer codes nom titres et traductions des programmes ; Définir crédits coefficients et volumes horaires par règle ; Modéliser prérequis et vérifier absence de cycle ; Définir compétences et résultats d'apprentissage attendus.

**États/erreurs à mettre en scène :** Prérequis en cycle ; UE sans crédits ; changement sur cohorte antérieure ; incohérence du total.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### CMS — Portail public et orientation

**Écrans et composants à développer :** Accueil ; catalogue ; fiche programme ; actu ; FAQ ; contact ; compare.

**Données affichées et éditées :** Page, ContentBlock, ProgramListing, Lead, Inquiry, Publication, Campaign.

**Workflow déclenché :** Publication fiche → recherche → orientation → contact → candidature.

**Actions et formulaires indispensables :** Créer site institutionnel géré par CMS ; Publier fiches programmes versionnées et statut officiel ; Offrir recherche filtrée par niveau pays langue et modalités ; Proposer comparaison de programmes ; Fournir formulaire de renseignements anti-spam ; Gérer articles actualités événements et presse ; Publier tarifs et calendrier issus des référentiels ; Prévoir pages de mentions légales et confidentialité par région.

**États/erreurs à mettre en scène :** Information devenue fausse ; programme non autorisé ; formulaire spam.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### ADM — Admissions

**Écrans et composants à développer :** Espace candidat ; formulaire ; vérification ; comité ; décision ; recours.

**Données affichées et éditées :** Application, ApplicationVersion, Requirement, DocumentCheck, Review, AdmissionDecision.

**Workflow déclenché :** Création → pièces → dépôt → instruction → décision → inscription.

**Actions et formulaires indispensables :** Créer processus candidature et formulaire propre au programme ; Gérer plusieurs candidatures pour une identité ; Sauvegarder brouillon et reprise sur mobile ; Contrôler documents pièces taille format et authenticité ; Calculer complétude selon règles versionnées ; Recevoir dossier et délivrer accusé horodaté ; Ouvrir instruction administrative et académique séparées ; Appliquer critères et grilles de sélection configurables.

**États/erreurs à mettre en scène :** Dossier incomplet ; pièces contradictoires ; candidatures simultanées ; fraude.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### SIS — Scolarité et historique étudiant

**Écrans et composants à développer :** Dossier ; inscription ; carte ; calendrier ; progression ; demandes.

**Données affichées et éditées :** Student, Matricule, Enrollment, Registration, Cohort, StudyPlan, StudentStatus.

**Workflow déclenché :** Admission → inscription → cohortes → progression → réinscription → sortie/Alumni.

**Actions et formulaires indispensables :** Générer matricule unique selon séquence configurée ; Enregistrer inscription administrative et pédagogique distinctes ; Affecter programme version et cohorte ; Gérer groupes et parcours individualisés ; Créer tableau de bord étudiant récapitulatif ; Afficher crédits acquis requis et en attente ; Gérer interruption suspension et reprise d'études ; Traiter réorientation et changement de programme.

**États/erreurs à mettre en scène :** Doublon matricule ; double inscription incompatible ; transfert et perte de crédits.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### TEA — Enseignants et RH académiques

**Écrans et composants à développer :** Profil enseignant ; dépôt cours ; recrutement ; affectations ; missions ; contrats.

**Données affichées et éditées :** TeacherProfile, JobOpening, TeacherApplication, CredentialCheck, Contract, TeachingAssignment.

**Workflow déclenché :** Candidature → expertise → décision → contrat → affectation → renouvellement.

**Actions et formulaires indispensables :** Créer profil candidat enseignant complet ; Créer appel à candidatures par discipline région et niveau ; Autoriser candidatures spontanées et propositions de cours ; Déposer diplôme CV références publications et disponibilité ; Exiger syllabus et proposition pédagogique structurée ; Valider pièces et qualifications par contrôleur habilité ; Faire revue scientifique et pédagogique indépendante ; Gérer entretien démonstration et décision collégiale.

**États/erreurs à mettre en scène :** Diplôme falsifié ; conflit d'intérêts ; affectation expirée ; accès après départ.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### LMS — Studio de cours et LMS

**Écrans et composants à développer :** Studio ; syllabus ; éditeur ; apprenant ; ressources ; forum ; progression.

**Données affichées et éditées :** Course, CourseVersion, CourseOffering, Lesson, Resource, Activity, Completion.

**Workflow déclenché :** Brouillon cours → syllabus → modules/ressources → validation → édition par cohorte.

**Actions et formulaires indispensables :** Construire syllabus avec objectifs prérequis méthodes et bibliographie ; Créer modules leçons ressources et activités illimités ; Importer PDF DOCX PPTX EPUB images et fichiers structurés ; Gérer vidéo adaptative chapitrage et sous-titres ; Gérer audio transcription et vitesse de lecture ; Générer pages riches avec rendu HTML assaini ; Versionner tous contenus et conserver anciens étudiants ; Soumettre cours à validation disciplinaire pédagogique et droits.

**États/erreurs à mettre en scène :** Contenu corrompu ; modification d'édition notée ; faible réseau ; droits d'auteur.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### LIVE — Classes virtuelles et collaboration

**Écrans et composants à développer :** Calendrier ; salles ; invitations ; tableau blanc ; enregistrements.

**Données affichées et éditées :** LiveSession, Participant, Attendance, Recording, MeetingAsset.

**Workflow déclenché :** Planification → convocation → session → présence → ressources/suivi.

**Actions et formulaires indispensables :** Planifier séances avec fuseau et calendrier configurables ; Créer liens sécurisés de visioconférence ; Contrôler présence et invitations par rôle ; Fournir chat et outils collaboratifs ; Partager écran documents et tableau blanc via intégration ; Autoriser enregistrement uniquement sous politique et consentement ; Gérer salles de sous-groupes si fournisseur le supporte ; Notifier annulation report et changement de séance.

**États/erreurs à mettre en scène :** Lien divulgué ; annulation ; mauvaise connexion ; refus enregistrement.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### LAB — Laboratoires et travaux pratiques

**Écrans et composants à développer :** Studio TP ; énoncé ; sandbox ; dépôts ; corrections ; quotas.

**Données affichées et éditées :** PracticalAssignment, LabTemplate, LabInstance, Artifact, LabUsage.

**Workflow déclenché :** Attribution TP → environnement → travaux → soumission → correction.

**Actions et formulaires indispensables :** Créer TP individuels et collectifs associés à compétences ; Gérer modèles de travaux et fichiers autorisés ; Déployer environnement de pratique isolé et éphémère ; Restreindre réseau CPU RAM stockage et temps d'exécution ; Fournir consoles de développement et données fictives ; Créer TP sans laboratoire pour autres disciplines ; Gérer versionnement soumissions et accusés ; Permettre feedback annoté et resoumission autorisée.

**États/erreurs à mettre en scène :** Code hostile ; dépassement coût ; fuite réseau ; réutilisation sandbox.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### ASS — Évaluations internes

**Écrans et composants à développer :** Banques ; éditeur d'épreuve ; passage ; copies ; corrections.

**Données affichées et éditées :** QuestionBank, Item, Assessment, AssessmentVersion, Attempt, Submission, Rubric.

**Workflow déclenché :** Banque → épreuve → ouverture → soumission → correction.

**Actions et formulaires indispensables :** Créer banques questions typées et versionnées ; Gérer QCM appariement texte calcul code et fichiers ; Créer travaux individuels ou en équipes ; Configurer rubriques et barèmes selon programme ; Gérer sessions dates délais fuseaux et tentatives ; Protéger sujets et permettre tirages selon règles ; Gérer aménagements documentés et équitables ; Sauvegarder brouillons avant soumission.

**États/erreurs à mettre en scène :** Coupure pendant dépôt ; délais ; doublon ; sujet divulgué ; accommodations.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### GRD — Notes, crédits, jury

**Écrans et composants à développer :** Tableau notes ; crédits ; jurys ; PV ; rectifications ; recours.

**Données affichées et éditées :** Grade, GradeVersion, CreditAward, Jury, JuryDecision, Transcript, Appeal.

**Workflow déclenché :** Note proposée → modération → jury → validation → publication → recours.

**Actions et formulaires indispensables :** Calculer résultats depuis règles académiques versionnées ; Gérer échelles et coefficients configurables par programme ; Appliquer politiques d'arrondi documentées ; Distinguer notes provisoires validées et publiées ; Gérer validations UE et capitalisation de crédits ; Gérer compensation uniquement selon habilitation académique ; Organiser secondes sessions et absences justifiées ; Constituer jury avec membres et quorum.

**États/erreurs à mettre en scène :** Réévaluation tardive ; compensation non permise ; jury sans quorum.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### EXN — Examens nationaux externes

**Écrans et composants à développer :** Information officielle ; dépôt diplôme ; vérification ; historique.

**Données affichées et éditées :** ExternalExamReference, ExternalCredential, ExternalEvidence, Verification.

**Workflow déclenché :** Information → dépôt justificatif → contrôle → archivage.

**Actions et formulaires indispensables :** Publier informations sur dispositif externe sans prétendre organiser ; Distinguer examen national du moteur d'évaluation interne ; Enregistrer déclaration volontaire de participation étudiant ; Recevoir copie de résultat ou diplôme officiel ; Contrôler statut déposé en cours vérifié rejeté ; Empêcher génération de résultat d'examen national ; Empêcher émission de diplôme d'État par la plateforme ; Afficher clairement autorité officielle émettrice.

**États/erreurs à mettre en scène :** Fausse réussite ; faux diplôme ; confusion avec examen interne.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### FIN — Finances et tarification

**Écrans et composants à développer :** Tarifs ; factures ; comptes ; paiements ; remises ; rapprochements.

**Données affichées et éditées :** PriceRule, Invoice, InvoiceLine, Payment, Refund, Scholarship, LedgerEntry.

**Workflow déclenché :** Tarif → facture → échéance → paiement provider → reçu → rapprochement.

**Actions et formulaires indispensables :** Créer tarifs par pays région entité programme période et profil ; Gérer devises ISO 4217 et unités mineures ; Définir frais de dossier et coûts récurrents ; Gérer factures numérotées et notes de crédit ; Créer échéanciers et paiements partiels ; Gérer remises bourses et financements employeur ; Intégrer adaptateurs paiement sandbox et production ; Vérifier signatures de webhooks et idempotence.

**États/erreurs à mettre en scène :** Webhook dupliqué ; devise invalide ; chargeback ; erreur mobile money.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### CRED — Documents et diplômes

**Écrans et composants à développer :** Modèles ; documents ; délivrance ; vérificateur QR ; habilitations.

**Données affichées et éditées :** DocumentTemplate, IssuanceRule, Accreditation, Credential, Signature, Revocation.

**Workflow déclenché :** Modèle → validation droit émetteur → signature → émission → vérification/révocation.

**Actions et formulaires indispensables :** Créer modèles de documents modifiables par institution et langue ; Associer type de document à autorité émettrice ; Vérifier habilitations par programme pays et période ; Verrouiller diplômes officiels lorsque non habilités ; Générer attestations internes selon politique applicable ; Numéroter et signer documents selon procédure ; Créer QR de vérification à divulgation minimale ; Rendre registre de certificats vérifiable publiquement de façon limitée.

**États/erreurs à mettre en scène :** Habilitation expirée ; duplication numéro ; fuite de données sur QR.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### ENT — Campus-Entreprise : entreprises

**Écrans et composants à développer :** Inscription entreprise ; validation ; profil ; membres ; dashboard.

**Données affichées et éditées :** Company, CompanyVerification, CompanyMember, CompanyRole, Partnership.

**Workflow déclenché :** Inscription entreprise → KYB proportionné → validation → équipe → activités.

**Actions et formulaires indispensables :** Inscrire entreprise avec identité et justificatifs adaptés ; Vérifier existence légale et mandataire autorisé ; Approuver suspendre ou rejeter avec justification ; Autoriser plusieurs recruteurs par entreprise ; Appliquer périmètre de visibilité des données candidates ; Gérer profil public et informations privées séparées ; Gérer antennes et filiales si configurées ; Publier tableau de bord offres candidatures et partenariats.

**États/erreurs à mettre en scène :** Entreprise fictive ; représentant usurpé ; droits après départ.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### JOB — Offres, candidatures et recrutement

**Écrans et composants à développer :** Offres ; recherche ; candidature ; entretiens ; suivi ; alertes.

**Données affichées et éditées :** Opportunity, JobApplication, ApplicantSnapshot, Interview, SelectionDecision.

**Workflow déclenché :** Publication → modération → recherche → candidature → sélection → décision.

**Actions et formulaires indispensables :** Créer offres stage emploi alternance mission projet ; Configurer critères de candidatures et calendrier ; Modérer offres à risque et gérer signalements ; Rechercher avec filtres pays compétence langue et disponibilité ; Enregistrer favoris alertes et notifications opt-in ; Déposer CV lettre et pièces sous consentement ; Gérer version figée de candidature envoyée ; Gérer statuts présélection entretien offre rejet.

**États/erreurs à mettre en scène :** Offre frauduleuse ; candidature tardive ; données hors consentement.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### CAR — Portfolio et compétences

**Écrans et composants à développer :** Profil carrière ; compétences ; projets ; CV ; visibilité.

**Données affichées et éditées :** Skill, Evidence, PortfolioItem, CareerProfile, CVVersion, Match.

**Workflow déclenché :** Cours évalué → preuve de compétence → portfolio → offre adaptée.

**Actions et formulaires indispensables :** Créer référentiel de compétences dynamique et localisé ; Lier compétences aux cours et évaluations ; Distinguer déclarée enseignée évaluée validée certifiée ; Construire portfolio à visibilité contrôlée ; Générer CV modifiable et versions PDF ; Importer expériences externes marquées non vérifiées ; Produire suggestions d'offres explicables non discriminatoires ; Obtenir accord explicite avant partage recruteur.

**États/erreurs à mettre en scène :** Compétence déclarée prise pour diplôme ; profil exposé sans consentement.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### STG — Stages académiques

**Écrans et composants à développer :** Demande ; convention ; journal ; superviseur ; rapport ; évaluation.

**Données affichées et éditées :** Internship, InternshipAgreement, Supervisor, LogEntry, InternshipReview, InternshipGrade.

**Workflow déclenché :** Offre → sélection → convention → encadrement → rapport → notation.

**Actions et formulaires indispensables :** Associer stage à programme version UE ou formation libre ; Valider éligibilité et prérequis de placement ; Générer convention depuis modèle juridiquement valide ; Désigner maître de stage et encadreur académique ; Capturer signatures et approbations requises ; Gérer journal de bord et jalons étudiants ; Organiser échanges stagiaire entreprise encadreur ; Déposer rapports versions et pièces confidentielles.

**États/erreurs à mettre en scène :** Maître de stage absent ; rupture de convention ; absence étudiant.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### B2B — Services entreprises et partenaires

**Écrans et composants à développer :** Demandes B2B ; partenariats ; projets ; bourses ; forums.

**Données affichées et éditées :** B2BRequest, Contract, TrainingOrder, Sponsor, EnterpriseProject, CareerEvent.

**Workflow déclenché :** Demande → proposition → convention → mission → évaluation.

**Actions et formulaires indispensables :** Recevoir demandes de formation sur mesure d'entreprise ; Émettre proposition de programme et devis ; Inscrire groupes de collaborateurs sponsorisés ; Donner suivi autorisé aux gestionnaires d'entreprise ; Gérer missions d'innovation et projets d'étudiants ; Créer conventions de recherche appliquée ; Enregistrer mécénat parrainage et bourses entreprise ; Organiser forums emplois et stands virtuels.

**États/erreurs à mettre en scène :** Confidentialité des projets ; divergence contrat ; financement interrompu.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### SHORT — Formations courtes

**Écrans et composants à développer :** Catalogue court ; sessions ; badges ; clients entreprise.

**Données affichées et éditées :** ShortCourse, TrainingSession, LearnerEnrollment, CertificateRule.

**Workflow déclenché :** Catalogue → inscription → apprentissage → évaluation → attestation.

**Actions et formulaires indispensables :** Créer formations de toute durée sans rigidité semestrielle ; Organiser modules libres et compétences associées ; Inscrire public externe et salariés d'entreprise ; Configurer prix sessions et modalités ; Réutiliser contenus validés sous licence ; Contrôler progression et preuves de réussite ; Générer attestations privées selon politique ; Permettre empilement de microcertifications configurées.

**États/erreurs à mettre en scène :** Certificat présenté comme diplôme d'État ; parcours incomplet.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### MEM — Mémoires et soutenances

**Écrans et composants à développer :** Sujets ; candidatures ; corrections ; jury ; PV ; archives.

**Données affichées et éditées :** ThesisProject, Topic, SupervisorAssignment, Draft, Defense, DefenseOutcome.

**Workflow déclenché :** Sujet → validation → encadrement → rapport → jury → dépôt final.

**Actions et formulaires indispensables :** Créer catalogue et dépôt de sujets de mémoire ; Affecter directeur et codirecteur selon qualification ; Valider projet sujet et protocole ; Gérer jalons et dépôt de brouillons successifs ; Produire commentaires encadrement et corrections ; Gérer contrôle intégrité et anti-plagiat proportionné ; Constituer jury et convocations selon règlement ; Organiser soutenance virtuelle ou physique.

**États/erreurs à mettre en scène :** Soutenance sans jury ; mémoire plagié ; fuite de contenu confidentiel.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### PHD — Doctorat et école doctorale

**Écrans et composants à développer :** Doctorant ; comités ; rapports ; thèse ; soutenance.

**Données affichées et éditées :** DoctoralAdmission, DoctoralProgram, DoctoralStudent, Committee, ProgressReview, PhDDefense.

**Workflow déclenché :** Projet → admission → inscription → recherche → avis → soutenance → archive.

**Actions et formulaires indispensables :** Constituer dossier candidature scientifique doctoral ; Gérer école doctorale et laboratoires associés ; Valider projet de recherche et financement éventuel ; Désigner directeurs codirecteurs et comité de suivi ; Organiser réinscriptions et délais règlementaires configurés ; Suivre formations doctorales et séminaires ; Déposer rapports annuels et décisions de suivi ; Gérer participation scientifiques et publications.

**États/erreurs à mettre en scène :** Inscription périmée ; supervision perdue ; non-conformité éthique.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### RND — Recherche et innovation

**Écrans et composants à développer :** Laboratoires ; projets ; publication ; budget ; éthique.

**Données affichées et éditées :** Lab, ResearchProject, ResearchGrant, Publication, EthicsApproval, IPAsset.

**Workflow déclenché :** Appel → projet → financement → activités → livrables → clôture.

**Actions et formulaires indispensables :** Créer laboratoires et unités scientifiques ; Enregistrer chercheurs équipes et rattachements ; Suivre appels à projets et candidatures ; Gérer projet budgets jalons et livrables ; Associer financements et rapports justificatifs ; Enregistrer publications identifiants et liens bibliographiques ; Administrer dossiers d'éthique scientifique ; Gérer conflits d'intérêts et droits de propriété intellectuelle.

**États/erreurs à mettre en scène :** Données de recherche sensibles ; conflit d'intérêts ; embargo.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### LIB — Bibliothèque universitaire

**Écrans et composants à développer :** Catalogue ; recherches ; ressources ; licences ; abonnements.

**Données affichées et éditées :** LibraryItem, Collection, License, Acquisition, Loan, RepositoryDeposit.

**Workflow déclenché :** Acquisition → catalogage → autorisation → consultation/prêt → fin licence.

**Actions et formulaires indispensables :** Créer catalogue livres revues rapports et thèses ; Classer métadonnées auteurs thèmes langues et versions ; Gérer abonnements et droits d'accès par établissement ; Assurer consultation de documents sous licence ; Permettre prêts numériques si droit accordé ; Suivre acquisitions coûts et renouvellements ; Produire recherche avancée et favoris ; Gérer dépôts institutionnels des mémoires et thèses.

**États/erreurs à mettre en scène :** Licence expirée ; diffusion illicite ; ouvrage réservé.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### CAMP — Vie universitaire et communauté

**Écrans et composants à développer :** Groupes ; clubs ; forum ; événements ; tutorat ; mentorat.

**Données affichées et éditées :** Community, Group, Membership, Post, Event, Mentorship, ModerationCase.

**Workflow déclenché :** Inscription groupe → participation → événements → modération.

**Actions et formulaires indispensables :** Créer communautés de promotion filière et intérêt ; Gérer clubs et associations avec responsables ; Offrir forums thématiques modérés et recherche ; Autoriser activités de groupe et livrables communs ; Organiser mentorat étudiants Alumni enseignants ; Gérer événements virtuels et physiques autorisés ; Proposer tutorat et rendez-vous pédagogique ; Gérer signalements contenu abusif et procédures.

**États/erreurs à mettre en scène :** Harcèlement ; divulgation données ; absence de modération.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### SUP — Support, recours et services

**Écrans et composants à développer :** Centre aide ; formulaires ; tickets ; recours ; rendez-vous.

**Données affichées et éditées :** Ticket, ServiceRequest, SLA, Escalation, KnowledgeArticle, AppealCase.

**Workflow déclenché :** Ticket → classification → affectation → résolution → satisfaction.

**Actions et formulaires indispensables :** Créer demandes administratives et tickets multicanaux ; Configurer catégories et formulaires dynamiques ; Affecter demandes selon région et compétence ; Définir SLA échéance et escalade ; Gérer messagerie dossier et pièces jointes sécurisées ; Fournir FAQ et base de connaissances ; Gérer recours académiques avec séparation des rôles ; Consigner médiation et décisions motivées.

**États/erreurs à mettre en scène :** Ticket critique ; conflit ; dépassement de SLA ; données protégées.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### NOT — Messagerie et notifications

**Écrans et composants à développer :** Boîte ; préférences ; templates ; campagne ; logs.

**Données affichées et éditées :** Message, Notification, Template, Preference, DeliveryAttempt, Thread.

**Workflow déclenché :** Evénement → modèle → canal → livraison → statut/relance.

**Actions et formulaires indispensables :** Créer messagerie interne avec conversations et droits ; Gérer templates multilingues versionnés ; Configurer notifications par événement et portée ; Respecter préférences et consentements ; Fournir email avec adapter sandbox et réel ; Fournir SMS avec adapter sandbox et réel ; Gérer push web facultatif sous consentement ; Gérer files relances et échecs temporaires.

**États/erreurs à mettre en scène :** E-mail non délivré ; invitation expirée ; message envoyé au mauvais acteur.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### ALUM — Alumni et formation tout au long de la vie

**Écrans et composants à développer :** Annuaire opt-in ; carrière ; événements ; offres.

**Données affichées et éditées :** AlumniProfile, AlumniConsent, NetworkConnection, ContinuingEducation.

**Workflow déclenché :** Fin parcours → activation Alumni → réseau → mentorat/reformation.

**Actions et formulaires indispensables :** Convertir profil étudiant vers Alumni sans recréer identité ; Conserver documents autorisés sous politique de conservation ; Gérer annuaire Alumni à visibilité volontaire ; Proposer événements et mentorat ; Proposer offres de formation continue ; Permettre mise à jour du parcours professionnel ; Mesurer insertion avec consentement et agrégation ; Donner fermeture export et contrôle des données.

**États/erreurs à mettre en scène :** Exposition profil ancien étudiant ; accès aux notes expiré.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### QMS — Assurance qualité et accréditation

**Écrans et composants à développer :** Référentiels ; audits ; preuves ; non-conformités ; plans d'action.

**Données affichées et éditées :** QualityStandard, Criterion, Evidence, Audit, Finding, CAPA, AccreditationFile.

**Workflow déclenché :** Référentiel → autoévaluation → contrôle → non-conformité → action → vérification.

**Actions et formulaires indispensables :** Configurer référentiels qualité par pays et programme ; Associer critères qualité à sources de données vérifiables ; Créer campagnes d'autoévaluation institutionnelle ; Gérer preuves documents et responsables ; Organiser audits internes et externes habilités ; Enregistrer non-conformités et causes racines ; Créer plans d'actions responsables et échéances ; Vérifier efficacité et clôture des actions.

**États/erreurs à mettre en scène :** Preuve périmée ; faux statut d'accréditation ; action non clôturée.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### DPO — Protection des données et conformité

**Écrans et composants à développer :** Politiques ; données ; consentements ; droits ; conservation.

**Données affichées et éditées :** LegalBasis, ProcessingActivity, RetentionPolicy, DataSubjectRequest, Consent.

**Workflow déclenché :** Politique régionale → consentement/traitement → demande → réponse/audit.

**Actions et formulaires indispensables :** Déclarer bases légales de traitements par région ; Construire registre des traitements de données ; Configurer rétentions et archivage par catégorie ; Permettre accès rectification portabilité selon droit applicable ; Gérer opposition ou retrait de consentement quand applicable ; Contrôler transferts de données entre pays ; Segmenter catégories sensibles et accès restreints ; Gérer notification d'incidents selon processus.

**États/erreurs à mettre en scène :** Conflit obligation de conservation/droit suppression ; transfert non autorisé.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### ANA — Statistiques et décisionnel

**Écrans et composants à développer :** Tableau de bord ; rapports ; exports ; observabilité métier.

**Données affichées et éditées :** MetricDefinition, EventFact, Dashboard, Report, DataExport.

**Workflow déclenché :** Collecte → définition métrique → agrégation → publication.

**Actions et formulaires indispensables :** Configurer tableaux de bord institutionnels par rôle ; Calculer admissions taux conversion et cohortes ; Suivre progressions pédagogiques distinctes des notes ; Calculer résultats et taux de réussite vérifiables ; Suivre paiement créances et bourses ; Suivre performance cours et délais feedback ; Mesurer placements stages emplois et entreprises ; Mesurer projets recherche et productions.

**États/erreurs à mettre en scène :** Double comptage ; effet petit groupe ; métrique recalculée après correction.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### AI — Assistance IA responsable

**Écrans et composants à développer :** Assistant étudiant ; enseignant ; administration ; suivi et coûts.

**Données affichées et éditées :** AIModelPolicy, PromptTemplate, RetrievalSource, AIInteraction, AIReview.

**Workflow déclenché :** Consentement → requête → RAG facultatif → suggestion → contrôle humain.

**Actions et formulaires indispensables :** Créer adaptateur IA désactivable et régionalisable ; Indexer seulement ressources pédagogiques autorisées ; Fournir citations vers les cours et sources internes ; Aider étudiant à comprendre sans livrer corrigés interdits ; Aider enseignant à générer brouillons et quiz ; Aider agent à retrouver procédures administratives ; Définir modération et filtrage de secrets ; Protéger dossiers sensibles contre accès au modèle non autorisé.

**États/erreurs à mettre en scène :** Hallucination ; fuite de dossier ; coût excessif ; biais.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### I18N — Langues, devises et temporalité

**Écrans et composants à développer :** Editeur traductions ; préférences ; terminologie ; fuseaux.

**Données affichées et éditées :** Locale, Translation, Terminology, CurrencyConfig, CalendarRule.

**Workflow déclenché :** Configuration langue région → rendu → contenu localisé → contrôle.

**Actions et formulaires indispensables :** Définir langues d'interface indépendantes des langues de cours ; Gérer dictionnaire et ressources i18n externalisées ; Permettre traduction des titres de structures et programmes ; Appliquer formats nombres devises et adresses locaux ; Gérer fuseaux IANA et changement heure légale ; Configurer calendriers universitaires et jours non ouvrés ; Gérer adaptation contenu pédagogique par territoire ; Prévoir fallback explicite lorsque traduction manque.

**États/erreurs à mettre en scène :** Date ambiguë ; devise arrondie ; changement langue sans contenu.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### A11Y — Accessibilité et faible débit

**Écrans et composants à développer :** Préférences ; lecteur ; dépôt hors ligne ; transcription.

**Données affichées et éditées :** AccessibilityPreference, OfflineDraft, SyncConflict, CaptionTrack.

**Workflow déclenché :** Choix préférences → consultation → dépôt → reprise.

**Actions et formulaires indispensables :** Concevoir navigation clavier et sémantique accessible ; Atteindre WCAG 2.2 AA sur parcours critiques ; Fournir contraste lisible tailles et zoom jusqu'à 200 pourcent ; Sous-titrer et transcrire contenus vidéo audio ; Proposer version texte téléchargeable des cours ; Adapter bitrate vidéo et tailles ressources ; Sauvegarder brouillons avec indication de synchronisation ; Reprendre activité après reconnexion sans doublon.

**États/erreurs à mettre en scène :** Rupture réseau ; conflits ; lecteur écran ; vidéo inaccessible.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### DOC — GED et archivage institutionnel

**Écrans et composants à développer :** GED ; dossiers ; versions ; approbations ; recherche.

**Données affichées et éditées :** FileAsset, DocumentVersion, Folder, Classification, AccessGrant, RetentionRule.

**Workflow déclenché :** Dépôt → contrôle → classification → revue → archive/retrait.

**Actions et formulaires indispensables :** Importer fichiers avec scan antivirus et checksum ; Stocker fichiers privés avec URLs temporaires signées ; Classer documents par typologie dossier et portée ; Conserver versions et auteurs des documents ; Fournir workflow de relecture et approbation ; Gérer niveaux de confidentialité et partage contrôlé ; Prévisualiser formats courants de manière isolée ; Rechercher contenus avec ACL appliquées.

**États/erreurs à mettre en scène :** Malware ; archive illisible ; suppression illégitime.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### WF — Moteur de processus configurable

**Écrans et composants à développer :** Editeur workflow ; designer formulaires ; instances ; escalade.

**Données affichées et éditées :** WorkflowDefinition, WorkflowVersion, State, Transition, WorkflowInstance, ActionLog.

**Workflow déclenché :** Concevoir → simuler → publier version → exécuter → auditer.

**Actions et formulaires indispensables :** Construire machines états configurables et typées ; Définir transitions gardes permissions et validations ; Designer formulaires dynamiques accessibles ; Configurer approbation parallèle ou séquentielle ; Associer notifications et délais de traitement ; Simuler workflow sur cas de tests avant publication ; Versionner définitions sans briser instances actives ; Exécuter effets secondaires idempotents.

**États/erreurs à mettre en scène :** Instance en cours lors édition ; contournement condition ; effet secondaire répété.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### INTG — API et intégrations externes

**Écrans et composants à développer :** Catalogue intégrations ; secrets ; état ; webhooks ; contrats.

**Données affichées et éditées :** Integration, ProviderCredentialRef, WebhookDelivery, ImportJob, ExportJob.

**Workflow déclenché :** Créer connecteur → sandbox → test contrat → activation → supervision.

**Actions et formulaires indispensables :** Publier OpenAPI 3.1 versionnée et contrats schématisés ; Gérer clé d'idempotence sur écritures critiques ; Fournir webhooks sortants signés et rejouables ; Recevoir webhooks entrants avec vérification de signature ; Créer adaptateurs paiement email SMS vidéo et stockage ; Supporter LTI 1.3 via connecteur conforme ; Préparer import export QTI sans perte sémantique ; Préparer Open Badges 3.0 avec preuves de compatibilité.

**États/erreurs à mettre en scène :** Changement API provider ; quota ; signature invalide ; indisponibilité.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### SEC — Sécurité technique et fraude

**Écrans et composants à développer :** Console sécurité ; incidents ; audit ; accès ; alertes.

**Données affichées et éditées :** SecurityFinding, AuditEvent, Incident, SecurityPolicy, AccessReview.

**Workflow déclenché :** Threat model → politiques → tests → supervision → remédiation.

**Actions et formulaires indispensables :** Maintenir threat model par module et flux ; Appliquer contrôle d'accès serveur sur chaque endpoint ; Tester isolation inter-entités et inter-régions ; Durcir session cookie CSRF CSP et headers ; Contrôler fichiers dangereux et contenu HTML ; Gérer rotation secrets et privilèges minimaux ; Implémenter MFA obligatoire pour fonctions sensibles ; Fournir audit append-only des actes sensibles.

**États/erreurs à mettre en scène :** IDOR ; injection ; faux paiement ; privilège excessif ; fuite.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

### OPS — Exploitation et réversibilité

**Écrans et composants à développer :** CI ; déploiement ; supervision ; sauvegarde ; incidents ; exports.

**Données affichées et éditées :** PipelineRun, Release, Deployment, Alert, RestoreExercise, DataPackage.

**Workflow déclenché :** Build → test → release → monitoring → backup → disaster recovery.

**Actions et formulaires indispensables :** Construire CI lint typage tests migrations sécurité ; Séparer branches environnements et secrets ; Publier versions avec changelog et artefacts ; Fournir déploiement automatisé documenté ; Exécuter tests smoke après déploiement ; Surveiller latence erreurs jobs files et coût ; Définir SLO alertes on-call et incident response ; Exécuter test de montée en charge représentatif.

**États/erreurs à mettre en scène :** CI rouge ; rollback incompatible ; perte de messages ; verrou fournisseur.

**Vérification :** afficher, saisir, valider, sauvegarder, modifier selon version, refuser selon droits et déclencher les notifications ; tester sur mobile, écran vide et double soumission.

## Écrans livrés — administration des territoires (lot 005)

`/administration/territoires` : sélection de portée paginée, identité régionale
(type, nature, portée mère, fuseau, monnaie, format régional, fenêtre de présence),
identité légale et contacts pour les établissements, désignations traduites,
portées filles paginées, rattachements datés avec clôture, et formulaires de
création, de modification, de traduction, de rattachement et de déclaration de
type. États vides, messages d'erreur par code HTTP, tableaux annoncés aux
lecteurs d'écran et navigation au clavier sans script client.
