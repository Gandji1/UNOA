# JOURNAL D'IMPLÉMENTATION

**État initial :** spécifications rédigées ; aucun logiciel fourni dans ce dossier et aucun test applicatif exécuté. Les éléments ci-dessous sont des entrées à renseigner par Claude Code pendant la réalisation.

## Template d'entrée

```markdown
### 2026-..-.. — LOT-... — <titre>
- TDR relus : <sections et IDs>
- Audit de l'existant : <constat>
- Exigences concernées : <REQ-..>
- Entités / migrations : <liste>
- Interfaces / APIs / événements : <liste>
- Vérifications exécutées : <commandes + PASS/FAIL>
- Preuves : <fichiers/logs/snapshots + commit>
- Sécurité/régions/accessibilité : <preuves>
- Décisions et ADR : <liens>
- Écarts / bugs / blocages : <liens>
- Gate Done : PASS/FAIL
```

## 19 novembre 2026 — Lot 001

Voir LOT_001.md. Compilation Next.js, cinq tests et contrôles HTTP locaux réussis. Aucune migration. Recette de production en attente.

## 19 novembre 2026 — Lot 002

- PostgreSQL 18.6. Deux migrations testées sur base vierge et peuplée, en concurrence et en réexécution. Échec transactionnel et contrôle des empreintes vérifiés.
- Deux territoires fictifs. Droits atomiques et refus transversal, descendant sans délégation explicite, expiration, révocation et compte désactivé vérifiés.
- Modification, suppression et vidage du journal d’audit refusés par PostgreSQL.
- Le site public reste opérationnel sans configuration PostgreSQL. Aucune migration appliquée à une base institutionnelle.
- Le compte applicatif, le raccordement OIDC et les écrans protégés sont à intégrer. Les exigences restent en cours.

## 19 novembre 2026 — Lot 003

- Connexion, rappel OIDC, espace connecté et déconnexion via Next.js. Routes `/api/v1/me` et `/api/v1/access/check`.
- Migration 0003, sessions à empreinte, compte de service restreint. Révocation du droit ou de la session visible sur la requête suivante.
- Tests HTTP sur PostgreSQL 18.6 et fournisseur protocolaire de recette. Voir LOT_003.md et ADR-0003.
- Fournisseur institutionnel et secret à configurer avant activation. Récupération et gestion administrative des sessions restent à traiter.

## 19 novembre 2026 — Lot 004

- Migration 0004 et studio « Paramètres et versions » pour les portées autorisées. Catalogue typé, héritage, justification, prévisualisation, revue distincte et publication datée.
- Écritures sérialisées par clé. Toute publication enregistre un événement et une trace d’audit dans PostgreSQL.
- La recette HTTP sur PostgreSQL couvre les variantes Alpha et Bêta, la provenance, les refus et la concurrence.
- L’activation du studio institutionnel dépend du raccordement OIDC et PostgreSQL mentionné au lot 003. Le moteur légal par juridiction, les snapshots et les transferts de configurations restent ouverts.
