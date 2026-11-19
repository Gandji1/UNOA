# PLAN D'EXÉCUTION AUTONOME — CLAUDE CODE

## 1. Mandat et ordre prioritaire

**Précondition absolue :** lire `CLAUDE.md` puis le TDR. Le développement est incrémental par dépendance, mais le périmètre contractuel est intégral ; aucun simple MVP dégradé ne remplace la cible. Le logiciel doit pouvoir être démontré avec une base vierge + contenu académique créé par l'admin. Les décisions requérant autorité, secret ou coût externe sont consignées mais ne bloquent pas les autres modules.

## 2. Cadence de chaque lot

`READ` → `DISCOVER` → `TRACE` → `DESIGN` → `TEST FIRST` → `CODE` → `REVIEW` → `PROVE` → `DOCUMENT` → `MARK DONE`. Ne passer à l'étape suivante que si le gate de l'étape antérieure est franchi. Prévoir tests de contrat et de permissions avant l'interface pour les opérations sensibles.

**Découverte initiale si dépôt existant :** arborescence, dépendances, commandes, schéma, migrations, comptes fictifs, fonctions existantes, contrats, erreurs, endpoints, fichier `.env.example`, CI et propriétés. Rédiger un rapport de diagnostic. Ne pas écraser de données existantes.

## 3. Backlog topologique et dépendances

| Phase | Pré-requis | Modules à livrer | Gate de sortie |
|---|---|---|---|
| P0 | Aucun | CORE OPS ; TDR/traçabilité ; socle monorepo | installation locale reproductible, CI, logs |
| P1 | P0 | TEN CFG IAM I18N A11Y SEC WF DOC NOT INTG | deux régions isolées, RBAC prouvé, config auditée |
| P2 | P1 | ORG GOV CAT CMS ADM SIS | programmes libres, admissions et inscription E2E |
| P3 | P2 | TEA LMS LIVE LAB ASS | enseignant recruté, cours approuvé, TP corrigé |
| P4 | P3 | GRD EXN FIN CRED SHORT | jury et document licite, paiement sandbox, examen externe séparé |
| P5 | P2-P4 | ENT JOB CAR STG B2B MEM PHD RND LIB | Campus-Entreprise et thèse parcours complet |
| P6 | P1-P5 | CAMP SUP ALUM QMS DPO ANA AI | support, qualité, analytics et IA encadrée |
| P7 | Toutes | tests global + hardening + reprise + déploiement conditionnel | 100 % exigences vérifiées et parcours PASS |

L'ordre peut être réordonné pour réduire dépendances, jamais pour supprimer un module. Le développeur doit détecter automatiquement ce qui existe et ne pas réimplémenter inutilement.

## 4. Fiche de lot obligatoire

```markdown
# LOT-<num> <titre>
- Relecture TDR effectuée (date ; sections ; IDs) :
- Problème métier et résultat utilisateur :
- Exigences REQ couvertes :
- Dépendances amont/aval :
- Menus/routes/pages :
- Permissions et portées :
- Entités, index, validations et migrations :
- Machine d'états, événements, idempotence :
- Endpoints, erreurs et codes HTTP :
- Configuration régionale et règles :
- Notifications et documents :
- Tests positifs/négatifs/E2E/isolement/accessibilité :
- Observabilité/backup/rollback :
- Preuves à capturer :
- Risques et alternatives :
```

## 5. Règles de commits et migrations

Commits petits, cohérents, avec identifiant de lot et IDs REQ. Les migrations doivent être versionnées et exécutables sur base vierge et sur base peuplée. Stratégie expansion → migration données → contraction quand un changement modifie une table active. Ne jamais réécrire l'historique des migrations appliquées en production. Prévoir rollback logique des opérations métiers irréversibles via corrections/annulations auditées ; aucun `DELETE FROM` pour corriger un paiement ou une délibération.

## 6. Politique des tests et preuves

Chaque ID a au minimum un test positif, un négatif, un contrôle de permission et de portée selon l'objet. Les opérations critiques ont tests transactionnels, concurrence, idempotence, contrôle de format, consentement et logs. Les résultats doivent être collectés automatiquement (JUnit/XML, couverture, Playwright, scans, migration check), joints au lot avec hash de commit et version de base. Une preuve non reproductible n'est pas suffisante.

**Tests spéciaux obligatoires :** base académique vide ; nouveaux pays sans code ; programmes concurrents aux règles contradictoires ; étudiants sur anciennes versions ; faux résultats nationaux ; double webhook paiement ; jury sans quorum ; entreprise non vérifiée ; tentative accès transverse ; coupure réseau à 99 % de soumission ; acteur multi-rôles ; révocation d'enseignant durant cours ; rollback config.

## 7. Gates de release

G0 : TDR lu et matrice saine. G1 : architecture/repository sain. G2 : migrations appliquées. G3 : tous tests unitaires. G4 : intégration et contrats. G5 : E2E et test mobile. G6 : sécurité/accessibilité/charge. G7 : backup-restauration. G8 : conformité des émissions documentaires. G9 : toutes lignes `MUST` marquées `VERIFIE`. G10 : tests production désactivent opérations non habilitées et fournisseurs sans secrets. **Si un gate échoue : release refusée.**

## 8. Livrables périodiques

Pour chaque lot : code, migrations, tests, documentation utilisateur et technique, notes d'architecture, matrice, journal, risques, captures/preuves de parcours. Pour release : playbook installation, runbook d'incident, inventaire secrets externes, dossier sécurité, rapport d'intégrité, sauvegarde, export, performances, conformité d'émission des diplômes, rapport de recette signé par autorité compétente si requis.
