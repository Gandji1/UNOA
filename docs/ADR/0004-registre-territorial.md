# ADR-0004 — Hiérarchie territoriale déclarée en base

## Statut

Acceptée le 19 novembre 2026. Lot 005.

## Contexte

Les TdR interdisent toute organisation régionale figée dans le code et exigent
des territoires, juridictions, établissements et centres distincts, avec des
hiérarchies libres, des règles régionales contradictoires possibles et une
isolation stricte. Le socle du lot 002 n'offrait qu'un arbre de portées typées
sans règle de composition ni attribut régional.

## Décision

1. La nature d'un type de portée est une colonne contrainte ; la composition de
   l'arbre est une table de règles `(type, type parent)` alimentée par
   l'administration habilitée. Le code ne connaît aucun niveau territorial.
2. Les attributs régionaux sont portés par la portée elle-même et validés contre
   les référentiels du moteur : base IANA de PostgreSQL pour les fuseaux, données
   ICU du moteur JavaScript pour les monnaies et les formats régionaux.
3. Les règles structurelles sont tenues par des déclencheurs PostgreSQL et non
   seulement par la couche web, afin qu'un accès direct à la base ne puisse pas
   créer une hiérarchie non déclarée ni un faux établissement.
4. La présence n'est revalidée que lorsqu'elle change, et la fermeture d'une
   portée exige la fermeture préalable de ses portées filles.

## Conséquences

Les bases déjà migrées conservent leurs types avec la nature « territoire » et
sans règle de hiérarchie : l'administration doit les revoir avant de créer de
nouvelles portées, ce que la recette de migration vérifie explicitement. Les
futurs modules académiques s'appuient sur ces portées sans redéfinir de notion
régionale. Les rattachements multiples préparent la gouvernance multi-pays sans
anticiper aucune autorisation réelle.
