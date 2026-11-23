import { Badge } from './forms';
import type { Handoff } from '@/lib/iam/handoff';

// "Next step" panel: who, one level below, must now sign in, and for what.
export function HandoffPanel({ items, tasks }: { items: Handoff[]; tasks: { role: string; scope: string; task?: string }[] }) {
  if (!items.length && !tasks.length) return null;
  return (
    <section className="studio-panel handoff" aria-labelledby="prochaines-etapes">
      <h2 id="prochaines-etapes">Prochaines étapes</h2>
      {tasks.length > 0 && <ul>{tasks.map((item, index) => <li key={index}><strong>Vous ({item.role}, {item.scope})</strong> : {item.task}.</li>)}</ul>}
      {items.length > 0 && <ul>{items.map((item, index) => (
        <li key={index}>
          {item.state === 'accepted' && <><Badge tone="ok">À faire par {item.name}</Badge> Demandez à <strong>{item.name}</strong> ({item.role}, {item.scope}) de se connecter
            pour {item.task}.</>}
          {item.state === 'pending' && <><Badge tone="warn">Invitation en attente</Badge> Transmettez à <strong>{item.name}</strong> son lien d’invitation
            (Utilisateurs et rôles) : une fois son accès créé, il ou elle devra {item.task}.</>}
          {(item.state === 'expired' || item.state === 'revoked') && <><Badge tone="muted">Invitation {item.state === 'expired' ? 'expirée' : 'retirée'}</Badge> {item.name} ({item.role}) — créez une nouvelle invitation si besoin.</>}
        </li>
      ))}</ul>}
    </section>
  );
}
