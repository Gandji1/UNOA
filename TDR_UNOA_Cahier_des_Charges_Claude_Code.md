# UNIVERSITÉ NUMÉRIQUE OUEST-AFRICAINE (UNOA)

## TERMES DE RÉFÉRENCE (TDR) ET CAHIER DES CHARGES TECHNICO-FONCTIONNEL EXÉCUTABLE

**Référence :** UNOA-TDR-2026-001 · **Version :** 2.0 · **Date :** 18 novembre 2026  
**Destination :** agent autonome Claude Code, architectes, développeurs, testeurs, DevSecOps, administration universitaire  
**Pays pilote :** Bénin · **Portée :** Afrique de l'Ouest, extension internationale  
**Statut :** spécification cible pour implémentation intégrale, sous réserve des dépendances externes explicitement documentées.

> **DIRECTIVE ABSOLUE À L'AGENT CLAUDE CODE.** Avant la première ligne de code, au début de chaque session ET avant chaque lot de modifications, lire `CLAUDE.md`, le présent TDR, le projet institutionnel d'origine et les annexes applicables. Recenser les exigences et les dépendances du lot, définir les tests d'acceptation, puis seulement implémenter. Après chaque changement, mettre à jour la traçabilité et les preuves. **Ne jamais assimiler un écran, une maquette, une API factice, un `TODO` ou un test simulé à une fonctionnalité terminée.** Ne jamais réduire silencieusement le périmètre. Une exigence non livrée reste explicitement ouverte ou bloquée. Aucun déploiement de production ne peut être déclaré complet si une exigence obligatoire n'est pas vérifiée.

---

# 1. OBJET, VISION ET HIÉRARCHIE DES RÉFÉRENCES

## 1.1 Objet contractuel

Le présent document prescrit la conception, la réalisation, les migrations, la documentation, les tests, la sécurité, l'exploitation et la recette d'une **université numérique intégrée** couvrant Licence, Master, Doctorat, formations courtes, enseignement continu, recherche, services aux apprenants, gouvernance, gestion des personnels et Campus-Entreprise. L'objectif n'est **pas** un prototype, une plateforme de vidéos, un assemblage de pages ou une démonstration. Le livrable cible est un produit exploitable, documenté, accessible, interopérable, sécurisé, testable et administrable sans intervention permanente d'un développeur.

## 1.2 Priorité des sources en cas de divergence

1. Loi, autorisation ou restriction réglementaire applicable et preuve officielle vérifiée : impératif, sans contournement technique.
2. Instructions de sécurité et de confidentialité ; interdiction d'exposer des données, secrets ou droits non autorisés.
3. Présent TDR, exigences identifiées, critères d'acceptation et invariants métiers.
4. `docs/00_PROJET_INSTITUTIONNEL_REFERENCE.md` : vision et étendue du projet ; conserver toute capacité non contredite.
5. Décisions d'architecture enregistrées dans `docs/ADR/` et registre des décisions.
6. Conventions techniques du dépôt ; jamais supérieures aux règles métiers et à la sécurité.

Si deux exigences se contredisent, choisir provisoirement le comportement **le plus sûr**, journaliser la contradiction, empêcher toute opération irréversible concernée et réaliser les autres fonctionnalités. Ne jamais inventer une autorisation administrative ni un prestataire opérationnel.

## 1.3 Doctrine immuable

**Zéro contenu académique codé en dur.** Aucun cours, filière, diplôme, faculté, grille de notation, calendrier, pays, devise, langue, barème, condition d'admission ou workflow spécifique ne sera imposé dans le code métier. Les logiciels livrent des moteurs, schémas, éditeurs, règles et gabarits **vides ou optionnels**, non des formations prédéfinies. Les contraintes de sécurité universelles, clés techniques et protocoles ne sont pas des contenus pédagogiques.

**Configuration territoriale hiérarchique.** Les règles effectives se résolvent par plateforme → zone réglementaire → pays → région → établissement/entité légale → campus/centre → faculté → département → programme/version → cohorte/session → acteur lorsque pertinent. Les limites réglementaires et les protections de données ne deviennent jamais moins strictes par héritage local.

**Capacité ≠ habilitation.** L'outil sait gérer tous les cycles et documents, mais n'active officiellement une activité réglementée que si la preuve d'habilitation correspond au pays, à l'établissement, au programme, à la période et au type de document. Aucun mécanisme de démonstration ou de superadministration ne peut contourner les interdictions.

**Un utilisateur, plusieurs fonctions.** Identité numérique unique et responsabilités attribuées dans des portées datées, sans duplication artificielle des personnes.

**Historique inviolable au niveau métier.** Les programmes, notes, crédits, décisions, contrats, documents et configurations publiés sont versionnés ; les rectifications se font par procédure et événements auditables, non par écrasement silencieux.

**Fonctionnalités réelles et verticalement achevées.** Une fonctionnalité requiert interface, API, validations, persistance, autorisations, audit, notifications pertinentes, documentation, tests positifs et négatifs, fonctionnement mobile et accessibilité.

## 1.4 Résultat attendu et exclusion de responsabilité

Le développement doit fournir l'ensemble des capacités nécessaires à une université de référence et permettre leur activation technique. Il ne peut, à lui seul, créer l'université comme personne morale, obtenir des accréditations, embaucher des personnes, fournir des contrats de paiement, décider de conventions institutionnelles, donner accès aux serveurs, ou obtenir les autorisations de diplômes. Ces dépendances sont des **conditions externes à documenter**, jamais des prétextes pour omettre les modules. Les modules doivent rester fonctionnels en environnement de test à l'aide de fournisseurs locaux/sandbox, tout en désactivant les opérations de production dépendant d'une habilitation ou de secrets absents.

# 2. RÈGLES DE MISSION AUTONOME DE CLAUDE CODE

## 2.1 Contrôle avant toute implémentation — obligatoire

Au début de **chaque** session et de **chaque** lot :

1. Lire le fichier `CLAUDE.md` à la racine du dépôt puis le présent TDR, avec recherche dans les sections concernées ; lire le projet de référence et les annexes ; vérifier les changements récents.
2. Examiner le dépôt, les migrations, les tests, les dépendances, les erreurs connues et l'état de la traçabilité. Ne pas recréer un système existant sans raison explicite.
3. Sélectionner les identifiants d'exigences (REQ-…), ouvrir/actualiser la ligne correspondante dans `docs/MATRICE_EXIGENCES.csv` ; identifier les parcours affectés.
4. Produire ou actualiser une courte fiche de lot : objectif, dépendances, modèle de données, règles, écrans, APIs, risques, tests d'acceptation et stratégie de rollback.
5. Vérifier les décisions architecturales et les configurations héritées ; réaliser une recherche globale pour empêcher la duplication ou l'introduction de valeurs en dur.
6. Définir les tests **avant** la modification de code ; inclure les cas d'échec, de sécurité, de multi-pays, de faible connexion et d'accessibilité appropriés.
7. Implémenter complètement le lot et faire fonctionner les tests ; exécuter les contrôles généraux de non-régression.
8. Mettre à jour la matrice, les documents, l'ADR si nécessaire, le journal de développement, les preuves et les blocages ; vérifier la liste de réception.

**Interdictions :** saut de relecture, changement non traçable, création d'un champ « fourre-tout » pour contourner un modèle manquant, appel API fictif présenté comme réel, test `skip` caché, suppression de test pour faire passer CI, mot de passe par défaut de production, vérification des droits seulement dans l'interface, insertion directe d'un grade/diplôme national dans la base pour débloquer une démo, court-circuit du journal d'audit, création forcée de données académiques de production.

## 2.2 Algorithme de décision sans consultation régulière du porteur

Lorsque le choix n'est pas fixé, adopter dans cet ordre : (a) impératif légal ou de sécurité ; (b) norme publique pertinente ; (c) option simple, maintenable, ouverte et réversible ; (d) **valeur par défaut sûre et configurable**, accompagnée d'un test et d'une note de décision. Si le choix implique un coût, un risque ou une irréversibilité externe, n'effectuer **aucun** paiement, signature, délivrance officielle ou mise en production : préparer le module et enregistrer le prérequis. Préférer un comportement « désactivé en production / testable en sandbox » à une supposition.

La consigne « sans recours au porteur » signifie **ne pas interrompre le développement pour chaque choix ordinaire**, et non usurper son pouvoir d'engagement ou inventer des données juridiques. L'agent produit un registre de décisions à approuver ultérieurement si elles requièrent une autorité humaine.

## 2.3 Terminé signifie démontré

Une exigence est **Done** si tous ces éléments existent et sont vérifiés : schéma+migration ; règles métier ; API ; interface utilisable ; permissions serveur ; validations ; tests unitaires/intégration/E2E ; contrôle d'erreurs ; documentation ; audit si événement sensible ; traduction/internationalisation ; fonctionnement sur mobile ; surveillance opérationnelle ; preuve de test liée dans la matrice. Toute dépendance externe bloquée doit être mentionnée ; un adaptateur sandbox n'est pas la preuve d'une intégration réelle en production.

# 3. ACTEURS, PORTAILS ET ORGANISATION

## 3.1 Acteurs

Public/prospect ; candidat étudiant ; étudiant ; auditeur de formation ; apprenant entreprise ; diplômé/Alumni ; doctorant ; enseignant candidat ; enseignant contractuel ; auteur de contenus ; responsable UE ; tuteur ; correcteur ; directeur de mémoire ; directeur de thèse ; chercheur ; examinateur/juré ; mentor ; responsable programme ; chef de département ; doyen ; directeur d'études ; personnel admissions ; scolarité ; finances ; RH ; bibliothécaire ; responsable stage/insertion ; responsable recherche ; qualité ; protection des données ; support ; administrateur d'établissement ; responsable régional ; administrateur plateforme ; auditeur externe habilité ; entreprise (propriétaire, recruteur, maître de stage) ; partenaire académique ; organisme financeur.

Les rôles sont des **ensembles de permissions configurables**, attachés à une portée, une période, un motif et une autorité d'attribution. Le rôle `superadmin` n'est pas un passe-droit de diplomation, de consultation de santé ou d'accès aux secrets. Tout accès exceptionnel requiert procédure « break-glass » limitée, justifiée, alertée et auditée.

## 3.2 Portails minimaux

Portail public/CMS ; admissions candidat ; étudiant ; enseignant ; administration/université ; faculté/département ; finance/RH ; recherche/doctorat ; Campus-Entreprise (entreprise + étudiant + université) ; Alumni ; bibliothèque ; qualité/audit ; support ; administration territoriale/configuration ; vérification de document public limitée ; applications mobiles responsives. Les vues sont assemblées par permission et par contexte, pas par duplications de comptes.

## 3.3 Instances et décisions

Configurer conseil d'administration, conseil académique, comité pédagogique, jury, comité de recherche, cellule qualité, commissions d'admission, commissions d'appel et autres organes selon l'établissement. Procès-verbaux, quorum, ordre du jour, avis, décisions, délégations, conflits d'intérêts, signatures, documents annexés et règles de publication sont historisés. Aucune simulation d'un quorum ou vote institutionnel n'est acceptée en production.

# 4. CONCEPTION DU SOCLE : RÉGIONS, PARAMÈTRES, RÈGLES

## 4.1 Modèle territorial et administratif

Une juridiction est un objet régissant des obligations ; un territoire est un périmètre géographique ; une entité légale est une institution ; un centre/campus est un lieu ou une unité opérationnelle. **Ne pas les confondre**. Plusieurs centres peuvent partager une institution ; un programme peut être proposé dans plusieurs territoires avec règles différentes ; les qualifications peuvent avoir plusieurs autorités émettrices.

Créer des tables de `scope`, `territory`, `jurisdiction`, `legal_entity`, `campus`, `faculty`, `department`, `program_offering`. Relations datées et contrôlées, sans tables `benin_program`, `burkina_program`, etc.

## 4.2 Moteur de configuration typé

Chaque définition de paramètre comporte : clé stable, type (texte/nombre/booléen/date/durée/devise/enum dynamique/json validé), description, valeur par défaut sûre, limites, niveau autorisé, possibilité d'héritage, politique de confidentialité, nécessité d'approbation, date d'effet, version et compatibilité. Chaque valeur comporte portée, provenance, auteur, approbateur, période effective, raison et état. Résolution **déterministe** par portée et date. Conserver un instantané des règles qui gouvernent chaque inscription, note, document et transaction.

Exemples : notation (plage et précision) ; coefficient ; règle de compensation ; frais ; échéanciers ; calendrier ; politique d'admission ; caractère obligatoire d'un stage ; modalités de soutenance ; modèle de certificat ; liste des catégories documentaires ; langues ; devise ; fuseau ; âge minimum lorsque légalement applicable ; pays de délivrance ; fournisseurs de paiement autorisés ; durée de conservation ; consentement ; seuils de surveillance ; capacités des centres.

## 4.3 Conflits de paramètres et garde-fous

L'héritage suit la priorité explicite **programme/version > département > faculté > établissement > pays > zone > global**, uniquement pour les clés dont l'override est permis. La **politique minimale de sécurité et les restrictions légales** sont appliquées après résolution sous forme de contraintes non dérogeables (deny-overrides). Chaque résolution fournit valeur finale + chaîne de provenance + version + date. Pas de rétroaction rétroactive silencieuse sur les cohortes existantes. Invalidations de cache transactionnelles après publication.

## 4.4 Editeur no-code pour structures et workflows

Interfaces permettant : créer des types de formulaires dynamiques (champs, masques, conditions, pièces, visibilité, accessibilité), règles de validation, circuits de signature/approbation, séquences d'états, matrices de critères, modèles de documents, tableaux de bord et rapports. Fournir prévisualisation, tests de règle, simulation « quel résultat pour ce profil ? », comparaison de versions, validation croisée, publication différée et retour arrière sûr. **Pas d'exécution arbitraire de JavaScript ou SQL fourni par un administrateur** ; utiliser un langage de règles limité, validé et exécuté dans une sandbox contrôlée.

## 4.5 Test d'indépendance du contenu

En base vierge, aucun catalogue académique n'apparaît. Créer via UI une région fictive Alpha et une région Beta : langues, années, barèmes, devises, calendrier, structures, programmes, critères et documents différents. Vérifier qu'aucune modification de code n'est requise, que les droits sont isolés, que l'héritage est explicable et que les cohortes anciennes gardent leurs règles.

# 5. MOTEUR ACADÉMIQUE ET PROGRAMMES

## 5.1 Modèle universitaire extensible

Université → structures libres (école/faculté/institut) → départements → domaines → filières/mentions → spécialités/parcours → programmes/version → périodes (années/semestres/trim. ou sessions) → UE → EC/cours → modules → leçons → activités. Cette séquence est un **modèle possible et configurable**, non un nombre fixe de niveaux dans le code. Fournir des relations, contraintes d'unicité par portée et historique des réorganisations.

Chaque programme définit nature, autorité compétente, statut légal, objectifs, compétences, admission, langues, durée, crédits/capitalisation/transfert, format, organisation, progression, prérequis, options, passerelles, obligations de stage/mémoire, règles de jury, calendrier, prix, capacités, zones éligibles, documents émissibles et propriétés d'affichage.

## 5.2 Création et publication

L'administrateur construit un programme de manière guidée, sauvegarde ses brouillons, ajoute UE/cours, affecte des volumes et ressources, simule son parcours, lance la validation puis publie une **version immuable**. Il peut ouvrir une nouvelle version, paramétrer une équivalence de transition, migrer des cohortes par décision tracée, ou fermer l'admission sans supprimer l'historique. La construction ne signifie pas qu'un programme est légalement ouvert.

## 5.3 LMD et parcours alternatifs

