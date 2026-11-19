# PLAN DE TEST, TESTS D'ACCEPTATION ET RECETTE UNOA

## 1. Principes

Les tests décrits sont **des spécifications à implémenter** dans la future base de code, et non des tests déjà exécutés. Chaque exigence `REQ-*` possède un identifiant `TST-*` dans la matrice ; Claude Code doit développer réellement le test, le faire passer, consigner sa preuve et vérifier la non-régression. Les tests E2E ci-dessous vérifient les parcours traversant plusieurs modules. Aucun écran inerte, mock permanent ou assertion triviale ne peut valider un scénario. Tester toujours au moins : positif, négatif, autorisation, région différente, erreurs réseau/concurrence si pertinent.

## 2. Niveaux et critères

| Niveau | Test exigé | Preuve |
|---|---|---|
| Schéma/DB | Contraintes, migrations vierge/peuplée, index, concurrence, transactions | sortie migration, tests DB |
| Domaine | Calculs crédits, barèmes, habilitations, transitions d'état | suite unitaires invariant |
| API | Valider entrée, codes d'erreur, permissions, portées, idempotence | intégration API réelle |
| Contrats | DTO, OpenAPI, événements, webhooks, fournisseur sandbox | tests de contrat |
| Frontend | Formulaires, états, navigation, erreurs, langues | tests UI |
| E2E | Parcours intégrés utilisateurs représentatifs | Playwright/équivalent |
| Sécurité | OWASP, BOLA/IDOR, scans, fuite secret, CSRF, fichiers | rapport signé / CI |
| Accessibilité | WCAG 2.2 AA, clavier, screenreader, zoom, contrastes | rapport automatique + manuel |
| Performance | charge, endurance, latences, contention, uploads | k6/équivalent |
| Résilience | reprise incident, sauvegarde restauration, offline | runbook et preuve |

## 3. Scénarios E2E obligatoires — fichier à convertir en tests exécutables

### E2E-001 — Base vierge et région nouvelle
**Étant donné** une installation sans faculté, filière ni cours, **quand** un administrateur habilité crée pays fictif Alpha, établissement, faculté, programme, UE, cours, **alors** le catalogue affiche ces créations après validation sans changement du code, les données sont persistées et auditées.

### E2E-002 — Régions contradictoires
**Étant donné** Alpha/ Beta avec langues, périodes, monnaies, barèmes différents, **quand** chacune publie son programme, **alors** les deux fonctionnent dans la même application, sans contamination de règles.

### E2E-003 — Override légal refusé
**Étant donné** une contrainte d'émission officielle non dérogeable, **quand** le responsable régional tente de l'outrepasser, **alors** la publication est refusée avec motif et événement d'audit.

### E2E-004 — Versions de programme
**Étant donné** une cohorte liée à version V1, **quand** un nouveau programme V2 est publié, **alors** ses notes, crédits, barèmes et documents restent régis par V1 sauf transition approuvée.

### E2E-005 — Candidature étudiante complète
**Étant donné** un programme ouvert et admissible, **quand** un candidat dépose pièces, puis reçoit avis favorable, **alors** il accepte, paie si applicable, est inscrit au bon programme/version/cohorte, dispose d'un matricule unique et accède à ses cours.

### E2E-006 — Dossier incomplet
**Étant donné** une candidature avec pièce manquante, **quand** le candidat soumet, **alors** une erreur exploitable indique la pièce manquante ; le brouillon et les fichiers valides sont conservés.

### E2E-007 — Admission refusée ou conditionnelle
**Étant donné** une évaluation administrative et académique, **quand** la décision est conditionnelle ou refusée, **alors** la notification, les motifs accessibles et le recours suivent le workflow configuré ; aucune inscription automatique n'est créée.

### E2E-008 — Candidat multirôle
**Étant donné** une personne étudiant et candidat enseignant, **quand** elle change d'espace, **alors** le compte reste unique ; les permissions et dossiers de chaque rôle restent isolés.

### E2E-009 — Enseignant recruté
**Étant donné** un appel académique, **quand** le candidat soumet qualification, syllabus et TP, **alors** contrôle, revue disciplinaire, décision, contrat et affectation sont traçables.

