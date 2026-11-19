// Fixtures réservées à la démonstration. Les identifiants TDR sont ceux du catalogue normatif.
const courses=[
 {title:'Analyse et visualisation de données',category:'Sciences des données',icon:'ChartNoAxesCombined',units:['Lire un jeu de données','Préparer les observations','Comparer des distributions','Choisir une représentation','Interpréter un graphique'],start:3,lesson:'Pour comparer la répartition d’une variable quantitative, regroupez les observations en classes puis représentez leur fréquence par un histogramme.'},
 {title:'Architecture des bases de données',category:'Informatique',icon:'Database',units:['Identifier les entités','Définir les relations','Construire un schéma','Vérifier les contraintes'],start:1,lesson:'Une clé primaire identifie une ligne. Une clé étrangère relie deux tables en faisant référence à un identifiant existant.'},
 {title:'Programmation avec Python',category:'Développement',icon:'CodeXml',units:['Variables et types','Conditions','Boucles','Fonctions','Projet pratique'],start:2,lesson:'Une boucle parcourt les éléments d’une collection. Une fonction rassemble une opération réutilisable avec des paramètres et un résultat.'}
];
const events=[
 ['20','NOV','Atelier de visualisation','09 h 00 – 10 h 30','Classe virtuelle','Préparer un exemple de série statistique et relire la séquence sur les distributions.'],
 ['23','NOV','Remise du modèle relationnel','Avant 18 h 00','Travail à rendre','Décrire deux entités, leurs clés et la relation qui les relie.'],
 ['25','NOV','Tutorat de programmation','14 h 00 – 15 h 00','Tutorat','Préparer une question sur les boucles ou les fonctions.']
];
const programs=[
 ['Licence','Sciences des données et IA appliquée','180 crédits','Habilitation en instruction'],
 ['Master','Finance digitale et inclusion financière','120 crédits','Habilitation simulée'],
 ['Formation courte','Cybersécurité et conformité','15 crédits','Certificat non diplômant'],
 ['Doctorat','Systèmes agroécologiques et climat','École doctorale','Habilitation simulée']
];
const roles=[
 ['public','Portail public','Globe','CAT CMS SHORT','Consulter les formations','catalogue'],
 ['candidate','Candidature','FolderOpen','ADM','Suivre mes dossiers','dossiers'],
 ['student','Espace étudiant','GraduationCap','LMS LIVE LAB ASS SIS CAMP CAR','Ouvrir mon tableau de bord','accueil'],
 ['teacher','Enseignement et faculté','BookOpen','TEA LMS ASS ORG','Préparer une séquence','Séquence pédagogique','Brouillon','En relecture'],
 ['jury','Jury et délibérations','ClipboardList','GRD EXN','Préparer un procès-verbal','Procès-verbal de jury','En préparation','Soumis pour relecture'],
 ['scolarite','Scolarité et finances','Landmark','ADM SIS FIN CRED','Instruire les candidatures','instruction'],
 ['enterprise','Campus-Entreprise et alumni','Briefcase','ENT JOB STG B2B ALUM','Préparer une offre de stage','Offre de stage','Brouillon','En validation'],
 ['research','Recherche et bibliothèque','Microscope','PHD MEM RND LIB','Soumettre une notice','Notice bibliographique','Brouillon','En relecture'],
 ['rectorat','Rectorat et qualité','School','GOV QMS DPO ANA','Ouvrir un plan correctif','Plan correctif','Proposé','En revue'],
 ['support','Assistance et recours','LifeBuoy','SUP AI NOT','Ouvrir une demande','Demande de support','Brouillon','Transmise'],
 ['admin','Administration territoriale','Settings','TEN CFG IAM CORE I18N A11Y DOC WF INTG SEC OPS','Proposer une règle','Règle de configuration','Brouillon','En validation']
];
