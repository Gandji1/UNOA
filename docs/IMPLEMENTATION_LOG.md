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
