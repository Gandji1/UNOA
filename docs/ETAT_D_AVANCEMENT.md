# État du développement

## 19 novembre 2026

- Lot 001. Accueil et sondes web publiés et contrôlés sur `https://unoa-web.vercel.app`.
- Lot 002. Migrations PostgreSQL, structure des portées, droits par portée et journal d’audit. Recette PostgreSQL et publication de la version web depuis master.
- Lot 003. Connexion institutionnelle, session révocable et vérification HTTP des droits. L’entrée « Mon espace » indique l’état de connexion. Le fournisseur et la base institutionnels conditionnent son activation.

- Lot 004. Catalogue typé, consultation par portée et date, prévisualisation
  puis publication programmée avec contrôle par un autre compte. Voir
  [la fiche de lot](lots/LOT_004.md). Le studio s’ouvre avec les habilitations
  et la connexion institutionnelles.

- Lot 005. Registre territorial : natures de portée, hiérarchie déclarée en base,
  fuseaux, monnaies et formats régionaux vérifiés contre les référentiels du
  moteur, désignations traduites, fenêtres de présence et rattachements multiples
  des établissements. Voir [la fiche de lot](lots/LOT_005.md) et
  [l’ADR](ADR/0004-registre-territorial.md). Le studio des territoires s’ouvre
  avec les habilitations et la connexion institutionnelles.

## 20 novembre 2026

- Lot 006. Base `unoa` sur Neon à Francfort, PostgreSQL 18.7. Migrations
  0001 à 0005 et droits du rôle web vérifiés dans les branches `recette`
  et `production`. Production vierge. La connexion du rôle et le fournisseur
  d’identité sont à activer avant la validation applicative sur Neon.
  [Contrôles et limites de la recette](lots/LOT_006.md).

- Lot 007. Structures académiques et catalogue : composantes proposées puis
  validées par une autre personne, postes et nominations datés, capacités,
  fermeture, fusion et transfert avec filiation ; taxonomie libre, programmes,
  versions, périodes, UE, cours mutualisés, options, prérequis sans cycle,
  compétences, stages et mémoires, revue, publication immuable, équivalences,
  simulation et contrôle réglementaire avant candidatures. Catalogue public et
  organigramme public. [Fiche](lots/LOT_007.md), [ADR-0005](ADR/0005-structures-et-catalogue.md).

- Lot 008. Studio de cours (syllabus, modules, leçons vidéo/audio/pages/documents/activités, revue à trois
  attestations, versions immuables, variantes, export/import), offres par promotion, parcours séquentiel ou
  conditionnel, progression, notes, forum modéré, échéances, séances de visioconférence planifiées par
  l'enseignant avec lien signé, consentement d'enregistrement, présences, replays et notifications.
  [Fiche](lots/LOT_008.md). Fournisseur de visioconférence réel à contractualiser (EXT-004).

- Lot 009. Audit et restructuration du code ; aucun texte institutionnel dans le code ; sites publics
  par établissement résolus par nom d'hôte, textes versionnés et publiés par un tiers, données publiques
  isolées par site. [Fiche](lots/LOT_009.md), [architecture](ARCHITECTURE.md), [ADR-0006](ADR/0006-structure-et-sites.md).

- Lot 010. Admissions : campagnes par version publiée et autorisée, formulaire, pièces et grille définis
  sans code, espace candidat (brouillon, pièces contrôlées, complétude, accusé), instruction administrative
  et académique séparées, compléments historisés, convocations, décisions motivées, acceptation, recours
  tranché par un tiers, tableau de bord. [Fiche](lots/LOT_010.md). Antivirus, stockage objet et envoi
  courriel/SMS : EXT-004.

- Lot 011. Administration des accès : amorçage du premier administrateur, console `/administration`,
  rôles composés par l'administration, attributions justifiées, invitations, délégations, comptes,
  sessions et journal d'audit ; création de compte par site. [Fiche](lots/LOT_011.md),
  [ADR-0007](ADR/0007-administration-des-acces.md), [plan des lots](PLAN_DES_LOTS.md).

- Lot 012. File durable (outbox, worker, rejeu) et notifications multicanal : modèles par portée et
  langue, consentements, préférences, courriel/SMS par adaptateurs, preuve de livraison, export.
  [Fiche](lots/LOT_012.md), [ADR-0008](ADR/0008-file-durable-et-notifications.md), [audit des écarts](AUDIT_ECARTS.md).