### E2E-010 — Enseignant rejeté
**Étant donné** un enseignant sans qualification validée, **quand** il tente une publication ou une correction, **alors** la requête serveur est refusée.

### E2E-011 — Cours entièrement approuvé
**Étant donné** un cours versionné avec vidéos, PDF, TP, quiz et rubriques, **quand** revue et approbation sont terminées, **alors** l'offre de cours apparaît aux étudiants affectés uniquement, avec historique de version.

### E2E-012 — Retrait de ressource
**Étant donné** une ressource publiée utilisée par une ancienne cohorte, **quand** l'auteur publie un remplacement, **alors** les accès et preuves pédagogiques antérieurs restent cohérents et la nouvelle édition utilise la nouvelle version.

### E2E-013 — Apprentissage faible débit
**Étant donné** un étudiant sur téléphone en connexion dégradée, **quand** il consulte une vidéo et bascule vers transcription ou PDF, **alors** l'apprentissage reste utilisable et les ressources téléchargeables respectent les droits.

### E2E-014 — TP avec coupure réseau
**Étant donné** un TP en cours, **quand** le réseau disparaît pendant le brouillon, **alors** le travail récupérable reste sauvegardé ; aucune « soumission réussie » ne s'affiche sans accusé serveur.

### E2E-015 — Double soumission
**Étant donné** une copie soumise, **quand** la requête est rejouée après timeout, **alors** une seule soumission logique existe avec un identifiant stable.

### E2E-016 — Correction et publication
**Étant donné** une copie déposée, **quand** enseignant corrige, modérateur valide et jury délibère si requis, **alors** étudiant voit seulement les résultats publiés, avec feedback et crédits corrects.

### E2E-017 — Jury sans quorum
**Étant donné** une réunion de jury incomplète, **quand** une publication des résultats est demandée, **alors** elle échoue ; aucun document ne prétend attester une délibération valide.

### E2E-018 — Rattrapage et compensation
**Étant donné** un règlement académique versionné, **quand** un étudiant échoue puis réussit un rattrapage, **alors** notes, crédits et décision suivent exactement ce règlement, sans compensation interdite.

### E2E-019 — Contestation de note
**Étant donné** une note publiée, **quand** un recours entraîne correction, **alors** le système crée un avenant historisé, recalcule les conséquences et préserve l'ancienne décision et le motif.

### E2E-020 — Examen national externe
**Étant donné** un étudiant béninois, **quand** il dépose une copie de diplôme national, **alors** le statut est « déposé/non vérifié » puis vérifiable par agent habilité ; aucun examen national interne ni émission d'État n'apparaît.

### E2E-021 — Refus de diplôme officiel
**Étant donné** une filière non habilitée ou une date d'autorisation expirée, **quand** un opérateur, même superadmin, réclame l'émission d'un diplôme officiel, **alors** l'API refuse et produit un audit ; une attestation interne ne peut être délivrée que si elle est légale.

### E2E-022 — Diplôme autorisé
**Étant donné** une habilitation valide, programme et parcours achevés et décision, **quand** l'émetteur habilité signe, **alors** le document sort numéroté, vérifiable, révocable et rattaché à la preuve d'émission.

### E2E-023 — Paiement Mobile Money simulé
**Étant donné** une facture, **quand** le prestataire sandbox confirme via webhook signé, **alors** un paiement, une écriture financière et un reçu cohérent sont produits ; la redirection seule ne confirme rien.

### E2E-024 — Paiement webhook dupliqué
**Étant donné** un événement de paiement déjà reçu, **quand** le webhook identique est rejoué 10 fois, **alors** aucun double crédit, duplicata facture ou double notification ne survient.

### E2E-025 — Bourse et paiement partiel
**Étant donné** un tarif configuré et une bourse accordée, **quand** un paiement partiel est reçu, **alors** solde, échéances, pièces et droits d'inscription reflètent les règles approuvées.

### E2E-026 — Entreprise vérifiée
**Étant donné** une entreprise candidate, **quand** elle fournit documents et mandataire vérifiés, **alors** elle reçoit la permission de poster des offres, mais ne voit aucun dossier étudiant non candidat.