Le moteur supporte Licence, Master, Doctorat et variantes approuvées : régimes classique, professionnel, recherche, alternance, hybride, enseignement à distance, formation courte par compétences, microcertification, parcours modulaire, sessions intensives et formations d'entreprise. Configurer le système de crédits selon le référentiel juridiquement applicable ; aucune règle `ECTS = 30` ou note `sur 20` n'est une hypothèse universelle dans le code. Les chiffres normalisés, lorsqu'applicables, sont des **configurations approuvées**.

## 5.4 Préservation des anciens parcours

Maquette 2027 ≠ maquette 2029 ; le student-record, les crédits et les décisions font référence à une version et à un instantané de règles. Les suppressions physiques de contenus académiques publiés sont interdites hors procédures de conservation légalement fondées.

# 6. ADMISSIONS, SCOLARITÉ ET VIE ÉTUDIANTE

## 6.1 Cycle candidat → étudiant

Recherche et comparaison des offres ; orientation ; compte ; candidature multi-programmes ; formulaires dynamiques et pièces ; brouillon ; dépôt horodaté ; paiement d'étude si autorisé ; vérification ; évaluation ; compléments ; avis ; admission/refus/liste d'attente ; recours ; acceptation ; facture ; inscription administrative ; inscription pédagogique ; matricule par règle de numérotation ; affectation à la cohorte et groupes ; accès aux cours. L'admission ne dépend **jamais uniquement** d'un paiement.

## 6.2 Cas complexes

Admissions internationales ; diplômes étrangers ; mobilité ; transferts ; équivalences ; acquis antérieurs ; mineurs avec représentants légaux le cas échéant ; bourses ; interruption ; réinscription ; réorientation ; double inscription autorisée ; changement de régime ; mesures d'accessibilité ; décisions conditionnelles ; dérogations traçables ; décès/archivage du dossier ; droits à l'information.

## 6.3 Scolarité

Dossier électronique, inscriptions et historique ; calendriers, assiduité adaptée, résultats provisoires/officiels, relevés, attestations, examens internes, demandes, remboursements admissibles, convocations, suivi des crédits, changements d'année, compléments, rattrapages, délibérations, contestations, clôture et statut Alumni. Les changements de dossier sensibles sont approuvés et auditables.

# 7. RECRUTEMENT ENSEIGNANT, CARRIÈRE ET MISSIONS

## 7.1 Candidature

Appels à candidatures et propositions spontanées, dossier complet (CV, qualifications, grades, titres, pièces, références, publications/ORCID optionnel, disponibilité, langues, expérience) et **dossier pédagogique obligatoire pour un cours proposé** : syllabus, objectifs, compétences, progression, PDF/DOCX/PPTX/vidéo/audio, cas pratiques, TP/TD, quiz, devoirs, rubriques, bibliographie, droits de diffusion, plan de tutorat, accessibilité. Validation des formats et antivirus ; conservation sécurisée des justificatifs.

## 7.2 Sélection et gestion

Contrôle des pièces → comité académique → revue scientifique/disciplinaire → évaluation pédagogique → entretien éventuel → décisions → contrat → habilitation → affectation datée → renouvellement. Distinguer auteur, enseignant animateur, tuteur, correcteur, responsable UE, jury, directeur mémoire/thèse. Déclaration d'intérêts, rémunération, feuilles de prestation, commentaires pédagogiques, développement professionnel, révocation et contrôle des accès lors des départs.

# 8. LMS, STUDIO PÉDAGOGIQUE, INTERACTIVITÉ

## 8.1 Concepteur de cours

Le cours est distinct de son **offre de cours** pour une promotion. Cours > versions > modules > leçons > ressources/activités ; disponibilité, objectifs, critères, accessibilité, temps prévu, prérequis, compétences, droits d'auteur ; brouillons, relecteurs, approbations, publication, expiration, traduction, réutilisation. Support : PDF, Word, PowerPoint, EPUB, image, audio, vidéo (flux adaptatif), HTML sécurisé, fichiers, code, tableurs, tableaux blancs, liens, SCORM ou équivalents si retenus, contenus interactifs normalisés et outils LTI.

## 8.2 Apprentissage

Parcours personnalisé, pré-tests, séquences et portes conditionnelles, progression, favoris, notes personnelles, transcriptions/sous-titres, suivi du temps en distinguant comportement d'acquis, forums, messages, groupes, travaux collectifs, badges de progression non officiels, sessions synchrones, archives/consentement aux enregistrements, tutorat, remédiation, rappels, capacité faible connexion, reprise de devoir après coupure.

## 8.3 TD/TP, laboratoires et ressources

TD et TP avec rubriques, formats autorisés, submissions, versions, plagiat sous politique proportionnée, outils de commentaires et annotations, resoumission, laboratoire technique isolé, quota de calcul, images reproductibles, arrêt automatique, traçabilité et gestion des coûts. Les travaux physiques ou professionnels réglementés requièrent partenaires/centres autorisés et ne sont jamais réputés couverts par une simulation.

# 9. ÉVALUATIONS, NOTES, JURYS, RATTRAPAGES

## 9.1 Épreuves internes

Banque de questions versionnée, étiquettes de compétence/difficulté, QCM, question ouverte, texte, fichier, essai, calcul, code, audio, vidéo, projet, groupe, oral, soutenance ; tests chronométrés ou non ; sessions ; calendrier ; fuseaux ; tirages ; accommodations ; reprise sous politique ; protection anti-fuite ; horodatage côté serveur ; soumission fiable et reçu ; correction humaine/automatisée validée ; grilles ; double correction ; modération ; recours ; conservation des preuves.

## 9.2 Notes et décisions

Machine d'états distincte : brouillon → proposée → contrôlée → validée → publiée ; corrections par avenant ; règles et formule de moyenne versionnées, précision et arrondi configurés, compensation seulement si autorisée, quotas/capitalisation, règles de crédits, seconde session, absence, fraude et recours ; jury avec convocations, conflit d'intérêts, quorum, PV, signatures et publication contrôlée. Une note « visible » n'est pas automatiquement une délibération officielle.

## 9.3 Examens nationaux du Bénin

**Frontière ferme :** les examens nationaux sont organisés, surveillés, corrigés et délibérés par l'État, **hors plateforme**. L'UNOA ne crée pas de sujets nationaux, ne simule pas de résultat officiel, n'émet pas de diplôme d'État et n'intègre pas l'API gouvernementale sans autorisation explicite. Elle peut informer, maintenir les pièces de préparation, archiver les copies des résultats officiels et indiquer le statut **déclaré / vérification en attente / vérifié**. L'éligibilité réelle des programmes et des étudiants doit être établie officiellement ; aucune simple inscription sur l'UNOA ne la présume.

# 10. DOCUMENTS, CERTIFICATIONS, AUTORISATIONS

## 10.1 Registre des titres et documents

Types : attestation de candidature, scolarité, paiement, présence, formation courte, réussite interne si permise, relevé, supplément, certificat, diplôme propre légalement habilité, copie de diplôme national externe, diplômes partenaires, badges. Chaque modèle lie émetteur légal, institution, programme/version, juridiction, période, langue, signature, habilitation, approbation, statut, numéro, empreinte, registre de révocation et exposition publique minimale.

## 10.2 Moteur d'habilitation

Un titre officiel n'est émis que si : `institution habilitée AND programme/version autorisé AND type de diplôme permis AND territoire éligible AND période valable AND parcours validé AND décideurs autorisés AND aucun blocage`. Le superadmin et les fonctions de test n'échappent pas à cette vérification en production. Si l'une échoue : **refus justifié et journalisé**, aucune émission. Exposer un statut `en préparation / non diplômant / autorisé sous conditions / diplômant habilité / suspendu / expiré` avec pièces justificatives et dates.

## 10.3 Authentification

Numéro unique non devinable, QR vérificateur à divulgation minimale, état valides/révoqués/remplacés, documents téléchargeables après authentification, correction et réémission. Un fichier externe importé reste explicitement « déposé par le titulaire » jusqu'à contrôle indépendant.

# 11. FINANCES, PAIMENTS, BOURSES ET COMPTABILITÉ

Catalogues de tarifs par programme, région, cohorte et catégorie ; frais de dossier ; échéanciers ; remises et bourses ; factures, notes de crédit, avoirs, reçus, paiements partiels, avances, trop-perçus, frais de retard si licites, remboursements ; comptabilité auxiliaire, encaissement, rapprochement et exports réglementaires. Paiements par opérateurs disponibles dans chaque pays (Mobile Money, carte, banque) via adaptateurs isolés. Aucun succès de paiement déterminé par une redirection front-end ; vérifier webhook signé ou consultation provider, référence idempotente et rapprochement. Séparer recette, facture, dette et droit académique. Ne jamais stocker de données de carte sensibles en dehors d'un prestataire conforme.

# 12. CAMPUS-ENTREPRISE ET INSERTION

Vérification d'entreprise (identité légale/dirigeant/mandataires), employés et permissions, profils, modération, offres de stage/emploi/projet/alternance, candidatures versionnées, consentements, filtres, recherche, alertes, entretiens, messages, rendez-vous, décision, contrats/conventions, maîtres de stage, encadreurs, journaux de stage, rapports, grilles, soutenances, stage crédité si programme le prévoit, parrainage/bourses, formations d'entreprise, projets R&D, forums virtuels, conventions, métriques d'insertion. Une entreprise ne peut voir que les candidatures et informations pour lesquelles existe une base légale et un droit d'accès. Aucune vente silencieuse des profils étudiants.

# 13. MÉMOIRES, DOCTORAT, RECHERCHE, BIBLIOTHÈQUE

Mémoires et soutenances : proposition de sujet, approbations, directeur, codirecteur, calendrier, jalons, dépôts versionnés, commentaires, intégrité scientifique, autorisation de soutenance, jury, PV, corrections finales, archivage et embargo.

Doctorat : candidature scientifique, affectation labo/école doctorale, projet de recherche, encadrements, comité de suivi, réinscriptions, formations doctorales, bourses, publication, éthique, rapports annuels, thèse, avis, jury, soutenance, dépôt final, habilitation de diplôme.

Recherche : équipes, laboratoires, projets, appels, budgets, livrables, publications, DOI ou identifiants, collaborations, propriété intellectuelle, comité d'éthique, protocoles, conflits d'intérêts, conservation des données et accès.

Bibliothèque : catalogue, ressources sous licence, droits d'auteur, acquisitions/abonnements, prêts numériques si permis, dépôts institutionnels, mémoire/thèse, recherche, consultation, statistiques anonymisées, demandes et accès par groupe.

# 14. VIE UNIVERSITAIRE ET SERVICES

Actualités et CMS ; agenda/calendriers ; clubs, associations, groupes de promotion, forums modérés, chat, visioconférence, événements, bibliothèques, tutorat, mentoring, orientation, soutien, assistance, FAQ et tickets, recours, médiation, rendez-vous, base de connaissance, enquête d'avis, droit à la représentation, accompagnement de l'accessibilité, démarches administratives numérisées, Alumni, réseau d'anciens, formation continue.

# 15. QUALITÉ, CONFORMITÉ, CONTRÔLE ET ANALYTIQUE

Système d'assurance qualité : référentiels de formation, qualifications, contrôle des syllabi, enquêtes, revue par les pairs, audits, non-conformités, plan d'action, responsables, échéances, vérification d'efficacité, dossiers de preuves, auto-évaluation, risques, rapports, documents justificatifs et préparation aux autorisations/accréditations.

Analytics : tableaux de bord multirôles, admissions, progression, réussite, crédits, remédiation, qualité des cours, réponses enseignants, facturation, paiements, stagiaires, emplois, recherche, disponibilité technique, accessibilité, suivi environnement/ressources ; calculs sourcés, filtres temporels et de territoire, nomenclatures maîtrisées, exports autorisés, petits effectifs protégés contre la réidentification.

Assistance IA optionnelle : recherche documentaire sur sources approuvées, aide à la rédaction, quiz proposés, tutorat, traduction, rapprochement compétences/offres ; isolation de données, citations de sources internes, opt-in si requis, journal d'usage, maîtrise des coûts, limitation des hallucinations, évaluation, revue humaine. L'IA n'admet, ne sanctionne, ne valide une note finale ni n'attribue un titre de manière autonome.

# 16. EXIGENCES TECHNIQUES CIBLES — SOCLE PRESCRIPTIF

## 16.1 Pile de référence et écart contrôlé

**Par défaut :** monorepo TypeScript ; `pnpm` workspaces + Turborepo ; Next.js (web responsif PWA) ; NestJS avec Fastify (API modulaire) ; PostgreSQL ; Drizzle ORM ou équivalent offrant migrations versionnées et requêtes typées ; Redis pour cache/tâches ; workers via BullMQ ; stockage objet compatible S3 ; OpenID Connect/OAuth 2.1 selon fournisseur d'identité éprouvé ; bibliothèque de validation Zod ou class-validator ; OpenAPI 3.1 ; tests Vitest/Jest et Playwright ; Docker Compose pour environnement local ; CI GitHub Actions ou équivalent ; observabilité OpenTelemetry + journaux structurés. Verrouiller versions LTS **testées à la date d'implémentation**, pas des versions écrites en dur dans le présent document. Pas de dépendance non maintenue sans ADR.

Un choix différent est possible **uniquement** si documenté dans une ADR : justification, coûts, compatibilité, plan de migration, tests, impact sur tous les modules. Ne pas multiplier les frameworks ; préférer un monolithe modulaire transactionnel avec quelques services séparés (vidéo, visioconférence, laboratoires, recherche/IA) si nécessaire.

## 16.2 Arborescence cible

```text
/
  CLAUDE.md
  README.md
  apps/web/                  # interfaces public, étudiant, enseignant, admin, entreprise
  apps/api/                  # API institutionnelle et modules métiers
  apps/worker/               # traitements asynchrones fiables
  packages/domain/           # types, invariants, événements métiers
  packages/db/               # schéma, migrations, repositories
  packages/ui/               # design system accessible
  packages/contracts/        # DTO, schémas OpenAPI, événements
  packages/config/           # schéma de configuration et résolution territoriale
  packages/testing/          # fixtures et aides de test
  infra/                     # Docker, déploiement, observabilité, IaC
  docs/                      # TDR, ADR, exigences, tests, états d'avancement
  scripts/                   # contrôle qualité, vérification TDR, migrations
  tests/e2e/                 # parcours intégrés réels
```

## 16.3 Couches et règles de dépendance

UI → application → domaine → accès aux données. Les modules métiers échangent par services internes et événements typés ; aucun accès direct aux tables privées d'un autre module sans contrat explicite. Le front n'est jamais autorité sur une note, un paiement, un diplôme ou une permission. Les modules publient des événements via outbox transactionnelle ; consommateurs idempotents ; retry plafonné, dead-letter, corrélation et replay. Les écritures sensibles passent par transactions et contrôles d'état.

## 16.4 Modèle de données transversal

IDs opaques (UUID/ULID) ; `scope_id`/`institution_id` pertinents ; clés étrangères ; contraintes ; `created_at`, `updated_at`, acteurs et version concurrente (`row_version`) selon besoin ; UTC en stockage pour instants, timezone IANA sur calendriers locaux ; `effective_from`/`effective_to` pour périodes ; montants en unité entière mineure + devise ISO 4217 (attention aux monnaies sans sous-unités) ; numéros métier distincts des PK ; traduction externalisée ; champs sensibles chiffrés selon classification ; journal d'audit append-only ; pièces en objet avec checksum et scan. Migrations up/down ou migrations compensatoires prouvées ; aucun `DROP` productif sans procédure.

## 16.5 API

API `/api/v1` versionnée, conventions REST pour commandes et consultation, contrat OpenAPI généré/testé, pagination par curseur, filtres validés, erreur normalisée `type/title/status/detail/instance/correlationId`, validation serveur exhaustive, limites de taille, rate limiting, idempotency-key sur écritures critiques, ETag/optimistic locking, webhook signé, événements versionnés. Protection contre IDOR/BOLA et injection. Export asynchrone pour données volumineuses. API de recherche et filtres droits/portée au niveau serveur.

