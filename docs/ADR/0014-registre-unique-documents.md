# ADR-0014 — Registre unique des documents délivrés

Date : 25 novembre 2026. Statut : accepté. Exigences : CRED-001 à 013, SHORT-007/008, EXN-007.

## Décision

Toutes les pièces délivrées par la plateforme (attestations internes, diplômes d'établissement sous habilitation,
badges et attestations de formations courtes) vivent dans un seul registre `credential` : titulaire (compte),
dossier étudiant éventuel, source éventuelle (inscription à une formation courte, parcours de microcertifications),
numérotation par type et par année, empreinte SHA-256, code de vérification aléatoire de 128 bits, signatures
par d'autres personnes que le préparateur et le titulaire, révocation et réémission chaînée.
Le vérificateur public appelle une seule fonction `unoa.verify_credential` (SECURITY DEFINER) qui ne divulgue
ni nom complet, ni matricule, ni contenu, et journalise chaque consultation par empreinte du code.
Aucune catégorie « diplôme national / titre d'État » n'existe ; un diplôme d'établissement est verrouillé sans
habilitation de la formation `authorized`, vérifiée par une autre personne et en cours de validité.

## Conséquences

Un seul vérificateur, une seule politique de révocation. Les modules métiers (SHORT, puis MEM/PHD) préparent
leurs documents par `seal()` après leurs propres contrôles d'éligibilité. La signature électronique qualifiée et
la preuve cryptographique des badges (clé de l'établissement) restent **BLOCKED_EXTERNAL**.
