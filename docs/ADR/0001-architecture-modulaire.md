# ADR-0001 — Architecture modulaire et stratégie de régionalisation

**Statut :** proposée comme référence technique, à confirmer à l'initialisation du dépôt.

## Contexte
UNOA exige de nombreux domaines interdépendants, un moteur de configuration par région, des règles académiques et des documents officiels audités. Des microservices nombreux dès le départ multiplieraient les défaillances inter-domaines.

## Décision
Utiliser un monolithe modulaire structuré par domaines avec frontières strictes, PostgreSQL, web Next.js, API NestJS, worker asynchrone, bus d'événements fiable via outbox, stockage objet, contrats OpenAPI. Isoler certains composants gourmands (vidéo, lab, recherche IA) derrière interfaces.

## Règles
Pas de domaine par pays, pas de cours dans le code, pas de manipulation directe des données métiers d'un module par un autre, pas de dépendance inverse domaine→UI. Les politiques juridiques limitantes s'appliquent après résolution de configuration. Révision de cette ADR possible avec benchmark et plan de migration.

## Conséquences
Transactions académiques plus faciles, coûts d'exploitation initialement réduits, obligation de tests de séparation et de contrats, capacité de découpage ultérieur.