## 16.6 IAM et cloisonnement

Compte unique avec identités vérifiées, MFA pour rôles sensibles, récupération sûre, fermeture des sessions, révocation, gestion des consentements, délégations et attributs contextuels. RBAC + ABAC : action, objet, relation, établissement, région, période, statut et motif. Le filtrage territorial doit être appliqué au backend et idéalement renforcé au niveau PostgreSQL par politiques RLS cohérentes avec les transactions ; tests systématiques d'isolement croisé. Un opérateur technique n'a pas librement accès au dossier académique sans autorisation.

## 16.7 Sécurité, conformité et réversibilité

Référence de vérification : OWASP ASVS 5.0, contrôles tenant compte du risque, secrets en coffre, TLS, en-têtes sûrs, CSRF selon contexte, CSP, restrictions de chargement, signature et vérification des téléchargements, audit, analyse SCA/SAST/DAST, sauvegardes chiffrées, restauration testée, surveillance, plan d'incident, rétention, RGPD uniquement si applicable, loi béninoise et autres lois par pays analysées par responsable compétent. Ne pas prétendre être « certifié » sans certification réelle.

## 16.8 Performance et disponibilité — objectifs initiaux de test

Ces valeurs sont des **hypothèses d'ingénierie**, pas des promesses contractuelles sans étude de charge : au moins 1 000 utilisateurs simultanés lors de la campagne pilote simulée ; P95 des API de lecture courantes < 500 ms hors services externes, P95 de création courante < 1 000 ms avec dataset test ; pages interactives utilisables sur mobile 4G modeste ; zéro perte de soumission confirmée ; disponibilité cible de 99,9 % mesurée sur services critiques après stabilisation ; RPO cible ≤ 15 min et RTO ≤ 4 h sous stratégie d'hébergement et budget adaptés. Ajuster après tests de charge et revue SRE ; ne jamais annoncer ces niveaux sans mesures.

## 16.9 Faible connexion et accessibilité

PWA cache de lecture autorisée, brouillons locaux chiffrés ou protégés et synchronisés, gestion claire des conflits, vidéos adaptatives et texte alternatif, compression, images optimisées, limitations de poids, erreurs récupérables, sous-titres/transcriptions, fonctionnement clavier/screenreader, contraste, labels, messages d'erreurs et langues régionales à venir ; objectif WCAG 2.2 niveau AA pour interfaces relevant de ce niveau. Évaluer l'accessibilité avec outils automatiques **et** tests manuels.

# 17. MOTEUR DE DOCUMENTS ET DE WORKFLOWS

Les formulaires dynamiques doivent rester accessibles, testables, localisés, typés et versionnés. Les modèles de documents utilisent variables d'un schéma explicitement autorisé, validations de données, approbateurs, signatures et journal ; **interdire l'injection de HTML ou de code**. Les workflows sont des machines d'état à transitions validées ; chaque transition porte acteur, rôle, condition, justification, date, version, effet secondaire et notification. Prévoir instances en cours lorsque la définition change ; migration explicite des instances ou maintien de l'ancienne définition. Procédure de secours limitée en cas d'erreur de workflow.

# 18. UX, ÉCRANS ET DESIGN SYSTEM

Design responsive et multilingue ; navigation cohérente ; recherche globale autorisée ; fil d'Ariane ; tableaux filtrables, triables, exportables selon permission ; filtres mémorisables ; aides contextuelles ; sauvegarde des brouillons ; écrans vide/chargement/erreur/succès, confirmations des actions irréversibles ; pagination ; horodatage local ; notifications préférentielles ; guides d'onboarding ; mode sombre facultatif ; interface de support. Le menu affiché dépend des permissions, mais **une route masquée reste protégée côté serveur**. Toute action sensible produit un récapitulatif avant confirmation.

# 19. ÉVÉNEMENTS MÉTIERS ET INTÉGRATIONS

Événements types : `application.submitted`, `application.admitted`, `enrollment.confirmed`, `teacher.application_approved`, `course.version_published`, `assessment.submitted`, `grade.validated`, `jury.decision_published`, `payment.confirmed`, `internship.approved`, `credential.issued`, `credential.revoked`, `region.configuration_published`. Enveloppe : id, type, version, date UTC, acteur, scope, aggregate ID et version, correlation ID, payload minimisé. Pas de données sensibles en clair dans le bus inutilement. Intégrations : email, SMS, paiement, visioconférence, vidéo, bibliothèque, LTI, QTI, Open Badges, vérification documentaire, IA, stockage. Les connecteurs ont tests de contrat, timeout, circuit breaker, retries, quotas et sandbox.

# 20. POLITIQUES D'ASSURANCE QUALITÉ ET VALIDATION DES PREUVES

La qualité pédagogique est un processus : syllabus complet, compétences, activités pratiques, évaluations cohérentes, versions, vérification d'accessibilité, habilitations enseignants, suivi de correction, enquêtes, réclamations, audits, plans correctifs. Les preuves sont rattachées à des exigences, dates, responsables, événements et documents. L'assurance qualité ne peut pas se résumer à un écran d'indicateurs.

# 21. LIVRABLES CONTRACTUELS ET CRITÈRES DE RÉCEPTION

Livrables obligatoires : dépôt versionné complet ; code source exécutable ; infrastructure reproductible local/staging/prod ; migration et restauration ; données fictives de démonstration séparées de production ; interfaces ; schémas de données ; catalogue OpenAPI ; documentation de chaque module ; manuel administration/configuration régionale ; manuel enseignant, étudiant et entreprise ; matrice d'habilitation ; journal d'audit ; dossier sécurité ; tests ; rapports de couverture ; parcours E2E ; tableaux de bord ; scripts de déploiement et rollback ; plan de reprise ; inventaire licences/dépendances ; registre des décisions, blocages et risques ; rapport de recette ; procédure de réversibilité des données.

**Recevable seulement si :** aucune exigence `MUST` non testée ; aucune faille de sécurité critique/haute ouverte sans décision formelle de risque ; aucune migration destructrice non approuvée ; aucune erreur de paiement/notes/diplômes non résolue ; pas de données de démonstration en production ; documents officiels verrouillés sans habilitation ; aucune régression des parcours ; documentation à jour. Le terme « prêt » est interdit si une porte de sortie n'est pas passée.

# 22. PRÉREQUIS EXTERNES ET POLITIQUE DE NON-INTERRUPTION

L'agent ne doit pas attendre le porteur pour une couleur, un nom de table, un framework, une pagination ou un gabarit administrable. Il choisit raisonnablement, documente et continue. En revanche, identité légale, marque finale, licences payantes, contrats prestataires, clés API réelles, données officielles de programmes, signatures institutionnelles, domaines, DNS, serveurs, habilitations, règles juridiquement opposables et mise en production dépendent de sources humaines/externe : prévoir paramètres vides, test sandbox, statut `BLOCKED_EXTERNAL`, non-activation dans l'environnement réel, et liste précise des actions nécessaires. Ne jamais substituer une donnée fictive à une donnée officielle.

# 23. ORDRE DE RÉALISATION PAR DÉPENDANCES — PÉRIMÈTRE GLOBAL INCHANGÉ

- **Lot 0 — audit du dépôt et traçabilité** : comprendre l'existant, initialiser architecture et exigences ; aucun code métier avant lecture des TDR.
- **Lot 1 — plateforme et socle** : CI, environnement, identité, scopes/régions, permissions, configuration, audit, documents, workflows, messagerie, design system.
- **Lot 2 — métiers académiques** : institutions, gouvernance, programmes, versions, compétences, admissions et scolarité.
- **Lot 3 — pédagogie et enseignants** : recrutement, gestion cours, contenus, visioconférence/laboratoires, tutorat, évaluations, correction.
- **Lot 4 — résultats et financements** : décisions de jury, progression, finances, habilitations, documents, copies diplômes externes.
- **Lot 5 — campus et recherche** : Campus-Entreprise, stages, Alumni, masters/mémoires, doctorat, recherche, bibliothèque, vie universitaire.
- **Lot 6 — qualité complète et exploitation** : audits, statistiques, IA encadrée, internationalisation renforcée, sécurité approfondie, charge, accessibilité, restauration et tests E2E.
- **Lot 7 — recette de la version complète** : tous les parcours de la matrice, aucun `MUST` manquant, déploiement pilotable selon habilitations.

**Important :** ce séquencement est technique ; chaque domaine reste obligatoire. Les lots antérieurs doivent déjà exposer les interfaces évolutives nécessaires, et tous les modules requis doivent être livrés avant la réception de la version universitaire intégrale.

# 24. ANNEXES NORMATIVES COMPLÉMENTAIRES

Lire et appliquer : `docs/MATRICE_EXIGENCES.csv` (identifiants et preuves) ; `docs/PLAN_TESTS_ET_RECETTE.md` ; `docs/CONTRATS_API_DONNEES.md` ; `docs/PARAMETRAGE_REGIONAL.md` ; `docs/MATRICE_ACCES.md` ; `docs/CARTOGRAPHIE_ECRANS.md` ; `docs/PLAN_EXECUTION_AUTONOME.md` ; `docs/REGISTRE_DECISIONS.md` ; `docs/REGISTRE_BLOCAGES.md` ; `docs/00_PROJET_INSTITUTIONNEL_REFERENCE.md`. **Ces annexes sont des parties intégrantes du présent TDR.**

# 25. RÉFÉRENCES PUBLIQUES À VÉRIFIER LORS DE L'IMPLÉMENTATION

