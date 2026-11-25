# ADR-0013 — Paiements : crédit uniquement sur événement signé du prestataire, grand livre non modifiable

Date : 25 novembre 2026. Statut : accepté. Exigences : FIN-007 à 012, CONTRATS_API_DONNEES (« pas de crédit suite
au seul callback navigateur ; idempotence »), cycle de paiement initiated → pending_provider → confirmed/failed/cancelled → refunded/chargeback.

## Décision

- Un paiement est créé « en attente du prestataire » avec une clé d'idempotence fournie par le formulaire ; le
  retour navigateur ne confirme rien.
- Seul un événement du prestataire, reçu sur `/api/v1/fin/webhooks/{prestataire}`, signé HMAC-SHA256
  (`X-Unoa-Signature: t=…,v1=…`, tolérance 5 min), modifie un paiement ; chaque identifiant d'événement n'est
  traité qu'une fois (index unique), tout événement est journalisé (`provider_event`), y compris les signatures
  invalides ; un montant ou une devise qui ne correspondent pas ne créditent rien (`amount_mismatch`).
- Tous les soldes sont des sommes d'écritures `ledger_entry` en unités mineures ISO 4217 (données ICU du
  moteur, aucune liste de devises codée) ; factures, lignes, échéances, écritures et reçus sont append-only ;
  une correction passe par un avoir, une remise approuvée, un remboursement ou une rétrofacturation.
- Adaptateur disponible : **bac à sable** (`UNOA_PAYMENT_ADAPTER=sandbox`, secret `UNOA_PAYMENT_SANDBOX_SECRET`
  d'au moins 32 caractères, hors code). Sa page de paiement fictif produit un événement signé traité exactement
  comme celui d'un prestataire réel. Sans configuration, le paiement en ligne est indiqué « non configuré ».

## Conséquences

Les prestataires réels (mobile money, carte, virement instantané) exigent un contrat, des clés et un domaine
de rappel : **BLOCKED_EXTERNAL**. Leur adaptateur réutilisera la même vérification et le même traitement.