### E2E-027 — Entreprise non vérifiée
**Étant donné** une entreprise non approuvée, **quand** elle publie une offre ou tente de voir une candidature, **alors** la demande est refusée et auditée.

### E2E-028 — Offre d'emploi et candidature
**Étant donné** une offre validée, **quand** l'étudiant postule avec CV et consentement, **alors** l'entreprise habilitée voit sa candidature figée et peut piloter entretien et décision.

### E2E-029 — Consentement révoqué
**Étant donné** un portfolio privé, **quand** l'étudiant désactive son partage, **alors** les recherches ultérieures et vues publiques cessent de le divulguer ; les obligations de conservation légales restent traitées séparément.

### E2E-030 — Stage complet
**Étant donné** un stage obligatoire, **quand** convention validée, tuteurs affectés, journaux, rapport et évaluations sont saisis, **alors** la validation académique ne produit des crédits qu'après l'instance appropriée.

### E2E-031 — Stage interrompu
**Étant donné** une convention en cours, **quand** l'entreprise signale une interruption, **alors** le workflow protège l'étudiant, suspend la validation automatique et permet un nouveau placement.

### E2E-032 — Formation entreprise
**Étant donné** une commande entreprise acceptée, **quand** plusieurs collaborateurs sont inscrits à une session, **alors** chacun n'accède qu'à son dossier, et l'entreprise voit uniquement les statistiques autorisées.

### E2E-033 — Formation courte non diplômante
**Étant donné** une formation courte créée par admin, **quand** l'apprenant finit toutes activités obligatoires, **alors** un certificat privé conforme au type autorisé est émis, jamais un diplôme LMD national non habilité.

### E2E-034 — Mémoire et soutenance
**Étant donné** un mémoire de Master, **quand** sujet, directeurs, versions, évaluations, jury et soutenance sont complétés, **alors** décision et obligations académiques sont historisées ; tout manquement empêche la validation finale.

### E2E-035 — Doctorat
**Étant donné** un parcours doctoral configuré, **quand** dossier scientifique, encadrement, comités, rapports, thèse et soutenance avancent, **alors** les jalons sont justifiés et la délivrance officielle reste sous habilitation.

### E2E-036 — Recherche éthique
**Étant donné** un projet exigeant avis d'éthique, **quand** le responsable tente de démarrer l'activité soumise à autorisation sans avis, **alors** la transition est refusée.

### E2E-037 — Bibliothèque sous licence
**Étant donné** une ressource à licence expirée, **quand** un étudiant demande le document, **alors** le système refuse la diffusion et explique les alternatives autorisées.

### E2E-038 — Support et recours
**Étant donné** une réclamation de scolarité, **quand** elle passe d'un service à l'autre, **alors** historique, délai, documents et réponse restent consultables uniquement par les acteurs autorisés.

### E2E-039 — Audit qualité
**Étant donné** une revue de programme, **quand** un auditeur recherche preuves, enseignants, syllabus, activités et décisions, **alors** il obtient un dossier vérifiable dans son périmètre sans consulter les dossiers non nécessaires.

### E2E-040 — Habilitation désactivée par région
**Étant donné** deux pays avec droits d'émission différents, **quand** le même programme est offert dans les deux, **alors** les documents officiels sont émissibles seulement dans la portée autorisée.

### E2E-041 — Révocation de rôle
**Étant donné** un enseignant dont la mission expire, **quand** il renouvelle son token et essaie de corriger, **alors** l'action est refusée immédiatement.

### E2E-042 — IDOR inter-étudiants
**Étant donné** étudiants A et B, **quand** A remplace dans l'API l'ID d'un relevé de B, **alors** l'API refuse sans divulguer les métadonnées de B.

### E2E-043 — Fuite inter-entreprises
**Étant donné** entreprises X et Y, **quand** X devine un identifiant de candidature soumise à Y, **alors** aucune donnée Y n'est accessible.

### E2E-044 — Facteur de charge
**Étant donné** 1 000 utilisateurs virtuels sur jeu pilote réaliste, **quand** admissions, lectures, uploads et consultations simultanés ont lieu, **alors** les temps, erreurs et ressources sont mesurés contre les hypothèses, avec rapport et corrections.

