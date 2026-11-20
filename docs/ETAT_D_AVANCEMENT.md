# État du développement

## 19 novembre 2026

- Lot 001. Accueil et sondes web publiés et contrôlés sur `https://unoa-web.vercel.app`.
- Lot 002. Migrations PostgreSQL, structure des portées, droits par portée et journal d’audit. Recette PostgreSQL et publication de la version web depuis master.
- Lot 003. Connexion institutionnelle, session révocable et vérification HTTP des droits. L’entrée « Mon espace » indique l’état de connexion. Le fournisseur et la base institutionnels conditionnent son activation.

- Lot 004. Catalogue typé, consultation par portée et date, prévisualisation
  puis publication programmée avec contrôle par un autre compte. Voir
  [la fiche de lot](LOT_004.md). Le studio s’ouvre avec les habilitations
  et la connexion institutionnelles.

- Lot 005. Registre territorial : natures de portée, hiérarchie déclarée en base,
  fuseaux, monnaies et formats régionaux vérifiés contre les référentiels du
  moteur, désignations traduites, fenêtres de présence et rattachements multiples
  des établissements. Voir [la fiche de lot](LOT_005.md) et
  [l’ADR](ADR/0004-registre-territorial.md). Le studio des territoires s’ouvre
  avec les habilitations et la connexion institutionnelles.

## 20 novembre 2026

- Lot 006. Base `unoa` sur Neon à Francfort, PostgreSQL 18.7. Migrations
  0001 à 0005 et droits du rôle web vérifiés dans les branches `recette`
  et `production`. Production vierge. La connexion du rôle et le fournisseur
  d’identité sont à activer avant la validation applicative sur Neon.
  [Contrôles et limites de la recette](LOT_006.md).