- Décret béninois n° 2020-551 du 18 novembre 2020, régime d'examens nationaux pour certaines filières non homologuées : https://sgg.gouv.bj/doc/decret-2020-551/download
- Référentiels CAMES pour les formations en ligne / FOAD : https://www.lecames.org/ressources/
- ISO 21001:2025 (management des organismes d'éducation) : https://www.iso.org/standard/21001
- WCAG 2.2 (W3C) : https://www.w3.org/TR/WCAG22/
- OWASP ASVS 5.0 : https://asvs.owasp.org/
- 1EdTech Learning Tools Interoperability : https://www.1edtech.org/standards/lti
- 1EdTech QTI : https://www.1edtech.org/standards/qti/index
- 1EdTech Open Badges : https://www.1edtech.org/standards/open-badges

Ces sources servent de références d'ingénierie et de conformité **à analyser**. La conformité de l'UNOA et le droit d'exploiter des formations doivent être vérifiés officiellement ; ces URL ne constituent pas des habilitations.

---

# 26. CATALOGUE EXÉCUTABLE DES MODULES ET EXIGENCES

Le tableau qui suit est **normatif**. Chaque capacité porte un identifiant stable `REQ-<MODULE>-NNN` repris dans `docs/MATRICE_EXIGENCES.csv`. Toutes les exigences portent la priorité **MUST** pour la version cible, à moins qu'une dépendance externe soit explicitement bloquée par droit, contrat ou secret ; dans ce dernier cas, la capacité logicielle, le mode sandbox et les tests restent obligatoires. Les fonctionnalités spécialisées peuvent utiliser des connecteurs optionnels lorsqu'un environnement pratique ou fournisseur nécessite un contrat.

## CORE — Socle et disponibilité

**Finalité :** Rendre la plateforme installable, supervisable, sauvegardable et réversible.

**Processus de référence :** Installation → configuration → migration → vérification santé → exploitation → restauration.

**Écrans exigés :** Console statut ; environnement ; logs ; jobs ; sauvegardes ; déploiement.

**Entités principales :** Environment, HealthCheck, Job, Backup, RestoreRun, Deployment, FeatureToggle.

**Exceptions à tester :** Service externe indisponible ; job en double ; rupture de déploiement ; restauration échouée.

- **REQ-CORE-001 (MUST)** — Initialiser monorepo documenté et compilation reproductible. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-001`.
- **REQ-CORE-002 (MUST)** — Fournir Docker Compose complet local avec services nécessaires. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-002`.
- **REQ-CORE-003 (MUST)** — Construire scripts de création et de migration des bases. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-003`.
- **REQ-CORE-004 (MUST)** — Installer observabilité des erreurs et traces corrélées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-004`.
- **REQ-CORE-005 (MUST)** — Fournir endpoints readiness et liveness. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-005`.
- **REQ-CORE-006 (MUST)** — Déployer worker et file durable de traitements. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-006`.
- **REQ-CORE-007 (MUST)** — Fournir gestion sécurisée des secrets et configurations d'environnement. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-007`.
- **REQ-CORE-008 (MUST)** — Automatiser sauvegardes chiffrées et restauration testable. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-008`.
- **REQ-CORE-009 (MUST)** — Fournir plan rollback de version et schéma. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-009`.
- **REQ-CORE-010 (MUST)** — Assurer files mortes et rejouabilité des jobs. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-010`.
- **REQ-CORE-011 (MUST)** — Définir quotas et alertes capacité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-011`.
- **REQ-CORE-012 (MUST)** — Séparer environnements dev test staging production. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-012`.
- **REQ-CORE-013 (MUST)** — Garantir reproductibilité CI et verrouillage dépendances. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-013`.
- **REQ-CORE-014 (MUST)** — Produire runbook de panne et incident. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CORE-014`.

**Gate du module CORE :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## TEN — Territoires et multi-entités

**Finalité :** Permettre toute implantation ou région nouvelle sans modification de code.

**Processus de référence :** Créer territoire → rattacher juridiction → lier établissement → affecter programme → activer paramètres.

**Écrans exigés :** Arbre territorial ; fiche pays/région ; entités légales ; centres ; simulations.

**Entités principales :** Territory, TerritoryType, Jurisdiction, Entity, Campus, Scope, Relationship.

**Exceptions à tester :** Territoires homonymes ; frontières de compétences ; création en cycle ; transfert établissement.

- **REQ-TEN-001 (MUST)** — Créer plusieurs types de territoires et hiérarchies non fixes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEN-001`.
- **REQ-TEN-002 (MUST)** — Distinguer territoire, juridiction, établissement et centre. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEN-002`.
- **REQ-TEN-003 (MUST)** — Affecter une institution à plusieurs territoires autorisés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEN-003`.
- **REQ-TEN-004 (MUST)** — Gérer fuseaux IANA par implantations et calendrier. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEN-004`.
- **REQ-TEN-005 (MUST)** — Associer monnaies et formats régionaux sans hardcode. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEN-005`.
- **REQ-TEN-006 (MUST)** — Publier identité légale et contacts propres à établissement. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEN-006`.
- **REQ-TEN-007 (MUST)** — Isoler données privées par portée territoriale. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEN-007`.
- **REQ-TEN-008 (MUST)** — Gérer mobilité et transfert interterritoires. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEN-008`.
- **REQ-TEN-009 (MUST)** — Gérer rattachement multiple aux cadres réglementaires. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEN-009`.
- **REQ-TEN-010 (MUST)** — Administrer traduction des désignations territoriales. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEN-010`.
- **REQ-TEN-011 (MUST)** — Gérer dates de début et fin de présence régionale. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEN-011`.
- **REQ-TEN-012 (MUST)** — Simuler région supplémentaire depuis base vierge. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEN-012`.

**Gate du module TEN :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## CFG — Paramétrage hiérarchique

**Finalité :** Permettre à l'administration de créer les règles via éditeurs, sans code ad hoc.

**Processus de référence :** Déclarer clé → valeurs portées → simulation → revue → publication datée → historisation.

**Écrans exigés :** Catalogue de clés ; éditeur typé ; héritage ; test de règle ; comparaison de versions.

**Entités principales :** ConfigDefinition, ConfigValue, ConfigVersion, ConfigApproval, RuleDefinition, RuleResult.

**Exceptions à tester :** Conflit d'héritage ; override interdit ; données invalides ; rétroactivité ; cache périmé.

- **REQ-CFG-001 (MUST)** — Créer des définitions de paramètres typés et validés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-001`.
- **REQ-CFG-002 (MUST)** — Gérer portées globale zone pays région entité programme cohorte utilisateur. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-002`.
- **REQ-CFG-003 (MUST)** — Résoudre l'héritage avec provenance et justification. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-003`.
- **REQ-CFG-004 (MUST)** — Appliquer contraintes légales et sécurité non dérogeables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-004`.
- **REQ-CFG-005 (MUST)** — Versionner et approuver les publications de paramètres. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-005`.
- **REQ-CFG-006 (MUST)** — Prévisualiser la différence avant publication. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-006`.
- **REQ-CFG-007 (MUST)** — Programmer date d'effet des changements. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-007`.
- **REQ-CFG-008 (MUST)** — Maintenir instantané de configuration de chaque transaction académique. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-008`.
- **REQ-CFG-009 (MUST)** — Construire moteur de règles déclaratives sans eval arbitraire. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-009`.
- **REQ-CFG-010 (MUST)** — Permettre rollback des valeurs sans altérer les historiques. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-010`.
- **REQ-CFG-011 (MUST)** — Invalider caches après changement de configuration. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-011`.
- **REQ-CFG-012 (MUST)** — Gérer exceptions régionales motivées et datées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-012`.
- **REQ-CFG-013 (MUST)** — Exporter et importer jeux de configuration validés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-013`.
- **REQ-CFG-014 (MUST)** — Tester indépendance de deux régions aux règles contradictoires. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CFG-014`.

**Gate du module CFG :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## IAM — Identité et permissions

**Finalité :** Compte unique avec accès selon attributs et portées.

**Processus de référence :** Compte → vérification → accès → rôle → délégation → révocation.

**Écrans exigés :** Connexion ; récupération ; sessions ; rôles ; délégations ; journaux.

**Entités principales :** User, Identity, Account, MFADevice, Role, Permission, Grant, Session, Consent.

**Exceptions à tester :** Prise de compte ; escalade de privilège ; identité doublon ; révocation en cours.

- **REQ-IAM-001 (MUST)** — Créer compte utilisateur unique et profils métiers multiples. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-001`.
- **REQ-IAM-002 (MUST)** — Authentifier via fournisseur OIDC éprouvé. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-002`.
- **REQ-IAM-003 (MUST)** — Activer MFA pour personnels sensibles. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-003`.
- **REQ-IAM-004 (MUST)** — Fournir récupération de compte sécurisée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-004`.
- **REQ-IAM-005 (MUST)** — Gérer sessions actives et révocation à distance. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-005`.
- **REQ-IAM-006 (MUST)** — Définir rôles composables et permissions atomiques. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-006`.
- **REQ-IAM-007 (MUST)** — Limiter permissions par scope ressource période et relation. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-007`.
- **REQ-IAM-008 (MUST)** — Gérer délégations temporaires avec auteur et justification. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-008`.
- **REQ-IAM-009 (MUST)** — Isoler données étudiants entreprises et établissements. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-009`.
- **REQ-IAM-010 (MUST)** — Mettre en oeuvre contrôle droits dans services et base. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-010`.
- **REQ-IAM-011 (MUST)** — Tracer tentatives d'accès refusées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-011`.
- **REQ-IAM-012 (MUST)** — Fournir accès de secours break-glass limité auditée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-012`.
- **REQ-IAM-013 (MUST)** — Exporter consentements et préférences de contact. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-013`.
- **REQ-IAM-014 (MUST)** — Gérer invitation d'utilisateurs entreprise et membres de jury. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-014`.
- **REQ-IAM-015 (MUST)** — Désactiver automatiquement accès à fin de contrat. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-IAM-015`.

**Gate du module IAM :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## ORG — Organisation institutionnelle

**Finalité :** Créer librement facultés, départements, centres et organes de l'université.

**Processus de référence :** Proposition d'unité → validation → activation → réorganisation → archivage.

**Écrans exigés :** Organigramme ; éditeur unité ; responsables ; historique.

**Entités principales :** OrgUnit, OrgUnitType, Position, Appointment, ReportingLine, OrgVersion.

**Exceptions à tester :** Suppression unité active ; double responsabilité ; changement hiérarchique rétroactif.

- **REQ-ORG-001 (MUST)** — Créer et nommer n'importe quel type d'unité organisationnelle. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ORG-001`.
- **REQ-ORG-002 (MUST)** — Construire hiérarchies d'unités configurables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ORG-002`.
- **REQ-ORG-003 (MUST)** — Affecter responsables et suppléants datés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ORG-003`.
- **REQ-ORG-004 (MUST)** — Gérer historique des réorganisations sans perte des liens. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ORG-004`.
- **REQ-ORG-005 (MUST)** — Configurer affectations multiples d'un personnel. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ORG-005`.
- **REQ-ORG-006 (MUST)** — Gérer entités légales et composantes académiques distinctes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ORG-006`.
- **REQ-ORG-007 (MUST)** — Approuver fermeture fusion ou transfert d'une unité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ORG-007`.
- **REQ-ORG-008 (MUST)** — Publier organigramme public filtré. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ORG-008`.
- **REQ-ORG-009 (MUST)** — Rattacher facultés départements instituts laboratoires. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ORG-009`.
- **REQ-ORG-010 (MUST)** — Configurer capacités quotas et ressources par unité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ORG-010`.
- **REQ-ORG-011 (MUST)** — Gérer intérim délégation et vacance de poste. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ORG-011`.

**Gate du module ORG :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## GOV — Gouvernance et conseils

**Finalité :** Formaliser décisions institutionnelles et responsabilités.

**Processus de référence :** Convocation → ordre du jour → quorum → délibération → PV → publication.

**Écrans exigés :** Conseils ; réunions ; avis ; votes ; décisions ; procès-verbaux.

**Entités principales :** Board, Committee, Meeting, AgendaItem, Vote, Decision, Minutes, Delegation.

**Exceptions à tester :** Quorum insuffisant ; conflit d'intérêts ; signature absente ; décision contestée.

- **REQ-GOV-001 (MUST)** — Créer types de conseils et instances via paramétrage. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GOV-001`.
- **REQ-GOV-002 (MUST)** — Constituer membres et mandats datés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GOV-002`.
- **REQ-GOV-003 (MUST)** — Convocations et agendas versionnés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GOV-003`.
- **REQ-GOV-004 (MUST)** — Contrôler quorum et incompatibilités. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GOV-004`.
- **REQ-GOV-005 (MUST)** — Consigner avis et votes selon règles applicables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GOV-005`.
- **REQ-GOV-006 (MUST)** — Générer procès-verbaux signables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GOV-006`.
- **REQ-GOV-007 (MUST)** — Enregistrer décisions et effets exécutoires. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GOV-007`.
- **REQ-GOV-008 (MUST)** — Gérer conflits d'intérêts et abstentions. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GOV-008`.
- **REQ-GOV-009 (MUST)** — Attribuer délégation de signature contrôlée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GOV-009`.
- **REQ-GOV-010 (MUST)** — Construire circuit de recours contre décision. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GOV-010`.
- **REQ-GOV-011 (MUST)** — Archiver réunions et pièces jointes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GOV-011`.
- **REQ-GOV-012 (MUST)** — Autoriser diffusion publique partielle des décisions. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GOV-012`.

**Gate du module GOV :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## CAT — Catalogue académique et maquettes

**Finalité :** Créer sans code toutes les formations, compétences et versions.

**Processus de référence :** Structure → programme → maquette → revue → validation → publication → évolution.

**Écrans exigés :** Catalogue ; programme ; parcours ; UE ; cours ; maquette ; transitions.

**Entités principales :** Program, ProgramVersion, Pathway, Period, Unit, Course, CurriculumMap, Competency.

**Exceptions à tester :** Prérequis en cycle ; UE sans crédits ; changement sur cohorte antérieure ; incohérence du total.

- **REQ-CAT-001 (MUST)** — Créer filières mentions spécialisations et parcours arbitraires. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-001`.
- **REQ-CAT-002 (MUST)** — Configurer programmes Licence Master Doctorat et non diplômants. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-002`.
- **REQ-CAT-003 (MUST)** — Configurer organisation semestrielle trimestrielle ou modulaire. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-003`.
- **REQ-CAT-004 (MUST)** — Créer UE et éléments constitutifs ou cours. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-004`.
- **REQ-CAT-005 (MUST)** — Gérer codes nom titres et traductions des programmes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-005`.
- **REQ-CAT-006 (MUST)** — Définir crédits coefficients et volumes horaires par règle. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-006`.
- **REQ-CAT-007 (MUST)** — Modéliser prérequis et vérifier absence de cycle. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-007`.
- **REQ-CAT-008 (MUST)** — Définir compétences et résultats d'apprentissage attendus. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-008`.
- **REQ-CAT-009 (MUST)** — Gérer cours mutualisés entre plusieurs programmes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-009`.
- **REQ-CAT-010 (MUST)** — Composer parcours obligatoires et options électives. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-010`.
- **REQ-CAT-011 (MUST)** — Configurer stages mémoires et soutenances requis. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-011`.
- **REQ-CAT-012 (MUST)** — Appliquer capacités langues tarifs et territoires éligibles. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-012`.
- **REQ-CAT-013 (MUST)** — Soumettre maquette à revue et approbation institutionnelle. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-013`.
- **REQ-CAT-014 (MUST)** — Publier versions immuables de programmes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-014`.
- **REQ-CAT-015 (MUST)** — Définir tableaux d'équivalence entre versions et filières. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-015`.
- **REQ-CAT-016 (MUST)** — Simuler plan d'études d'un candidat ou étudiant. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-016`.
- **REQ-CAT-017 (MUST)** — Contrôler statut réglementaire avant ouverture de candidature. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAT-017`.

**Gate du module CAT :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## CMS — Portail public et orientation

**Finalité :** Informer sans tromper et convertir les prospects en candidats.

**Processus de référence :** Publication fiche → recherche → orientation → contact → candidature.

**Écrans exigés :** Accueil ; catalogue ; fiche programme ; actu ; FAQ ; contact ; compare.

**Entités principales :** Page, ContentBlock, ProgramListing, Lead, Inquiry, Publication, Campaign.

**Exceptions à tester :** Information devenue fausse ; programme non autorisé ; formulaire spam.

- **REQ-CMS-001 (MUST)** — Créer site institutionnel géré par CMS. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CMS-001`.
- **REQ-CMS-002 (MUST)** — Publier fiches programmes versionnées et statut officiel. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CMS-002`.
- **REQ-CMS-003 (MUST)** — Offrir recherche filtrée par niveau pays langue et modalités. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CMS-003`.
- **REQ-CMS-004 (MUST)** — Proposer comparaison de programmes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CMS-004`.
- **REQ-CMS-005 (MUST)** — Fournir formulaire de renseignements anti-spam. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CMS-005`.
- **REQ-CMS-006 (MUST)** — Gérer articles actualités événements et presse. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CMS-006`.
- **REQ-CMS-007 (MUST)** — Publier tarifs et calendrier issus des référentiels. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CMS-007`.
- **REQ-CMS-008 (MUST)** — Prévoir pages de mentions légales et confidentialité par région. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CMS-008`.
- **REQ-CMS-009 (MUST)** — Gérer SEO multilingue et sitemaps. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CMS-009`.
- **REQ-CMS-010 (MUST)** — Archiver anciennes publications avec auteur et date. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CMS-010`.
- **REQ-CMS-011 (MUST)** — Gérer campagnes d'information et sources de prospects. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CMS-011`.
- **REQ-CMS-012 (MUST)** — Garantir accessibilité et navigation mobile. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CMS-012`.

**Gate du module CMS :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## ADM — Admissions

**Finalité :** Gérer candidatures et décisions par processus configurable.

**Processus de référence :** Création → pièces → dépôt → instruction → décision → inscription.

**Écrans exigés :** Espace candidat ; formulaire ; vérification ; comité ; décision ; recours.

**Entités principales :** Application, ApplicationVersion, Requirement, DocumentCheck, Review, AdmissionDecision.

**Exceptions à tester :** Dossier incomplet ; pièces contradictoires ; candidatures simultanées ; fraude.

- **REQ-ADM-001 (MUST)** — Créer processus candidature et formulaire propre au programme. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-001`.
- **REQ-ADM-002 (MUST)** — Gérer plusieurs candidatures pour une identité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-002`.
- **REQ-ADM-003 (MUST)** — Sauvegarder brouillon et reprise sur mobile. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-003`.
- **REQ-ADM-004 (MUST)** — Contrôler documents pièces taille format et authenticité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-004`.
- **REQ-ADM-005 (MUST)** — Calculer complétude selon règles versionnées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-005`.
- **REQ-ADM-006 (MUST)** — Recevoir dossier et délivrer accusé horodaté. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-006`.
- **REQ-ADM-007 (MUST)** — Ouvrir instruction administrative et académique séparées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-007`.
- **REQ-ADM-008 (MUST)** — Appliquer critères et grilles de sélection configurables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-008`.
- **REQ-ADM-009 (MUST)** — Demander des compléments et historiser chaque version. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-009`.
- **REQ-ADM-010 (MUST)** — Gérer entretiens tests ou évaluations d'accès. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-010`.
- **REQ-ADM-011 (MUST)** — Produire admis conditionnel attente refus motivé. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-011`.
- **REQ-ADM-012 (MUST)** — Gérer recours et révocation contrôlée de décision. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-012`.
- **REQ-ADM-013 (MUST)** — Envoyer notifications selon consentement et langue. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-013`.
- **REQ-ADM-014 (MUST)** — Préparer inscription sans confusion admission paiement. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-014`.
- **REQ-ADM-015 (MUST)** — Construire vues de pilotage admissions par région. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ADM-015`.

**Gate du module ADM :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## SIS — Scolarité et historique étudiant

**Finalité :** Suivre le parcours académique sans perdre les règles applicables.

**Processus de référence :** Admission → inscription → cohortes → progression → réinscription → sortie/Alumni.

**Écrans exigés :** Dossier ; inscription ; carte ; calendrier ; progression ; demandes.

**Entités principales :** Student, Matricule, Enrollment, Registration, Cohort, StudyPlan, StudentStatus.

**Exceptions à tester :** Doublon matricule ; double inscription incompatible ; transfert et perte de crédits.

- **REQ-SIS-001 (MUST)** — Générer matricule unique selon séquence configurée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-001`.
- **REQ-SIS-002 (MUST)** — Enregistrer inscription administrative et pédagogique distinctes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-002`.
- **REQ-SIS-003 (MUST)** — Affecter programme version et cohorte. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-003`.
- **REQ-SIS-004 (MUST)** — Gérer groupes et parcours individualisés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-004`.
- **REQ-SIS-005 (MUST)** — Créer tableau de bord étudiant récapitulatif. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-005`.
- **REQ-SIS-006 (MUST)** — Afficher crédits acquis requis et en attente. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-006`.
- **REQ-SIS-007 (MUST)** — Gérer interruption suspension et reprise d'études. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-007`.
- **REQ-SIS-008 (MUST)** — Traiter réorientation et changement de programme. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-008`.
- **REQ-SIS-009 (MUST)** — Gérer mobilité et transferts entre régions établissements. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-009`.
- **REQ-SIS-010 (MUST)** — Traiter équivalences et acquis antérieurs validés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-010`.
- **REQ-SIS-011 (MUST)** — Gérer réinscription annuelle et conditions. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-011`.
- **REQ-SIS-012 (MUST)** — Historiser décisions et changements de dossier. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-012`.
- **REQ-SIS-013 (MUST)** — Publier calendrier et obligations de l'apprenant. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-013`.
- **REQ-SIS-014 (MUST)** — Produire dossier étudiant exportable autorisé. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-014`.
- **REQ-SIS-015 (MUST)** — Fermer parcours avec passage statut diplômé Alumni. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SIS-015`.

**Gate du module SIS :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## TEA — Enseignants et RH académiques

**Finalité :** Recruter, habiliter et gérer les missions d'enseignement.

**Processus de référence :** Candidature → expertise → décision → contrat → affectation → renouvellement.

**Écrans exigés :** Profil enseignant ; dépôt cours ; recrutement ; affectations ; missions ; contrats.

**Entités principales :** TeacherProfile, JobOpening, TeacherApplication, CredentialCheck, Contract, TeachingAssignment.

**Exceptions à tester :** Diplôme falsifié ; conflit d'intérêts ; affectation expirée ; accès après départ.

- **REQ-TEA-001 (MUST)** — Créer profil candidat enseignant complet. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-001`.
- **REQ-TEA-002 (MUST)** — Créer appel à candidatures par discipline région et niveau. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-002`.
- **REQ-TEA-003 (MUST)** — Autoriser candidatures spontanées et propositions de cours. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-003`.
- **REQ-TEA-004 (MUST)** — Déposer diplôme CV références publications et disponibilité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-004`.
- **REQ-TEA-005 (MUST)** — Exiger syllabus et proposition pédagogique structurée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-005`.
- **REQ-TEA-006 (MUST)** — Valider pièces et qualifications par contrôleur habilité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-006`.
- **REQ-TEA-007 (MUST)** — Faire revue scientifique et pédagogique indépendante. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-007`.
- **REQ-TEA-008 (MUST)** — Gérer entretien démonstration et décision collégiale. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-008`.
- **REQ-TEA-009 (MUST)** — Contractualiser intervenants et gérer signatures. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-009`.
- **REQ-TEA-010 (MUST)** — Affecter enseignant à offres de cours et groupes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-010`.
- **REQ-TEA-011 (MUST)** — Distinguer auteur tuteur correcteur jury directeur de mémoire. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-011`.
- **REQ-TEA-012 (MUST)** — Suivre obligations prestations et délais de correction. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-012`.
- **REQ-TEA-013 (MUST)** — Gérer rémunérations et exports RH autorisés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-013`.
- **REQ-TEA-014 (MUST)** — Gérer réévaluation renouvellement et suspension. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-014`.
- **REQ-TEA-015 (MUST)** — Révoquer droits et affectations à fin de mission. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-TEA-015`.

**Gate du module TEA :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## LMS — Studio de cours et LMS

**Finalité :** Construire et animer des cours réellement interactifs et accessibles.

**Processus de référence :** Brouillon cours → syllabus → modules/ressources → validation → édition par cohorte.

**Écrans exigés :** Studio ; syllabus ; éditeur ; apprenant ; ressources ; forum ; progression.

**Entités principales :** Course, CourseVersion, CourseOffering, Lesson, Resource, Activity, Completion.

**Exceptions à tester :** Contenu corrompu ; modification d'édition notée ; faible réseau ; droits d'auteur.

- **REQ-LMS-001 (MUST)** — Construire syllabus avec objectifs prérequis méthodes et bibliographie. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-001`.
- **REQ-LMS-002 (MUST)** — Créer modules leçons ressources et activités illimités. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-002`.
- **REQ-LMS-003 (MUST)** — Importer PDF DOCX PPTX EPUB images et fichiers structurés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-003`.
- **REQ-LMS-004 (MUST)** — Gérer vidéo adaptative chapitrage et sous-titres. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-004`.
- **REQ-LMS-005 (MUST)** — Gérer audio transcription et vitesse de lecture. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-005`.
- **REQ-LMS-006 (MUST)** — Générer pages riches avec rendu HTML assaini. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-006`.
- **REQ-LMS-007 (MUST)** — Versionner tous contenus et conserver anciens étudiants. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-007`.
- **REQ-LMS-008 (MUST)** — Soumettre cours à validation disciplinaire pédagogique et droits. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-008`.
- **REQ-LMS-009 (MUST)** — Publier une offre de cours pour une cohorte donnée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-009`.
- **REQ-LMS-010 (MUST)** — Configurer accès séquentiel conditionnel ou libre. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-010`.
- **REQ-LMS-011 (MUST)** — Suivre progression distincte des notes officielles. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-011`.
- **REQ-LMS-012 (MUST)** — Gérer forums modérés et discussions par cours. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-012`.
- **REQ-LMS-013 (MUST)** — Gérer notes privées signets et favoris étudiants. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-013`.
- **REQ-LMS-014 (MUST)** — Permettre traduction ou variante pédagogique régionale. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-014`.
- **REQ-LMS-015 (MUST)** — Gérer téléchargements permis et cache hors ligne. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-015`.
- **REQ-LMS-016 (MUST)** — Alerter sur dates et activités prévues. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-016`.
- **REQ-LMS-017 (MUST)** — Fournir export de cours et restauration sous droits. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LMS-017`.

**Gate du module LMS :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## LIVE — Classes virtuelles et collaboration

**Finalité :** Permettre enseignement synchrone fiable et traçable.

**Processus de référence :** Planification → convocation → session → présence → ressources/suivi.

**Écrans exigés :** Calendrier ; salles ; invitations ; tableau blanc ; enregistrements.

**Entités principales :** LiveSession, Participant, Attendance, Recording, MeetingAsset.

**Exceptions à tester :** Lien divulgué ; annulation ; mauvaise connexion ; refus enregistrement.

- **REQ-LIVE-001 (MUST)** — Planifier séances avec fuseau et calendrier configurables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIVE-001`.
- **REQ-LIVE-002 (MUST)** — Créer liens sécurisés de visioconférence. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIVE-002`.
- **REQ-LIVE-003 (MUST)** — Contrôler présence et invitations par rôle. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIVE-003`.
- **REQ-LIVE-004 (MUST)** — Fournir chat et outils collaboratifs. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIVE-004`.
- **REQ-LIVE-005 (MUST)** — Partager écran documents et tableau blanc via intégration. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIVE-005`.
- **REQ-LIVE-006 (MUST)** — Autoriser enregistrement uniquement sous politique et consentement. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIVE-006`.
- **REQ-LIVE-007 (MUST)** — Gérer salles de sous-groupes si fournisseur le supporte. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIVE-007`.
- **REQ-LIVE-008 (MUST)** — Notifier annulation report et changement de séance. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIVE-008`.
- **REQ-LIVE-009 (MUST)** — Publier ressources et replay autorisés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIVE-009`.
- **REQ-LIVE-010 (MUST)** — Produire preuves pédagogiques sans surveillance excessive. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIVE-010`.

**Gate du module LIVE :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## LAB — Laboratoires et travaux pratiques

**Finalité :** Permettre exercices pratiques notés et environnements isolés.

**Processus de référence :** Attribution TP → environnement → travaux → soumission → correction.

**Écrans exigés :** Studio TP ; énoncé ; sandbox ; dépôts ; corrections ; quotas.

**Entités principales :** PracticalAssignment, LabTemplate, LabInstance, Artifact, LabUsage.

**Exceptions à tester :** Code hostile ; dépassement coût ; fuite réseau ; réutilisation sandbox.

- **REQ-LAB-001 (MUST)** — Créer TP individuels et collectifs associés à compétences. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LAB-001`.
- **REQ-LAB-002 (MUST)** — Gérer modèles de travaux et fichiers autorisés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LAB-002`.
- **REQ-LAB-003 (MUST)** — Déployer environnement de pratique isolé et éphémère. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LAB-003`.
- **REQ-LAB-004 (MUST)** — Restreindre réseau CPU RAM stockage et temps d'exécution. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LAB-004`.
- **REQ-LAB-005 (MUST)** — Fournir consoles de développement et données fictives. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LAB-005`.
- **REQ-LAB-006 (MUST)** — Créer TP sans laboratoire pour autres disciplines. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LAB-006`.
- **REQ-LAB-007 (MUST)** — Gérer versionnement soumissions et accusés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LAB-007`.
- **REQ-LAB-008 (MUST)** — Permettre feedback annoté et resoumission autorisée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LAB-008`.
- **REQ-LAB-009 (MUST)** — Fournir examens pratiques avec preuves reproductibles. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LAB-009`.
- **REQ-LAB-010 (MUST)** — Gérer détection abus et arrêt des environnements. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LAB-010`.
- **REQ-LAB-011 (MUST)** — Rattacher centres physiques partenaires quand pratique réelle obligatoire. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LAB-011`.

**Gate du module LAB :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## ASS — Évaluations internes

**Finalité :** Produire devoirs et examens internes intègres.

**Processus de référence :** Banque → épreuve → ouverture → soumission → correction.

**Écrans exigés :** Banques ; éditeur d'épreuve ; passage ; copies ; corrections.

**Entités principales :** QuestionBank, Item, Assessment, AssessmentVersion, Attempt, Submission, Rubric.

**Exceptions à tester :** Coupure pendant dépôt ; délais ; doublon ; sujet divulgué ; accommodations.

- **REQ-ASS-001 (MUST)** — Créer banques questions typées et versionnées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-001`.
- **REQ-ASS-002 (MUST)** — Gérer QCM appariement texte calcul code et fichiers. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-002`.
- **REQ-ASS-003 (MUST)** — Créer travaux individuels ou en équipes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-003`.
- **REQ-ASS-004 (MUST)** — Configurer rubriques et barèmes selon programme. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-004`.
- **REQ-ASS-005 (MUST)** — Gérer sessions dates délais fuseaux et tentatives. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-005`.
- **REQ-ASS-006 (MUST)** — Protéger sujets et permettre tirages selon règles. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-006`.
- **REQ-ASS-007 (MUST)** — Gérer aménagements documentés et équitables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-007`.
- **REQ-ASS-008 (MUST)** — Sauvegarder brouillons avant soumission. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-008`.
- **REQ-ASS-009 (MUST)** — Accuser réception horodatée côté serveur. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-009`.
- **REQ-ASS-010 (MUST)** — Éviter double soumission et réessai idempotent. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-010`.
- **REQ-ASS-011 (MUST)** — Corriger automatiquement uniquement questions adaptées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-011`.
- **REQ-ASS-012 (MUST)** — Permettre correction humaine et feedback détaillé. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-012`.
- **REQ-ASS-013 (MUST)** — Gérer double correction et modération. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-013`.
- **REQ-ASS-014 (MUST)** — Gérer suspicion fraude plagiat et procédure contradictoire. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-014`.
- **REQ-ASS-015 (MUST)** — Produire archives de copies et preuves d'évaluation. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ASS-015`.

**Gate du module ASS :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## GRD — Notes, crédits, jury

**Finalité :** Gérer règles d'évaluation, délibérations et décisions fiables.

**Processus de référence :** Note proposée → modération → jury → validation → publication → recours.

**Écrans exigés :** Tableau notes ; crédits ; jurys ; PV ; rectifications ; recours.

**Entités principales :** Grade, GradeVersion, CreditAward, Jury, JuryDecision, Transcript, Appeal.

**Exceptions à tester :** Réévaluation tardive ; compensation non permise ; jury sans quorum.

- **REQ-GRD-001 (MUST)** — Calculer résultats depuis règles académiques versionnées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-001`.
- **REQ-GRD-002 (MUST)** — Gérer échelles et coefficients configurables par programme. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-002`.
- **REQ-GRD-003 (MUST)** — Appliquer politiques d'arrondi documentées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-003`.
- **REQ-GRD-004 (MUST)** — Distinguer notes provisoires validées et publiées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-004`.
- **REQ-GRD-005 (MUST)** — Gérer validations UE et capitalisation de crédits. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-005`.
- **REQ-GRD-006 (MUST)** — Gérer compensation uniquement selon habilitation académique. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-006`.
- **REQ-GRD-007 (MUST)** — Organiser secondes sessions et absences justifiées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-007`.
- **REQ-GRD-008 (MUST)** — Constituer jury avec membres et quorum. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-008`.
- **REQ-GRD-009 (MUST)** — Produire PV délibérations et signatures traçables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-009`.
- **REQ-GRD-010 (MUST)** — Publier résultats selon calendrier et permissions. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-010`.
- **REQ-GRD-011 (MUST)** — Gérer contestations décisions et rectifications par avenant. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-011`.
- **REQ-GRD-012 (MUST)** — Conserver historique complet de notes et décisions. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-012`.
- **REQ-GRD-013 (MUST)** — Générer relevé de notes cohérent avec sources. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-013`.
- **REQ-GRD-014 (MUST)** — Détecter invariants de crédits et progression. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-014`.
- **REQ-GRD-015 (MUST)** — Empêcher toute modification silencieuse des résultats. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-GRD-015`.

**Gate du module GRD :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## EXN — Examens nationaux externes

**Finalité :** Enregistrer uniquement le suivi documentaire de résultats d'État.

**Processus de référence :** Information → dépôt justificatif → contrôle → archivage.

**Écrans exigés :** Information officielle ; dépôt diplôme ; vérification ; historique.

**Entités principales :** ExternalExamReference, ExternalCredential, ExternalEvidence, Verification.

**Exceptions à tester :** Fausse réussite ; faux diplôme ; confusion avec examen interne.

- **REQ-EXN-001 (MUST)** — Publier informations sur dispositif externe sans prétendre organiser. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-EXN-001`.
- **REQ-EXN-002 (MUST)** — Distinguer examen national du moteur d'évaluation interne. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-EXN-002`.
- **REQ-EXN-003 (MUST)** — Enregistrer déclaration volontaire de participation étudiant. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-EXN-003`.
- **REQ-EXN-004 (MUST)** — Recevoir copie de résultat ou diplôme officiel. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-EXN-004`.
- **REQ-EXN-005 (MUST)** — Contrôler statut déposé en cours vérifié rejeté. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-EXN-005`.
- **REQ-EXN-006 (MUST)** — Empêcher génération de résultat d'examen national. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-EXN-006`.
- **REQ-EXN-007 (MUST)** — Empêcher émission de diplôme d'État par la plateforme. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-EXN-007`.
- **REQ-EXN-008 (MUST)** — Afficher clairement autorité officielle émettrice. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-EXN-008`.
- **REQ-EXN-009 (MUST)** — Archiver preuve de vérification et accès limité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-EXN-009`.
- **REQ-EXN-010 (MUST)** — Gérer absence de données officielles sans présumer réussite. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-EXN-010`.

**Gate du module EXN :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## FIN — Finances et tarification

**Finalité :** Sécuriser encaissements, bourses et comptabilité auxiliaire.

**Processus de référence :** Tarif → facture → échéance → paiement provider → reçu → rapprochement.

**Écrans exigés :** Tarifs ; factures ; comptes ; paiements ; remises ; rapprochements.

**Entités principales :** PriceRule, Invoice, InvoiceLine, Payment, Refund, Scholarship, LedgerEntry.

**Exceptions à tester :** Webhook dupliqué ; devise invalide ; chargeback ; erreur mobile money.

- **REQ-FIN-001 (MUST)** — Créer tarifs par pays région entité programme période et profil. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-001`.
- **REQ-FIN-002 (MUST)** — Gérer devises ISO 4217 et unités mineures. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-002`.
- **REQ-FIN-003 (MUST)** — Définir frais de dossier et coûts récurrents. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-003`.
- **REQ-FIN-004 (MUST)** — Gérer factures numérotées et notes de crédit. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-004`.
- **REQ-FIN-005 (MUST)** — Créer échéanciers et paiements partiels. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-005`.
- **REQ-FIN-006 (MUST)** — Gérer remises bourses et financements employeur. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-006`.
- **REQ-FIN-007 (MUST)** — Intégrer adaptateurs paiement sandbox et production. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-007`.
- **REQ-FIN-008 (MUST)** — Vérifier signatures de webhooks et idempotence. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-008`.
- **REQ-FIN-009 (MUST)** — Calculer solde à partir d'écritures non modifiables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-009`.
- **REQ-FIN-010 (MUST)** — Fournir reçus et preuves de paiement vérifiés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-010`.
- **REQ-FIN-011 (MUST)** — Gérer rapprochement bancaire et écarts. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-011`.
- **REQ-FIN-012 (MUST)** — Traiter échecs remboursements chargebacks et trop-perçus. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-012`.
- **REQ-FIN-013 (MUST)** — Configurer règles de retenue et suspension légalement admises. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-013`.
- **REQ-FIN-014 (MUST)** — Restreindre accès aux données financières. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-014`.
- **REQ-FIN-015 (MUST)** — Exporter journaux et états comptables locaux. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-FIN-015`.

**Gate du module FIN :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## CRED — Documents et diplômes

**Finalité :** Générer uniquement les titres et documents autorisés.

**Processus de référence :** Modèle → validation droit émetteur → signature → émission → vérification/révocation.

**Écrans exigés :** Modèles ; documents ; délivrance ; vérificateur QR ; habilitations.

**Entités principales :** DocumentTemplate, IssuanceRule, Accreditation, Credential, Signature, Revocation.

**Exceptions à tester :** Habilitation expirée ; duplication numéro ; fuite de données sur QR.

- **REQ-CRED-001 (MUST)** — Créer modèles de documents modifiables par institution et langue. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CRED-001`.
- **REQ-CRED-002 (MUST)** — Associer type de document à autorité émettrice. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CRED-002`.
- **REQ-CRED-003 (MUST)** — Vérifier habilitations par programme pays et période. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CRED-003`.
- **REQ-CRED-004 (MUST)** — Verrouiller diplômes officiels lorsque non habilités. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CRED-004`.
- **REQ-CRED-005 (MUST)** — Générer attestations internes selon politique applicable. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CRED-005`.
- **REQ-CRED-006 (MUST)** — Numéroter et signer documents selon procédure. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CRED-006`.
- **REQ-CRED-007 (MUST)** — Créer QR de vérification à divulgation minimale. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CRED-007`.
- **REQ-CRED-008 (MUST)** — Rendre registre de certificats vérifiable publiquement de façon limitée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CRED-008`.
- **REQ-CRED-009 (MUST)** — Permettre révocation et réémission tracée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CRED-009`.
- **REQ-CRED-010 (MUST)** — Gérer pièces de diplômes externes en statut distinct. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CRED-010`.
- **REQ-CRED-011 (MUST)** — Mettre en oeuvre export badge numérique compatible si choisi. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CRED-011`.
- **REQ-CRED-012 (MUST)** — Conserver empreintes et archivage des versions émises. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CRED-012`.
- **REQ-CRED-013 (MUST)** — Empêcher impression de titre national non autorisé. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CRED-013`.

**Gate du module CRED :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## ENT — Campus-Entreprise : entreprises

**Finalité :** Gérer partenaires professionnels vérifiés et multi-utilisateurs.

**Processus de référence :** Inscription entreprise → KYB proportionné → validation → équipe → activités.

**Écrans exigés :** Inscription entreprise ; validation ; profil ; membres ; dashboard.

**Entités principales :** Company, CompanyVerification, CompanyMember, CompanyRole, Partnership.

**Exceptions à tester :** Entreprise fictive ; représentant usurpé ; droits après départ.

- **REQ-ENT-001 (MUST)** — Inscrire entreprise avec identité et justificatifs adaptés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ENT-001`.
- **REQ-ENT-002 (MUST)** — Vérifier existence légale et mandataire autorisé. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ENT-002`.
- **REQ-ENT-003 (MUST)** — Approuver suspendre ou rejeter avec justification. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ENT-003`.
- **REQ-ENT-004 (MUST)** — Autoriser plusieurs recruteurs par entreprise. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ENT-004`.
- **REQ-ENT-005 (MUST)** — Appliquer périmètre de visibilité des données candidates. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ENT-005`.
- **REQ-ENT-006 (MUST)** — Gérer profil public et informations privées séparées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ENT-006`.
- **REQ-ENT-007 (MUST)** — Gérer antennes et filiales si configurées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ENT-007`.
- **REQ-ENT-008 (MUST)** — Publier tableau de bord offres candidatures et partenariats. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ENT-008`.
- **REQ-ENT-009 (MUST)** — Gérer conventions entreprise université signables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ENT-009`.
- **REQ-ENT-010 (MUST)** — Tracer activité des recruteurs et signalements. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ENT-010`.
- **REQ-ENT-011 (MUST)** — Fournir procédure de clôture et suppression selon rétention. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ENT-011`.

**Gate du module ENT :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## JOB — Offres, candidatures et recrutement

**Finalité :** Mettre en relation entreprises et étudiants consentants.

**Processus de référence :** Publication → modération → recherche → candidature → sélection → décision.

**Écrans exigés :** Offres ; recherche ; candidature ; entretiens ; suivi ; alertes.

**Entités principales :** Opportunity, JobApplication, ApplicantSnapshot, Interview, SelectionDecision.

**Exceptions à tester :** Offre frauduleuse ; candidature tardive ; données hors consentement.

- **REQ-JOB-001 (MUST)** — Créer offres stage emploi alternance mission projet. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-JOB-001`.
- **REQ-JOB-002 (MUST)** — Configurer critères de candidatures et calendrier. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-JOB-002`.
- **REQ-JOB-003 (MUST)** — Modérer offres à risque et gérer signalements. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-JOB-003`.
- **REQ-JOB-004 (MUST)** — Rechercher avec filtres pays compétence langue et disponibilité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-JOB-004`.
- **REQ-JOB-005 (MUST)** — Enregistrer favoris alertes et notifications opt-in. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-JOB-005`.
- **REQ-JOB-006 (MUST)** — Déposer CV lettre et pièces sous consentement. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-JOB-006`.
- **REQ-JOB-007 (MUST)** — Gérer version figée de candidature envoyée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-JOB-007`.
- **REQ-JOB-008 (MUST)** — Gérer statuts présélection entretien offre rejet. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-JOB-008`.
- **REQ-JOB-009 (MUST)** — Organiser rendez-vous entretiens et calendriers. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-JOB-009`.
- **REQ-JOB-010 (MUST)** — Restreindre consultation des dossiers par recruteur autorisé. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-JOB-010`.
- **REQ-JOB-011 (MUST)** — Donner à étudiant droit de retrait dans limites légales. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-JOB-011`.
- **REQ-JOB-012 (MUST)** — Produire statistiques d'insertion anonymisées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-JOB-012`.

**Gate du module JOB :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## CAR — Portfolio et compétences

**Finalité :** Relier acquis, preuves et insertion sans divulgation abusive.

**Processus de référence :** Cours évalué → preuve de compétence → portfolio → offre adaptée.

**Écrans exigés :** Profil carrière ; compétences ; projets ; CV ; visibilité.

**Entités principales :** Skill, Evidence, PortfolioItem, CareerProfile, CVVersion, Match.

**Exceptions à tester :** Compétence déclarée prise pour diplôme ; profil exposé sans consentement.

- **REQ-CAR-001 (MUST)** — Créer référentiel de compétences dynamique et localisé. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAR-001`.
- **REQ-CAR-002 (MUST)** — Lier compétences aux cours et évaluations. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAR-002`.
- **REQ-CAR-003 (MUST)** — Distinguer déclarée enseignée évaluée validée certifiée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAR-003`.
- **REQ-CAR-004 (MUST)** — Construire portfolio à visibilité contrôlée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAR-004`.
- **REQ-CAR-005 (MUST)** — Générer CV modifiable et versions PDF. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAR-005`.
- **REQ-CAR-006 (MUST)** — Importer expériences externes marquées non vérifiées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAR-006`.
- **REQ-CAR-007 (MUST)** — Produire suggestions d'offres explicables non discriminatoires. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAR-007`.
- **REQ-CAR-008 (MUST)** — Obtenir accord explicite avant partage recruteur. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAR-008`.
- **REQ-CAR-009 (MUST)** — Journaliser accès du recruteur et révocations. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAR-009`.
- **REQ-CAR-010 (MUST)** — Permettre export compétences et portfolio portable. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAR-010`.

**Gate du module CAR :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## STG — Stages académiques

**Finalité :** Gérer conventions, activités, suivi et crédits éventuels.

**Processus de référence :** Offre → sélection → convention → encadrement → rapport → notation.

**Écrans exigés :** Demande ; convention ; journal ; superviseur ; rapport ; évaluation.

**Entités principales :** Internship, InternshipAgreement, Supervisor, LogEntry, InternshipReview, InternshipGrade.

**Exceptions à tester :** Maître de stage absent ; rupture de convention ; absence étudiant.

- **REQ-STG-001 (MUST)** — Associer stage à programme version UE ou formation libre. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-STG-001`.
- **REQ-STG-002 (MUST)** — Valider éligibilité et prérequis de placement. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-STG-002`.
- **REQ-STG-003 (MUST)** — Générer convention depuis modèle juridiquement valide. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-STG-003`.
- **REQ-STG-004 (MUST)** — Désigner maître de stage et encadreur académique. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-STG-004`.
- **REQ-STG-005 (MUST)** — Capturer signatures et approbations requises. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-STG-005`.
- **REQ-STG-006 (MUST)** — Gérer journal de bord et jalons étudiants. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-STG-006`.
- **REQ-STG-007 (MUST)** — Organiser échanges stagiaire entreprise encadreur. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-STG-007`.
- **REQ-STG-008 (MUST)** — Déposer rapports versions et pièces confidentielles. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-STG-008`.
- **REQ-STG-009 (MUST)** — Appliquer grilles d'évaluation des stages. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-STG-009`.
- **REQ-STG-010 (MUST)** — Déclencher crédits seulement après validation académique. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-STG-010`.
- **REQ-STG-011 (MUST)** — Gérer rupture prolongation report et litige. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-STG-011`.
- **REQ-STG-012 (MUST)** — Produire statistiques de stages par région. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-STG-012`.

**Gate du module STG :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## B2B — Services entreprises et partenaires

**Finalité :** Étendre collaboration à formation, innovation, financement.

**Processus de référence :** Demande → proposition → convention → mission → évaluation.

**Écrans exigés :** Demandes B2B ; partenariats ; projets ; bourses ; forums.

**Entités principales :** B2BRequest, Contract, TrainingOrder, Sponsor, EnterpriseProject, CareerEvent.

**Exceptions à tester :** Confidentialité des projets ; divergence contrat ; financement interrompu.

- **REQ-B2B-001 (MUST)** — Recevoir demandes de formation sur mesure d'entreprise. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-B2B-001`.
- **REQ-B2B-002 (MUST)** — Émettre proposition de programme et devis. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-B2B-002`.
- **REQ-B2B-003 (MUST)** — Inscrire groupes de collaborateurs sponsorisés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-B2B-003`.
- **REQ-B2B-004 (MUST)** — Donner suivi autorisé aux gestionnaires d'entreprise. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-B2B-004`.
- **REQ-B2B-005 (MUST)** — Gérer missions d'innovation et projets d'étudiants. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-B2B-005`.
- **REQ-B2B-006 (MUST)** — Créer conventions de recherche appliquée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-B2B-006`.
- **REQ-B2B-007 (MUST)** — Enregistrer mécénat parrainage et bourses entreprise. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-B2B-007`.
- **REQ-B2B-008 (MUST)** — Organiser forums emplois et stands virtuels. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-B2B-008`.
- **REQ-B2B-009 (MUST)** — Gérer facturation B2B liée à contrats. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-B2B-009`.
- **REQ-B2B-010 (MUST)** — Mesurer impacts projets et partenariats. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-B2B-010`.

**Gate du module B2B :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## SHORT — Formations courtes

**Finalité :** Exécuter formations non diplômantes et parcours professionnels.

**Processus de référence :** Catalogue → inscription → apprentissage → évaluation → attestation.

**Écrans exigés :** Catalogue court ; sessions ; badges ; clients entreprise.

**Entités principales :** ShortCourse, TrainingSession, LearnerEnrollment, CertificateRule.

**Exceptions à tester :** Certificat présenté comme diplôme d'État ; parcours incomplet.

- **REQ-SHORT-001 (MUST)** — Créer formations de toute durée sans rigidité semestrielle. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SHORT-001`.
- **REQ-SHORT-002 (MUST)** — Organiser modules libres et compétences associées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SHORT-002`.
- **REQ-SHORT-003 (MUST)** — Inscrire public externe et salariés d'entreprise. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SHORT-003`.
- **REQ-SHORT-004 (MUST)** — Configurer prix sessions et modalités. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SHORT-004`.
- **REQ-SHORT-005 (MUST)** — Réutiliser contenus validés sous licence. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SHORT-005`.
- **REQ-SHORT-006 (MUST)** — Contrôler progression et preuves de réussite. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SHORT-006`.
- **REQ-SHORT-007 (MUST)** — Générer attestations privées selon politique. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SHORT-007`.
- **REQ-SHORT-008 (MUST)** — Permettre empilement de microcertifications configurées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SHORT-008`.
- **REQ-SHORT-009 (MUST)** — Proposer demande de reconnaissance des acquis sans automatisme. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SHORT-009`.
- **REQ-SHORT-010 (MUST)** — Produire rapports de participation et qualité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SHORT-010`.

**Gate du module SHORT :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## MEM — Mémoires et soutenances

**Finalité :** Gérer mémoire Licence et Master et épreuves de soutenance.

**Processus de référence :** Sujet → validation → encadrement → rapport → jury → dépôt final.

**Écrans exigés :** Sujets ; candidatures ; corrections ; jury ; PV ; archives.

**Entités principales :** ThesisProject, Topic, SupervisorAssignment, Draft, Defense, DefenseOutcome.

**Exceptions à tester :** Soutenance sans jury ; mémoire plagié ; fuite de contenu confidentiel.

- **REQ-MEM-001 (MUST)** — Créer catalogue et dépôt de sujets de mémoire. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-MEM-001`.
- **REQ-MEM-002 (MUST)** — Affecter directeur et codirecteur selon qualification. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-MEM-002`.
- **REQ-MEM-003 (MUST)** — Valider projet sujet et protocole. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-MEM-003`.
- **REQ-MEM-004 (MUST)** — Gérer jalons et dépôt de brouillons successifs. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-MEM-004`.
- **REQ-MEM-005 (MUST)** — Produire commentaires encadrement et corrections. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-MEM-005`.
- **REQ-MEM-006 (MUST)** — Gérer contrôle intégrité et anti-plagiat proportionné. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-MEM-006`.
- **REQ-MEM-007 (MUST)** — Constituer jury et convocations selon règlement. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-MEM-007`.
- **REQ-MEM-008 (MUST)** — Organiser soutenance virtuelle ou physique. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-MEM-008`.
- **REQ-MEM-009 (MUST)** — Enregistrer avis décision et PV de soutenance. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-MEM-009`.
- **REQ-MEM-010 (MUST)** — Gérer dépôt corrigé et embargo documentaire. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-MEM-010`.
- **REQ-MEM-011 (MUST)** — Intégrer validation mémoire aux crédits requis. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-MEM-011`.

**Gate du module MEM :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## PHD — Doctorat et école doctorale

**Finalité :** Permettre gestion complète du parcours doctoral et qualité scientifique.

**Processus de référence :** Projet → admission → inscription → recherche → avis → soutenance → archive.

**Écrans exigés :** Doctorant ; comités ; rapports ; thèse ; soutenance.

**Entités principales :** DoctoralAdmission, DoctoralProgram, DoctoralStudent, Committee, ProgressReview, PhDDefense.

**Exceptions à tester :** Inscription périmée ; supervision perdue ; non-conformité éthique.

- **REQ-PHD-001 (MUST)** — Constituer dossier candidature scientifique doctoral. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-PHD-001`.
- **REQ-PHD-002 (MUST)** — Gérer école doctorale et laboratoires associés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-PHD-002`.
- **REQ-PHD-003 (MUST)** — Valider projet de recherche et financement éventuel. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-PHD-003`.
- **REQ-PHD-004 (MUST)** — Désigner directeurs codirecteurs et comité de suivi. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-PHD-004`.
- **REQ-PHD-005 (MUST)** — Organiser réinscriptions et délais règlementaires configurés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-PHD-005`.
- **REQ-PHD-006 (MUST)** — Suivre formations doctorales et séminaires. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-PHD-006`.
- **REQ-PHD-007 (MUST)** — Déposer rapports annuels et décisions de suivi. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-PHD-007`.
- **REQ-PHD-008 (MUST)** — Gérer participation scientifiques et publications. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-PHD-008`.
- **REQ-PHD-009 (MUST)** — Intégrer contrôle éthique et intégrité académique. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-PHD-009`.
- **REQ-PHD-010 (MUST)** — Gérer autorisations et procédure de pré-soutenance. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-PHD-010`.
- **REQ-PHD-011 (MUST)** — Organiser jurys avis et soutenance de thèse. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-PHD-011`.
- **REQ-PHD-012 (MUST)** — Archiver version finale sous conditions et embargo. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-PHD-012`.
- **REQ-PHD-013 (MUST)** — Contrôler habilitation avant toute diplomation. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-PHD-013`.

**Gate du module PHD :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## RND — Recherche et innovation

**Finalité :** Suivre projets, publications, équipes et collaborations.

**Processus de référence :** Appel → projet → financement → activités → livrables → clôture.

**Écrans exigés :** Laboratoires ; projets ; publication ; budget ; éthique.

**Entités principales :** Lab, ResearchProject, ResearchGrant, Publication, EthicsApproval, IPAsset.

**Exceptions à tester :** Données de recherche sensibles ; conflit d'intérêts ; embargo.

- **REQ-RND-001 (MUST)** — Créer laboratoires et unités scientifiques. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-RND-001`.
- **REQ-RND-002 (MUST)** — Enregistrer chercheurs équipes et rattachements. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-RND-002`.
- **REQ-RND-003 (MUST)** — Suivre appels à projets et candidatures. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-RND-003`.
- **REQ-RND-004 (MUST)** — Gérer projet budgets jalons et livrables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-RND-004`.
- **REQ-RND-005 (MUST)** — Associer financements et rapports justificatifs. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-RND-005`.
- **REQ-RND-006 (MUST)** — Enregistrer publications identifiants et liens bibliographiques. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-RND-006`.
- **REQ-RND-007 (MUST)** — Administrer dossiers d'éthique scientifique. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-RND-007`.
- **REQ-RND-008 (MUST)** — Gérer conflits d'intérêts et droits de propriété intellectuelle. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-RND-008`.
- **REQ-RND-009 (MUST)** — Suivre conventions partenaires et accès aux données. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-RND-009`.
- **REQ-RND-010 (MUST)** — Gérer dépôt archivage et embargo de résultats. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-RND-010`.

**Gate du module RND :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## LIB — Bibliothèque universitaire

**Finalité :** Donner accès légal aux ressources documentaires.

**Processus de référence :** Acquisition → catalogage → autorisation → consultation/prêt → fin licence.

**Écrans exigés :** Catalogue ; recherches ; ressources ; licences ; abonnements.

**Entités principales :** LibraryItem, Collection, License, Acquisition, Loan, RepositoryDeposit.

**Exceptions à tester :** Licence expirée ; diffusion illicite ; ouvrage réservé.

- **REQ-LIB-001 (MUST)** — Créer catalogue livres revues rapports et thèses. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIB-001`.
- **REQ-LIB-002 (MUST)** — Classer métadonnées auteurs thèmes langues et versions. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIB-002`.
- **REQ-LIB-003 (MUST)** — Gérer abonnements et droits d'accès par établissement. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIB-003`.
- **REQ-LIB-004 (MUST)** — Assurer consultation de documents sous licence. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIB-004`.
- **REQ-LIB-005 (MUST)** — Permettre prêts numériques si droit accordé. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIB-005`.
- **REQ-LIB-006 (MUST)** — Suivre acquisitions coûts et renouvellements. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIB-006`.
- **REQ-LIB-007 (MUST)** — Produire recherche avancée et favoris. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIB-007`.
- **REQ-LIB-008 (MUST)** — Gérer dépôts institutionnels des mémoires et thèses. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIB-008`.
- **REQ-LIB-009 (MUST)** — Contrôler embargos et retrait légal. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIB-009`.
- **REQ-LIB-010 (MUST)** — Gérer demandes aux bibliothécaires et signalements. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-LIB-010`.

**Gate du module LIB :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## CAMP — Vie universitaire et communauté

**Finalité :** Créer un campus social sécurisé et productif.

**Processus de référence :** Inscription groupe → participation → événements → modération.

**Écrans exigés :** Groupes ; clubs ; forum ; événements ; tutorat ; mentorat.

**Entités principales :** Community, Group, Membership, Post, Event, Mentorship, ModerationCase.

**Exceptions à tester :** Harcèlement ; divulgation données ; absence de modération.

- **REQ-CAMP-001 (MUST)** — Créer communautés de promotion filière et intérêt. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAMP-001`.
- **REQ-CAMP-002 (MUST)** — Gérer clubs et associations avec responsables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAMP-002`.
- **REQ-CAMP-003 (MUST)** — Offrir forums thématiques modérés et recherche. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAMP-003`.
- **REQ-CAMP-004 (MUST)** — Autoriser activités de groupe et livrables communs. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAMP-004`.
- **REQ-CAMP-005 (MUST)** — Organiser mentorat étudiants Alumni enseignants. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAMP-005`.
- **REQ-CAMP-006 (MUST)** — Gérer événements virtuels et physiques autorisés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAMP-006`.
- **REQ-CAMP-007 (MUST)** — Proposer tutorat et rendez-vous pédagogique. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAMP-007`.
- **REQ-CAMP-008 (MUST)** — Gérer signalements contenu abusif et procédures. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAMP-008`.
- **REQ-CAMP-009 (MUST)** — Produire annuaire de communauté à consentement. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAMP-009`.
- **REQ-CAMP-010 (MUST)** — Distinguer annonces institutionnelles et discussions libre. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-CAMP-010`.

**Gate du module CAMP :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## SUP — Support, recours et services

**Finalité :** Fournir service étudiant et gestion des demandes traçable.

**Processus de référence :** Ticket → classification → affectation → résolution → satisfaction.

**Écrans exigés :** Centre aide ; formulaires ; tickets ; recours ; rendez-vous.

**Entités principales :** Ticket, ServiceRequest, SLA, Escalation, KnowledgeArticle, AppealCase.

**Exceptions à tester :** Ticket critique ; conflit ; dépassement de SLA ; données protégées.

- **REQ-SUP-001 (MUST)** — Créer demandes administratives et tickets multicanaux. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SUP-001`.
- **REQ-SUP-002 (MUST)** — Configurer catégories et formulaires dynamiques. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SUP-002`.
- **REQ-SUP-003 (MUST)** — Affecter demandes selon région et compétence. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SUP-003`.
- **REQ-SUP-004 (MUST)** — Définir SLA échéance et escalade. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SUP-004`.
- **REQ-SUP-005 (MUST)** — Gérer messagerie dossier et pièces jointes sécurisées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SUP-005`.
- **REQ-SUP-006 (MUST)** — Fournir FAQ et base de connaissances. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SUP-006`.
- **REQ-SUP-007 (MUST)** — Gérer recours académiques avec séparation des rôles. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SUP-007`.
- **REQ-SUP-008 (MUST)** — Consigner médiation et décisions motivées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SUP-008`.
- **REQ-SUP-009 (MUST)** — Proposer rendez-vous d'aide et d'orientation. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SUP-009`.
- **REQ-SUP-010 (MUST)** — Mesurer qualité support et résolution sans fuite de données. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SUP-010`.

**Gate du module SUP :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## NOT — Messagerie et notifications

**Finalité :** Informer les acteurs sans spam ni fuite de données.

**Processus de référence :** Evénement → modèle → canal → livraison → statut/relance.

**Écrans exigés :** Boîte ; préférences ; templates ; campagne ; logs.

**Entités principales :** Message, Notification, Template, Preference, DeliveryAttempt, Thread.

**Exceptions à tester :** E-mail non délivré ; invitation expirée ; message envoyé au mauvais acteur.

- **REQ-NOT-001 (MUST)** — Créer messagerie interne avec conversations et droits. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-NOT-001`.
- **REQ-NOT-002 (MUST)** — Gérer templates multilingues versionnés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-NOT-002`.
- **REQ-NOT-003 (MUST)** — Configurer notifications par événement et portée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-NOT-003`.
- **REQ-NOT-004 (MUST)** — Respecter préférences et consentements. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-NOT-004`.
- **REQ-NOT-005 (MUST)** — Fournir email avec adapter sandbox et réel. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-NOT-005`.
- **REQ-NOT-006 (MUST)** — Fournir SMS avec adapter sandbox et réel. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-NOT-006`.
- **REQ-NOT-007 (MUST)** — Gérer push web facultatif sous consentement. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-NOT-007`.
- **REQ-NOT-008 (MUST)** — Gérer files relances et échecs temporaires. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-NOT-008`.
- **REQ-NOT-009 (MUST)** — Eviter fuite de données sensibles dans messages externes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-NOT-009`.
- **REQ-NOT-010 (MUST)** — Fournir historique et preuve technique de livraison. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-NOT-010`.

**Gate du module NOT :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## ALUM — Alumni et formation tout au long de la vie

**Finalité :** Pérenniser lien avec anciens étudiants.

**Processus de référence :** Fin parcours → activation Alumni → réseau → mentorat/reformation.

**Écrans exigés :** Annuaire opt-in ; carrière ; événements ; offres.

**Entités principales :** AlumniProfile, AlumniConsent, NetworkConnection, ContinuingEducation.

**Exceptions à tester :** Exposition profil ancien étudiant ; accès aux notes expiré.

- **REQ-ALUM-001 (MUST)** — Convertir profil étudiant vers Alumni sans recréer identité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ALUM-001`.
- **REQ-ALUM-002 (MUST)** — Conserver documents autorisés sous politique de conservation. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ALUM-002`.
- **REQ-ALUM-003 (MUST)** — Gérer annuaire Alumni à visibilité volontaire. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ALUM-003`.
- **REQ-ALUM-004 (MUST)** — Proposer événements et mentorat. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ALUM-004`.
- **REQ-ALUM-005 (MUST)** — Proposer offres de formation continue. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ALUM-005`.
- **REQ-ALUM-006 (MUST)** — Permettre mise à jour du parcours professionnel. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ALUM-006`.
- **REQ-ALUM-007 (MUST)** — Mesurer insertion avec consentement et agrégation. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ALUM-007`.
- **REQ-ALUM-008 (MUST)** — Donner fermeture export et contrôle des données. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ALUM-008`.

**Gate du module ALUM :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## QMS — Assurance qualité et accréditation

**Finalité :** Produire dossiers de preuves, audits et amélioration continue.

**Processus de référence :** Référentiel → autoévaluation → contrôle → non-conformité → action → vérification.

**Écrans exigés :** Référentiels ; audits ; preuves ; non-conformités ; plans d'action.

**Entités principales :** QualityStandard, Criterion, Evidence, Audit, Finding, CAPA, AccreditationFile.

**Exceptions à tester :** Preuve périmée ; faux statut d'accréditation ; action non clôturée.

- **REQ-QMS-001 (MUST)** — Configurer référentiels qualité par pays et programme. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-QMS-001`.
- **REQ-QMS-002 (MUST)** — Associer critères qualité à sources de données vérifiables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-QMS-002`.
- **REQ-QMS-003 (MUST)** — Créer campagnes d'autoévaluation institutionnelle. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-QMS-003`.
- **REQ-QMS-004 (MUST)** — Gérer preuves documents et responsables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-QMS-004`.
- **REQ-QMS-005 (MUST)** — Organiser audits internes et externes habilités. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-QMS-005`.
- **REQ-QMS-006 (MUST)** — Enregistrer non-conformités et causes racines. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-QMS-006`.
- **REQ-QMS-007 (MUST)** — Créer plans d'actions responsables et échéances. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-QMS-007`.
- **REQ-QMS-008 (MUST)** — Vérifier efficacité et clôture des actions. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-QMS-008`.
- **REQ-QMS-009 (MUST)** — Produire dossier d'accréditation exportable. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-QMS-009`.
- **REQ-QMS-010 (MUST)** — Suivre statuts vrais des autorisations réglementaires. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-QMS-010`.
- **REQ-QMS-011 (MUST)** — Gérer enquêtes satisfaction anonymes et analyses. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-QMS-011`.
- **REQ-QMS-012 (MUST)** — Conserver piste d'audit des validations de cours. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-QMS-012`.

**Gate du module QMS :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## DPO — Protection des données et conformité

**Finalité :** Gérer politiques, droits et frontières réglementaires.

**Processus de référence :** Politique régionale → consentement/traitement → demande → réponse/audit.

**Écrans exigés :** Politiques ; données ; consentements ; droits ; conservation.

**Entités principales :** LegalBasis, ProcessingActivity, RetentionPolicy, DataSubjectRequest, Consent.

**Exceptions à tester :** Conflit obligation de conservation/droit suppression ; transfert non autorisé.

- **REQ-DPO-001 (MUST)** — Déclarer bases légales de traitements par région. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DPO-001`.
- **REQ-DPO-002 (MUST)** — Construire registre des traitements de données. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DPO-002`.
- **REQ-DPO-003 (MUST)** — Configurer rétentions et archivage par catégorie. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DPO-003`.
- **REQ-DPO-004 (MUST)** — Permettre accès rectification portabilité selon droit applicable. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DPO-004`.
- **REQ-DPO-005 (MUST)** — Gérer opposition ou retrait de consentement quand applicable. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DPO-005`.
- **REQ-DPO-006 (MUST)** — Contrôler transferts de données entre pays. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DPO-006`.
- **REQ-DPO-007 (MUST)** — Segmenter catégories sensibles et accès restreints. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DPO-007`.
- **REQ-DPO-008 (MUST)** — Gérer notification d'incidents selon processus. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DPO-008`.
- **REQ-DPO-009 (MUST)** — Tracer demandes et réponses de droits des personnes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DPO-009`.
- **REQ-DPO-010 (MUST)** — Gérer données de mineurs et représentants si applicable. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DPO-010`.

**Gate du module DPO :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## ANA — Statistiques et décisionnel

**Finalité :** Fournir tableaux de bord exacts, filtrés et auditables.

**Processus de référence :** Collecte → définition métrique → agrégation → publication.

**Écrans exigés :** Tableau de bord ; rapports ; exports ; observabilité métier.

**Entités principales :** MetricDefinition, EventFact, Dashboard, Report, DataExport.

**Exceptions à tester :** Double comptage ; effet petit groupe ; métrique recalculée après correction.

- **REQ-ANA-001 (MUST)** — Configurer tableaux de bord institutionnels par rôle. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ANA-001`.
- **REQ-ANA-002 (MUST)** — Calculer admissions taux conversion et cohortes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ANA-002`.
- **REQ-ANA-003 (MUST)** — Suivre progressions pédagogiques distinctes des notes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ANA-003`.
- **REQ-ANA-004 (MUST)** — Calculer résultats et taux de réussite vérifiables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ANA-004`.
- **REQ-ANA-005 (MUST)** — Suivre paiement créances et bourses. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ANA-005`.
- **REQ-ANA-006 (MUST)** — Suivre performance cours et délais feedback. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ANA-006`.
- **REQ-ANA-007 (MUST)** — Mesurer placements stages emplois et entreprises. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ANA-007`.
- **REQ-ANA-008 (MUST)** — Mesurer projets recherche et productions. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ANA-008`.
- **REQ-ANA-009 (MUST)** — Filtrer par pays région programme période cohortes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ANA-009`.
- **REQ-ANA-010 (MUST)** — Exporter données selon anonymisation et permissions. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ANA-010`.
- **REQ-ANA-011 (MUST)** — Conserver définition versionnée des indicateurs. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ANA-011`.
- **REQ-ANA-012 (MUST)** — Protéger anonymat des petits groupes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-ANA-012`.

**Gate du module ANA :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## AI — Assistance IA responsable

**Finalité :** Aider sans automatiser décisions académiques ou juridiques.

**Processus de référence :** Consentement → requête → RAG facultatif → suggestion → contrôle humain.

**Écrans exigés :** Assistant étudiant ; enseignant ; administration ; suivi et coûts.

**Entités principales :** AIModelPolicy, PromptTemplate, RetrievalSource, AIInteraction, AIReview.

**Exceptions à tester :** Hallucination ; fuite de dossier ; coût excessif ; biais.

- **REQ-AI-001 (MUST)** — Créer adaptateur IA désactivable et régionalisable. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-AI-001`.
- **REQ-AI-002 (MUST)** — Indexer seulement ressources pédagogiques autorisées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-AI-002`.
- **REQ-AI-003 (MUST)** — Fournir citations vers les cours et sources internes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-AI-003`.
- **REQ-AI-004 (MUST)** — Aider étudiant à comprendre sans livrer corrigés interdits. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-AI-004`.
- **REQ-AI-005 (MUST)** — Aider enseignant à générer brouillons et quiz. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-AI-005`.
- **REQ-AI-006 (MUST)** — Aider agent à retrouver procédures administratives. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-AI-006`.
- **REQ-AI-007 (MUST)** — Définir modération et filtrage de secrets. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-AI-007`.
- **REQ-AI-008 (MUST)** — Protéger dossiers sensibles contre accès au modèle non autorisé. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-AI-008`.
- **REQ-AI-009 (MUST)** — Tracer versions modèles invites et coûts sans exposer secrets. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-AI-009`.
- **REQ-AI-010 (MUST)** — Interdire toute décision automatique admission sanction note diplôme. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-AI-010`.
- **REQ-AI-011 (MUST)** — Evaluer qualité et biais sur jeux de tests. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-AI-011`.

**Gate du module AI :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## I18N — Langues, devises et temporalité

**Finalité :** Garantir régionalisation sans clones logiciels.

**Processus de référence :** Configuration langue région → rendu → contenu localisé → contrôle.

**Écrans exigés :** Editeur traductions ; préférences ; terminologie ; fuseaux.

**Entités principales :** Locale, Translation, Terminology, CurrencyConfig, CalendarRule.

**Exceptions à tester :** Date ambiguë ; devise arrondie ; changement langue sans contenu.

- **REQ-I18N-001 (MUST)** — Définir langues d'interface indépendantes des langues de cours. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-I18N-001`.
- **REQ-I18N-002 (MUST)** — Gérer dictionnaire et ressources i18n externalisées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-I18N-002`.
- **REQ-I18N-003 (MUST)** — Permettre traduction des titres de structures et programmes. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-I18N-003`.
- **REQ-I18N-004 (MUST)** — Appliquer formats nombres devises et adresses locaux. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-I18N-004`.
- **REQ-I18N-005 (MUST)** — Gérer fuseaux IANA et changement heure légale. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-I18N-005`.
- **REQ-I18N-006 (MUST)** — Configurer calendriers universitaires et jours non ouvrés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-I18N-006`.
- **REQ-I18N-007 (MUST)** — Gérer adaptation contenu pédagogique par territoire. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-I18N-007`.
- **REQ-I18N-008 (MUST)** — Prévoir fallback explicite lorsque traduction manque. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-I18N-008`.
- **REQ-I18N-009 (MUST)** — Fournir tests de dates limites à fuseaux différents. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-I18N-009`.
- **REQ-I18N-010 (MUST)** — Garantir absence de texte français codé en dur dans UI. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-I18N-010`.

**Gate du module I18N :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## A11Y — Accessibilité et faible débit

**Finalité :** Inclure apprenants mobile et handicap.

**Processus de référence :** Choix préférences → consultation → dépôt → reprise.

**Écrans exigés :** Préférences ; lecteur ; dépôt hors ligne ; transcription.

**Entités principales :** AccessibilityPreference, OfflineDraft, SyncConflict, CaptionTrack.

**Exceptions à tester :** Rupture réseau ; conflits ; lecteur écran ; vidéo inaccessible.

- **REQ-A11Y-001 (MUST)** — Concevoir navigation clavier et sémantique accessible. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-A11Y-001`.
- **REQ-A11Y-002 (MUST)** — Atteindre WCAG 2.2 AA sur parcours critiques. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-A11Y-002`.
- **REQ-A11Y-003 (MUST)** — Fournir contraste lisible tailles et zoom jusqu'à 200 pourcent. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-A11Y-003`.
- **REQ-A11Y-004 (MUST)** — Sous-titrer et transcrire contenus vidéo audio. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-A11Y-004`.
- **REQ-A11Y-005 (MUST)** — Proposer version texte téléchargeable des cours. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-A11Y-005`.
- **REQ-A11Y-006 (MUST)** — Adapter bitrate vidéo et tailles ressources. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-A11Y-006`.
- **REQ-A11Y-007 (MUST)** — Sauvegarder brouillons avec indication de synchronisation. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-A11Y-007`.
- **REQ-A11Y-008 (MUST)** — Reprendre activité après reconnexion sans doublon. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-A11Y-008`.
- **REQ-A11Y-009 (MUST)** — Traiter conflit entre brouillons locaux et serveur. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-A11Y-009`.
- **REQ-A11Y-010 (MUST)** — Rendre erreurs formulaires explicites et exploitables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-A11Y-010`.
- **REQ-A11Y-011 (MUST)** — Tester sur smartphone milieu de gamme et réseau dégradé. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-A11Y-011`.

**Gate du module A11Y :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## DOC — GED et archivage institutionnel

**Finalité :** Fournir gestion documentaire générale sécurisée.

**Processus de référence :** Dépôt → contrôle → classification → revue → archive/retrait.

**Écrans exigés :** GED ; dossiers ; versions ; approbations ; recherche.

**Entités principales :** FileAsset, DocumentVersion, Folder, Classification, AccessGrant, RetentionRule.

**Exceptions à tester :** Malware ; archive illisible ; suppression illégitime.

- **REQ-DOC-001 (MUST)** — Importer fichiers avec scan antivirus et checksum. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DOC-001`.
- **REQ-DOC-002 (MUST)** — Stocker fichiers privés avec URLs temporaires signées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DOC-002`.
- **REQ-DOC-003 (MUST)** — Classer documents par typologie dossier et portée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DOC-003`.
- **REQ-DOC-004 (MUST)** — Conserver versions et auteurs des documents. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DOC-004`.
- **REQ-DOC-005 (MUST)** — Fournir workflow de relecture et approbation. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DOC-005`.
- **REQ-DOC-006 (MUST)** — Gérer niveaux de confidentialité et partage contrôlé. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DOC-006`.
- **REQ-DOC-007 (MUST)** — Prévisualiser formats courants de manière isolée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DOC-007`.
- **REQ-DOC-008 (MUST)** — Rechercher contenus avec ACL appliquées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DOC-008`.
- **REQ-DOC-009 (MUST)** — Archiver selon règles de conservation. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DOC-009`.
- **REQ-DOC-010 (MUST)** — Prouver export réversible et intégrité de restauration. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-DOC-010`.

**Gate du module DOC :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## WF — Moteur de processus configurable

**Finalité :** Orchestrer procédures sans codes métiers rigides.

**Processus de référence :** Concevoir → simuler → publier version → exécuter → auditer.

**Écrans exigés :** Editeur workflow ; designer formulaires ; instances ; escalade.

**Entités principales :** WorkflowDefinition, WorkflowVersion, State, Transition, WorkflowInstance, ActionLog.

**Exceptions à tester :** Instance en cours lors édition ; contournement condition ; effet secondaire répété.

- **REQ-WF-001 (MUST)** — Construire machines états configurables et typées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-WF-001`.
- **REQ-WF-002 (MUST)** — Définir transitions gardes permissions et validations. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-WF-002`.
- **REQ-WF-003 (MUST)** — Designer formulaires dynamiques accessibles. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-WF-003`.
- **REQ-WF-004 (MUST)** — Configurer approbation parallèle ou séquentielle. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-WF-004`.
- **REQ-WF-005 (MUST)** — Associer notifications et délais de traitement. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-WF-005`.
- **REQ-WF-006 (MUST)** — Simuler workflow sur cas de tests avant publication. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-WF-006`.
- **REQ-WF-007 (MUST)** — Versionner définitions sans briser instances actives. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-WF-007`.
- **REQ-WF-008 (MUST)** — Exécuter effets secondaires idempotents. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-WF-008`.
- **REQ-WF-009 (MUST)** — Gérer retours corrections rejets et escalades. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-WF-009`.
- **REQ-WF-010 (MUST)** — Permettre audit complet des transitions et approbateurs. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-WF-010`.
- **REQ-WF-011 (MUST)** — Intégrer moteur aux admissions contrats stages et jurys. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-WF-011`.

**Gate du module WF :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## INTG — API et intégrations externes

**Finalité :** Rendre les services interopérables et récupérables.

**Processus de référence :** Créer connecteur → sandbox → test contrat → activation → supervision.

**Écrans exigés :** Catalogue intégrations ; secrets ; état ; webhooks ; contrats.

**Entités principales :** Integration, ProviderCredentialRef, WebhookDelivery, ImportJob, ExportJob.

**Exceptions à tester :** Changement API provider ; quota ; signature invalide ; indisponibilité.

- **REQ-INTG-001 (MUST)** — Publier OpenAPI 3.1 versionnée et contrats schématisés. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-INTG-001`.
- **REQ-INTG-002 (MUST)** — Gérer clé d'idempotence sur écritures critiques. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-INTG-002`.
- **REQ-INTG-003 (MUST)** — Fournir webhooks sortants signés et rejouables. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-INTG-003`.
- **REQ-INTG-004 (MUST)** — Recevoir webhooks entrants avec vérification de signature. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-INTG-004`.
- **REQ-INTG-005 (MUST)** — Créer adaptateurs paiement email SMS vidéo et stockage. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-INTG-005`.
- **REQ-INTG-006 (MUST)** — Supporter LTI 1.3 via connecteur conforme. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-INTG-006`.
- **REQ-INTG-007 (MUST)** — Préparer import export QTI sans perte sémantique. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-INTG-007`.
- **REQ-INTG-008 (MUST)** — Préparer Open Badges 3.0 avec preuves de compatibilité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-INTG-008`.
- **REQ-INTG-009 (MUST)** — Fournir exports CSV JSON et formats ouverts. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-INTG-009`.
- **REQ-INTG-010 (MUST)** — Exécuter migrations import legacy contrôlées. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-INTG-010`.
- **REQ-INTG-011 (MUST)** — Gérer circuit breaker retry timeout et dead-letter. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-INTG-011`.
- **REQ-INTG-012 (MUST)** — Documenter dépendances prestataires et coût. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-INTG-012`.
- **REQ-INTG-013 (MUST)** — Fournir tests de contrat sandbox et versionnement. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-INTG-013`.

**Gate du module INTG :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## SEC — Sécurité technique et fraude

**Finalité :** Prévenir exploitation et compromission de données.

**Processus de référence :** Threat model → politiques → tests → supervision → remédiation.

**Écrans exigés :** Console sécurité ; incidents ; audit ; accès ; alertes.

**Entités principales :** SecurityFinding, AuditEvent, Incident, SecurityPolicy, AccessReview.

**Exceptions à tester :** IDOR ; injection ; faux paiement ; privilège excessif ; fuite.

- **REQ-SEC-001 (MUST)** — Maintenir threat model par module et flux. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-001`.
- **REQ-SEC-002 (MUST)** — Appliquer contrôle d'accès serveur sur chaque endpoint. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-002`.
- **REQ-SEC-003 (MUST)** — Tester isolation inter-entités et inter-régions. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-003`.
- **REQ-SEC-004 (MUST)** — Durcir session cookie CSRF CSP et headers. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-004`.
- **REQ-SEC-005 (MUST)** — Contrôler fichiers dangereux et contenu HTML. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-005`.
- **REQ-SEC-006 (MUST)** — Gérer rotation secrets et privilèges minimaux. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-006`.
- **REQ-SEC-007 (MUST)** — Implémenter MFA obligatoire pour fonctions sensibles. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-007`.
- **REQ-SEC-008 (MUST)** — Fournir audit append-only des actes sensibles. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-008`.
- **REQ-SEC-009 (MUST)** — Fournir analyse SAST SCA secrets et DAST en CI. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-009`.
- **REQ-SEC-010 (MUST)** — Exécuter tests OWASP ASVS pertinents. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-010`.
- **REQ-SEC-011 (MUST)** — Prévoir réponse incident et canaux d'alerte. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-011`.
- **REQ-SEC-012 (MUST)** — Procéder revues d'accès régulières. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-012`.
- **REQ-SEC-013 (MUST)** — Protéger émission notes paiements et diplômes contre fraude. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-013`.
- **REQ-SEC-014 (MUST)** — Vérifier sauvegarde et suppression conforme. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-SEC-014`.

**Gate du module SEC :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

## OPS — Exploitation et réversibilité

**Finalité :** Garantir fonctionnement continu et reprise après incident.

**Processus de référence :** Build → test → release → monitoring → backup → disaster recovery.

**Écrans exigés :** CI ; déploiement ; supervision ; sauvegarde ; incidents ; exports.

**Entités principales :** PipelineRun, Release, Deployment, Alert, RestoreExercise, DataPackage.

**Exceptions à tester :** CI rouge ; rollback incompatible ; perte de messages ; verrou fournisseur.

- **REQ-OPS-001 (MUST)** — Construire CI lint typage tests migrations sécurité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-001`.
- **REQ-OPS-002 (MUST)** — Séparer branches environnements et secrets. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-002`.
- **REQ-OPS-003 (MUST)** — Publier versions avec changelog et artefacts. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-003`.
- **REQ-OPS-004 (MUST)** — Fournir déploiement automatisé documenté. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-004`.
- **REQ-OPS-005 (MUST)** — Exécuter tests smoke après déploiement. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-005`.
- **REQ-OPS-006 (MUST)** — Surveiller latence erreurs jobs files et coût. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-006`.
- **REQ-OPS-007 (MUST)** — Définir SLO alertes on-call et incident response. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-007`.
- **REQ-OPS-008 (MUST)** — Exécuter test de montée en charge représentatif. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-008`.
- **REQ-OPS-009 (MUST)** — Prouver restauration base objets et clés via exercice. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-009`.
- **REQ-OPS-010 (MUST)** — Définir politique rétention et purge contrôlée. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-010`.
- **REQ-OPS-011 (MUST)** — Permettre export total des données selon droits. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-011`.
- **REQ-OPS-012 (MUST)** — Vérifier plan retour arrière et continuité. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-012`.
- **REQ-OPS-013 (MUST)** — Documenter inventaire technique fournisseurs et licences. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-013`.
- **REQ-OPS-014 (MUST)** — Empêcher déploiement production en CI rouge. **Preuve :** UI + API + base + contrôle d'accès + cas d'erreur + test `TST-OPS-014`.

**Gate du module OPS :** parcours de bout en bout exécuté depuis une base de test neuve et une configuration régionale non préremplie ; interdiction des mocks permanents ou des raccourcis d'habilitation ; revues accessibilité, isolation et intégration.

# 27. CLAUSE DE FIN DE MISSION

La mission est terminée uniquement lorsque toutes les exigences `MUST` de la matrice sont marquées `VERIFIE`, associées à des preuves reproductibles, que les parcours critiques sont passés sur environnement de recette, et que les dépendances externes restant à fournir sont clairement distinguées du logiciel livré. Une fonctionnalité bloquée par un contrat externe peut être dite « implémentée en sandbox, activation production bloquée », mais **jamais « totalement opérationnelle en production »**. Une impossibilité juridique ne peut pas être contournée par code. Tous les modules non encore livrés demeurent dans le plan jusqu'à résolution explicite.
