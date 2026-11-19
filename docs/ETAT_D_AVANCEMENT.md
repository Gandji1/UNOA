# État du développement

## 19 novembre 2026

Le lot 001 a publié l’accueil et les deux sondes web dans le projet Vercel
unoa-web. L’accueil, le lien Formations et les sondes ont été contrôlés sur
`https://unoa-web.vercel.app`. Vercel suit la branche master pour la production.

Le lot 002 apporte les migrations PostgreSQL, une structure de portées
configurable, les premiers contrôles d’autorisations par portée et un journal
d’audit en ajout seul. La recette utilise deux territoires fictifs et une base
éphémère. Voir [la fiche de lot](LOT_002.md) et le journal d’implémentation.
Les exigences concernées restent en cours jusqu’aux recettes intégrées.

Le prochain incrément reliera les identités à un fournisseur OIDC et les droits
à l’API institutionnelle. Le studio de configuration pourra ensuite réutiliser
le moteur de résolution et les contrôles d’accès côté serveur.
