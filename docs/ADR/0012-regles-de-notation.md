# ADR-0012 — Règles de notation : objet versionné dédié plutôt que clés de paramétrage isolées

Date : 25 novembre 2026. Statut : accepté. Exigences : GRD-001 à 003, GRD-006, GRD-015 ; PARAMETRAGE_REGIONAL (grading.*).

## Contexte

PARAMETRAGE_REGIONAL cite les paramètres `grading.scale`, `.rounding`, `.compensation`, `.jury_quorum`,
`.resit_policy`. Le moteur de paramétrage générique (lot 004) publie des valeurs clé par clé. Or une
délibération doit s'appuyer sur un **jeu cohérent** de règles en vigueur à une date : échelle, seuils,
arrondi, compensation et plancher, seconde session, quorum, délai de contestation. Publier ces clés
séparément permettrait des combinaisons incohérentes (seuil supérieur à une nouvelle échelle) et rendrait
la décision difficile à rattacher à « la règle appliquée ».

## Décision

- Table `grading_policy` : un enregistrement = un jeu complet, daté (`effective_from`), rédigé par une
  personne et publié par une autre, immuable une fois publié (retrait seulement) ; validation de cohérence
  côté serveur (`@unoa/domain/grading`) et contraintes SQL.
- Portée : n'importe quel niveau (pays, établissement, composante), éventuellement limitée à une version
  de formation. Résolution `unoa.grading_policy_for(cohorte, date)` : règle de la formation, sinon la plus
  proche au-dessus de la composante propriétaire de la cohorte (héritage contrôlé).
- Chaque jury retient la règle en vigueur à sa constitution ; chaque décision enregistre la règle utilisée ;
  le procès-verbal la cite. Aucune valeur n'est codée par pays.

## Conséquences

Les clés `grading.*` du catalogue de paramètres ne sont pas utilisées par le moteur de notes ; la saisie
se fait dans « Notes et jurys ». Deux règles fictives différentes (barème sur 20 avec compensation,
barème sur 100 sans compensation) sont testées dans `packages/domain/test/grading.test.mjs`, et l'héritage
pays → formation dans la recette HTTP.
