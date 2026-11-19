# ADR-0003 — Connexion OIDC dans le frontal web

Le frontal Vercel gère les cookies et les échanges OIDC dans des routes Next.js
serveur. Le navigateur communique avec le campus sur une seule origine. Les
commandes de connexion et de déconnexion vérifient cette origine. L’API
institutionnelle NestJS reste la cible des services métier distincts.

Le fournisseur est configuré côté serveur. Il émet un jeton signé contenant
le niveau d’assurance attendu. Le client vérifie l’émetteur, l’audience, la
signature, le nonce et le retour d’état. La transaction PKCE est conservée
cinq minutes dans un cookie chiffré. Les jetons du fournisseur restent dans
la requête de rappel.

Une session dispose de huit heures au plus, avec révocation immédiate en base.
Seule l’empreinte SHA-256 d’un secret aléatoire de 32 octets est conservée.
Une désactivation de compte révoque les sessions et une réactivation ne les
rétablit pas. Les droits sont réévalués aussi longtemps que la session est active.
La vérification SQL scope et session se fait dans la même requête. Les refus
d’un compte connecté sont enregistrés avec un identifiant de corrélation.

Le rôle PostgreSQL web consulte les identités, opère sur les sessions, appelle
le contrôle d’accès et ajoute des traces d’audit. La gestion des comptes et
des attributions demeure du ressort du propriétaire ou des futurs services
autorisés. La connexion s’ouvre après configuration du client institutionnel et
de la base. Les politiques de quota, de rétention et d’accès administratif aux
sessions seront fixées avec les modules d’exploitation et d’administration.
