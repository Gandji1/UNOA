# REGISTRE DES DÉCISIONS — DÉFAUTS RÉVERSIBLES

| ID | Décision par défaut | Motif | Statut | Impact |
|---|---|---|---|---|
| DEC-001 | Monorepo TypeScript, Next.js/NestJS/PostgreSQL, versions LTS vérifiées | Écosystème interopérable | RETENU_SOUS_ADR | Technique |
| DEC-002 | Monolithe modulaire + workers, connecteurs dédiés au besoin | Maintenabilité initiale | RETENU_SOUS_ADR | Architecture |
| DEC-003 | Aucune filière/cours/faculté en production à l'installation | Zéro contenu en dur | OBLIGATOIRE | Données |
| DEC-004 | Bénin pays pilote en **configuration**, non exception codée | Extensibilité régionale | OBLIGATOIRE | Région |
| DEC-005 | Français comme langue UI initiale par configuration, traductions extensibles | Démarrage pilotable | RÉVERSIBLE | UX |
| DEC-006 | Tous les titres officiellement réglementés désactivés sans habilitation validée | Sécurité juridique | OBLIGATOIRE | Diplômes |
| DEC-007 | Fournisseurs payants : adaptateurs et sandbox sans activation facturable | Pas de contrat implicite | OBLIGATOIRE | Intégration |
| DEC-008 | Nombres d'années, barèmes, crédits, règles et calendriers non préremplis | Configurabilité | OBLIGATOIRE | Académie |
| DEC-009 | Objectifs de charge/continuité du TDR comme hypothèses à tester | Revue SRE nécessaire | RÉVERSIBLE | Ops |
| DEC-010 | Aucune IA décisionnelle autonome pour diplômes, notes finales, admission | Contrôle humain | OBLIGATOIRE | IA |

**Mode d'ajout :** `DEC-011+ | date | problème | alternatives | choix | raisons | risques | impact | ADR associée | réversibilité`. Les décisions qui engagent juridiquement ou financièrement la personne morale demeurent `À_VALIDER_EXTERNE` sans empêcher les développements indépendants.

| DEC-011 | 2026-11-20 · Composantes académiques = portées `academic_unit` ; transfert par unité successeur | Pas de hiérarchie parallèle, droits et configuration hérités | RETENU | ORG | ADR-0005 | Réversible par migration additive |
| DEC-012 | 2026-11-20 · Ouverture des candidatures conditionnée à une pièce vérifiée par un second compte | Capacité ≠ habilitation | OBLIGATOIRE | CAT/ADM | ADR-0005 | — |
| DEC-013 | 2026-11-20 · Nomination par identifiant de compte en attendant l'annuaire IAM | Pas de profil personne encore | RÉVERSIBLE | ORG | LOT_007 | Remplacer par sélection dans l'annuaire |
