# CLAUDE CODE — MANDAT PERMANENT UNOA

> **CETTE INSTRUCTION EST OBLIGATOIRE À CHAQUE SESSION, À CHAQUE TÂCHE ET AVANT CHAQUE IMPLÉMENTATION.** Les TDR sont la source de vérité du projet. Leur relecture précède toute modification du code, toute migration, toute intégration ou toute recette.

## 0. Démarrage obligatoire

1. Lire **entièrement** `TDR_UNOA_Cahier_des_Charges_Claude_Code.md` au démarrage de la mission. À chaque reprise de contexte, relire au minimum sections 1–3, 16–24 et les modules concernés ; pour chaque lot, effectuer une nouvelle recherche dans **tout le TDR** des exigences affectées.
2. Lire `docs/00_PROJET_INSTITUTIONNEL_REFERENCE.md`, `docs/MATRICE_EXIGENCES.csv`, `docs/PLAN_EXECUTION_AUTONOME.md`, `docs/CONTRATS_API_DONNEES.md`, `docs/PARAMETRAGE_REGIONAL.md`, `docs/MATRICE_ACCES.md`, `docs/PLAN_TESTS_ET_RECETTE.md`, `docs/CARTOGRAPHIE_ECRANS.md`, `docs/ARCHITECTURE.md` (carte du code) ; vérifier les ADR existantes et les fiches `docs/lots/`.
3. Inventorier le dépôt et les fonctionnalités déjà implémentées ; ne jamais détruire l'existant valide par défaut.
4. Lire `docs/IMPLEMENTATION_LOG.md`, `docs/REGISTRE_DECISIONS.md` et `docs/REGISTRE_BLOCAGES.md`. La matrice d'exigences constitue le backlog normatif : chaque ligne doit aboutir à une preuve.
5. **Avant le code :** écrire la fiche de lot (IDs `REQ-*`, dépendances, écrans, entités, droits, États/événements, tests et risques). Préparer tests positifs et négatifs. Après seulement, coder.

## 1. Règles d'exécution sans exception

- **Pas de contenu académique prédéfini en production.** Les facultés, filières, programmes, cours, barèmes, crédits, régions et politiques sont des objets configurables par l'administration habilitée, pas des tableaux constants dans le code. Gabarits vides autorisés, données fictives en sandbox seulement.
- **Couverture intégrale** : aucun module, écran, permission, workflow, API, notification ou cas d'erreur obligatoire ne peut être supprimé silencieusement. Aucun `TODO`, `placeholder`, faux API, élément visuel inactif ou test `skip` ne compte comme livré.
- **Régionalisation native** : appliquer la hiérarchie des portées, l'héritage contrôlé, le versionnage, les dates d'effet, l'audit, l'isolation et les contraintes légales. Tester avec deux régions fictives aux règles différentes.
- **Sécurité** : autorisation côté serveur pour chaque action ; isolation inter-entités ; migration sûre ; secrets hors code ; MFA pour rôles sensibles ; audit des décisions ; prudence sur les données financières et les titres.
- **Diplômes et examens d'État** : aucun diplôme national « fabriqué » et aucune organisation d'examen national ; module de suivi externe documentaire uniquement. Habilitations contrôlées, production verrouillée en l'absence de preuve.
- **Environnement** : distinguer mock de laboratoire, sandbox réellement testée et fournisseur de production activé. Ne jamais prétendre qu'un adaptateur fictif prouve une intégration de production.
- **Traçabilité** : pour chaque `REQ-...`, renseigner `statut`, `preuve`, `commit` et les tests ; mettre à jour log et ADR le cas échéant.
- **Définition de Done** : interface+API+DB+migrations+droits+validation+états/erreurs+test+documentation+accessibilité+logs+preuve ; si l'une manque, état `EN_COURS` et non `VERIFIE`.

## 2. Boucle de travail imposée — répéter jusqu'à la couverture complète

```text
RELECTURE TDR (globale + sections du lot)
        ↓
AUDIT EXIGENCES / CODE / DEPENDANCES
        ↓
FICHE LOT + TESTS + MODELE + RÈGLES
        ↓
IMPLEMENTATION INTEGRALE DU LOT
        ↓
LINT / TYPES / UNIT / INTEGRATION / E2E / SEC / A11Y
        ↓
TEST UTILISATEUR PAR ROLE ET PAR REGION
        ↓
PREUVES, MATRICE, ADR, JOURNAL, BLOCAGES
        ↓
NON-REGRESSION ET PROCHAIN LOT
```

### Contrôles avant de dire « terminé »

- `python automation/verifier_tracabilite.py` (toutes les exigences uniques et correctement suivies ; en mode `--gate-release` exiger couverture intégrale) ;
- scripts de test définis dans `package.json` du futur dépôt (`lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `test:security`, `test:a11y`, `build`) ;
- revue manuelle des parcours critiques ;
- preuves réelles dans `docs/IMPLEMENTATION_LOG.md` ;
- `git status` propre ou état consigné, migrations reproductibles ;
- aucun bug critique ou haute sévérité accepté silencieusement.

## 3. Décisions autonomes et limites légitimes

Ne pose pas de questions pour des choix techniques réversibles : choisis le défaut le plus maintenable, consigne l'ADR et continue. Ne demande pas non plus d'exemples de filières à coder : le produit doit fonctionner sur des formations **créées par l'administrateur**. En revanche, pas de choix autonome qui engage de l'argent réel, signe des conventions, expose des données ou invente une habilitation. Pour une clé prestataire, un domaine, une identité légale, une décision réglementaire ou une signature indisponible : créer l'adaptateur, tester en sandbox, noter précisément `BLOCKED_EXTERNAL` et continuer sur les parties indépendantes.

## 4. Rapport de fin de lot — format obligatoire

```text
Lot : <identifiant>
Références TDR relues : <sections et REQ>
Exigences concernées : <REQ-...>
Implémenté : <routes UI, API, schémas, workflows>
Tests et commandes exécutés : <résultats et liens preuves>
Sécurité et isolation : <résultat>
Configuration régionale testée : <régions fictives et overrides>
Différences par rapport au TDR : <néant ou ADR>
Non terminé / blocage externe : <précis, jamais masqué>
Matrice/log/ADR mis à jour : <oui/non>
Critère Done : <PASS/FAIL>
```

## 5. Source de vérité et prévention de dérive

Lire le TDR avant chaque changement, puis **chercher l'ID et les termes dans le dépôt avant de coder**. Si une fonctionnalité existe déjà, l'étendre plutôt que la doubler. Si deux implémentations se contredisent, réconcilier le modèle commun et écrire un test de régression. Toute décision alternative change le code, le TDR ou une ADR avec justification — jamais secrètement.

## 6. Clause de réception

Le projet ne peut pas être présenté « réalisé de A à Z » tant qu'une exigence `MUST` reste non vérifiée, un parcours critique échoue, ou une condition de sécurité/diplomation n'est pas satisfaite. Les dépendances humaines et légales non fournies sont explicitement séparées du niveau de complétude du **logiciel**. La mission ne s'arrête pas à une démonstration graphique.
