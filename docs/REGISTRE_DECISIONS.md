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
| DEC-014 | 2026-11-20 · Site public = donnée par portée, résolu par l'hôte ; textes versionnés publiés par un tiers | §1.3, multi-établissement | OBLIGATOIRE | CMS | ADR-0006 | — |
| DEC-015 | 2026-11-20 · Libellés d'interface en français dans le code jusqu'au module I18N | Distinction interface / contenu | RÉVERSIBLE | I18N | ADR-0006 | Externaliser les libellés |

| 2026-11-23 | Désactivation du code TOTP du compte administrateur à la demande du propriétaire | Écart temporaire à la MFA des rôles sensibles, journalisé (ADR-0010) | À rétablir avec OIDC |

| 2026-11-23 | Hiérarchie super-admin → admin pays → admin établissement → doyen → chef de département → enseignant | Choix du propriétaire, conforme aux portées configurables (ADR-0011) | Appliqué |
| 2026-11-23 | Mode développement (mot de passe « 1 », sans blocage) jusqu’à la fin du développement | Décision du propriétaire ; verrous à rétablir avant ouverture | En vigueur |
| 2026-11-25 | Règle de notation en objet versionné dédié (jeu complet daté) plutôt que clés grading.* isolées | Cohérence d'une délibération, rattachement de chaque décision à la règle appliquée (ADR-0012) | Appliqué |
| 2026-11-25 | Paiement crédité seulement par événement signé du prestataire ; bac à sable signé ; prestataires réels bloqués faute de contrat | ADR-0013 | Appliqué |
| 2026-11-25 | Registre unique des documents délivrés (étudiants et formations courtes), vérificateur à divulgation minimale | ADR-0014 | Appliqué |
| 2026-11-25 | Cascade stricte : chaque niveau crée le niveau inférieur et en nomme le responsable, les niveaux supérieurs suivent | Décision du propriétaire (ADR-0016) | Appliqué |