### E2E-045 — Sauvegarde et restauration
**Étant donné** un système peuplé, **quand** une restauration sur environnement isolé est effectuée, **alors** DB, objets, documents, signatures, audit et outbox restent cohérents dans les objectifs RPO/RTO mesurés.

### E2E-046 — Déploiement multi-pays sans code
**Étant donné** une nouvelle implantation fictive, **quand** administrateur configure locale, calendrier, frais, cursus et workflows, **alors** l'ouverture du catalogue et l'admission test fonctionnent sans nouveau build.

### E2E-047 — Assistant IA halluciné
**Étant donné** une question sans source approuvée, **quand** l'assistant répond, **alors** il reconnaît l'insuffisance des sources ; aucune note ou décision n'est modifiée.

### E2E-048 — Traduction incomplète
**Étant donné** une interface anglaise avec une chaîne manquante, **quand** l'écran est ouvert, **alors** une langue de repli explicite et un contrôle qualité détectent le manque sans casser l'opération.

### E2E-049 — Double approbation interdite
**Étant donné** un auteur de cours et workflow exigeant revue indépendante, **quand** il essaie d'approuver seul son cours, **alors** la transition est refusée, même en modifiant directement la requête HTTP.

### E2E-050 — Transfert entre programmes
**Étant donné** des acquis sur programme V1, **quand** une commission accepte une équivalence pour V2, **alors** les crédits transférés sont justifiés, non dupliqués et liés à décision versionnée.

### E2E-051 — Suppression et archivage légaux
**Étant donné** une demande d'effacement en présence d'obligations de conservation, **quand** le DPO traite la demande, **alors** effacement des données éligibles, restrictions de traitement et conservation justifiée sont distingués.

### E2E-052 — Évaluation à fuseaux multiples
**Étant donné** deux étudiants dans des fuseaux différents, **quand** une session est planifiée, **alors** heure locale affichée correctement, dates limites calculées en UTC et aménagements respectés.

### E2E-053 — Concurrence de publication de notes
**Étant donné** deux correcteurs ouvrant même dossier, **quand** les deux modifient simultanément, **alors** un conflit de version empêche l'écrasement non détecté.

### E2E-054 — Changement de barème après inscription
**Étant donné** des notes calculées avec règles 2027, **quand** barème 2029 publié pour nouvelles cohortes, **alors** aucun recalcul rétroactif n'est appliqué sans procédure de transition.

### E2E-055 — Retour d'expérience utilisateur
**Étant donné** un étudiant utilisant lecteur écran et clavier, **quand** il candidate, suit le cours et dépose un devoir, **alors** tous les contrôles nécessaires restent accessibles et compréhensibles.

## 4. Matrice de couverture requise

Faire correspondre chaque `REQ-*` à `TST-*` dans `docs/MATRICE_EXIGENCES.csv`, puis au fichier de test exécutable, à la version du code et à sa preuve. Pour chaque exigence, traiter explicitement les cas négatifs (données invalides, état invalide, rôle invalide, périmètre invalide et fournisseur indisponible) et vérifier les mutations en base. Aucun test `skip` ne compte comme preuve.

## 5. Rapport de recette finale

- Nombre total exigences `MUST` : compter depuis CSV, **pas depuis une estimation**.
- Nombre `VERIFIE` : identifier preuves reproductibles par test et commit.
- Bloqueurs externes : identifiés séparément, interdiction d'affirmer l'activation réelle.
- Conformité réglementaire : preuves d'habilitation si titre émis ; sinon refus testé.
- Scénarios E2E-001 à E2E-055 : PASS obligatoires selon capacités opérationnelles en sandbox ; fournisseur réel conditionné à contrat.
- Sécurité : absence de faille critique/haute non traitée ; tests d'isolation.
- Accessibilité et performance : rapports mesurés, anomalies classées.
- Restauration : exercice documenté.
- Manuels : utilisateur, administrateur, enseignement, entreprise, exploitation et sécurité.

**Conclusion de recette :** ne marquer « accepté » qu'après audit de chaque porte et preuve d'exécution réelle ; une checklist cochée sans test ne suffit pas.
