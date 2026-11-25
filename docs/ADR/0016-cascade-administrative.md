# ADR-0016 — Cascade administrative stricte

Date : 25 novembre 2026. Statut : accepté (décision du propriétaire), complète ADR-0011.

## Décision

On ne crée et on ne nomme que là où l'on est **directement** nommé (attribution sur cette portée même) ; les
niveaux supérieurs gardent par héritage la consultation et le suivi, mais ne créent plus en dessous.

| Niveau | Crée | Nomme |
|---|---|---|
| Super-administrateur (plateforme) | pays | administrateurs pays et fonctions clés des pays, équipe de plateforme |
| Administrateur pays | établissements (et régions) | recteur et fonctions clés de chaque établissement |
| Recteur / administrateur d'établissement | facultés, campus | doyens, équipe de l'établissement (scolarité, finances, documents…) |
| Doyen | départements | chefs de département, équipe de la faculté |
| Chef de département | filières, spécialités, formations, matières | enseignants, équipe du département |

Mise en œuvre : `unoa.cascade_level` (déduit de la structure : une unité sous un établissement est une
faculté, sous une unité un département), `unoa.holds_here`, `unoa.may_create` (créations des studios
territoires, structures et catalogue), `unoa.cascade_allows` (dans `grant_role` et `invite_account`).
Menus « Créer », assistants et listes de rôles nommables suivent la même règle.

## Conséquences

Un super-administrateur qui veut agir plus bas doit être nommé à ce niveau (traçable). Les types de portées
restent configurables ; seule la position dans l'arbre compte.
