# REGISTRE DES BLOCAGES ET DÉPENDANCES EXTERNES

Ne jamais déclarer `VERIFIE_PRODUCTION` une fonctionnalité qui nécessite une donnée externe absente. Implémenter et tester sa capacité sandbox ; laisser verrouillée l'activation réelle.

| ID | Dépendance externe | Stratégie sans décision du porteur | État initial |
|---|---|---|---|
| EXT-001 | Autorisations création et ouverture de formations par pays | Moteur d'habilitation, refus de diplomation non autorisée | À FOURNIR |
| EXT-002 | Identité juridique, marque finale, adresses et signataires | Métadonnées institutionnelles configurables ; pas de faux sceau | À FOURNIR |
| EXT-003 | Contrats prestataires paiements réels | Interface provider et sandbox, paiements production désactivés | À FOURNIR |
| EXT-004 | Clés email/SMS/push/cloud/vidéo/IA production | Adapters, secrets vides, fonctionnalités sandbox | À FOURNIR |
| EXT-005 | Domaine, DNS et hébergement production | IaC, runbook et environnement staging | À FOURNIR |
| EXT-006 | Programmes, syllabus et contenus approuvés | Constructeur complet, bibliothèque vide | À FOURNIR PAR RESPONSABLES ACADÉMIQUES |
| EXT-007 | Diplômes, signatures, modèles officiels légalement valides | Templates configurables, émission officielle bloquée | À FOURNIR |
| EXT-008 | Conventions de stage et partenariats réels | Workflow et modèles préparatoires, pas de signature inventée | À FOURNIR |
| EXT-009 | Décisions institutionnelles et composition des jurys | Gestion complète avec instances réelles à renseigner | À FOURNIR |
| EXT-010 | Éligibilité aux examens nationaux béninois | Statut externe documentaire, aucune présomption d'éligibilité | À VÉRIFIER OFFICIELLEMENT |
| EXT-011 | Licences commerciales des bibliothèques et laboratoires | Catalogue et adaptateurs, ressources non publiques inaccessibles | À FOURNIR |
| EXT-012 | Conseil juridique multi-pays, rétention et transferts | Moteur territorial + politique conservatrice en attente | À VÉRIFIER |

**Pour toute ligne** : ajouter responsable, date, preuve, composant concerné, résultat sandbox et conditions de sortie. Ne pas bloquer l'ensemble du développement à cause d'un seul service externe.

19 novembre 2026 — EXT-005. Le tableau de bord Vercel demande une connexion. Le dépôt documente le répertoire racine, la branche et le contrôle HTTP après déploiement.

19 novembre 2026 — EXT-005. Le blocage d’accès au tableau de bord Vercel est levé.
Le site web est déployé depuis master. L’hébergement PostgreSQL institutionnel
et les identifiants OIDC restent à fournir pour la recette intégrée.

19 novembre 2026 — Connexion institutionnelle. La recette avec PostgreSQL et
un fournisseur OIDC de test précède le raccordement de production. Restent à
renseigner le fournisseur choisi, le client OIDC, le niveau MFA vérifié et les
identifiants du rôle de service PostgreSQL.
