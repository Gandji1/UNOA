import type { ReactNode } from 'react';

export const formErrors: Record<string, string> = {
  '400': 'Vérifiez les champs saisis : un format ou une valeur est invalide.',
  '403': 'Cette action dépasse vos habilitations ou revient à une autre personne.',
  '404': 'L’élément demandé est introuvable.',
  '409': 'Cet enregistrement existe déjà ou son état a changé depuis son affichage.',
  '413': 'La demande dépasse la taille autorisée.',
  '415': 'Format de demande non pris en charge.',
  '423': 'Cette leçon est verrouillée : terminez d’abord les leçons requises.',
  '410': 'Cette séance a été annulée.',
  '425': 'La salle ouvre 15 minutes avant le début de la séance et ferme à sa fin.',
  '428': 'Indiquez d’abord votre choix concernant l’enregistrement de la séance.',
  '422': 'Une règle refuse cette opération : hiérarchie, période, état ou cohérence.',
  '503': 'Le service est temporairement indisponible. Réessayez.',
};

export function Notice({ error, message }: { error?: string; message?: string }) {
  const text = error ? formErrors[error] ?? formErrors['400'] : undefined;
  if (text) return <p className="studio-notice" role="alert">{text}</p>;
  if (message === 'saved') return <p className="studio-notice success" role="status">Modification enregistrée.</p>;
  return null;
}

export function formatTime(date: Date | string | null) {
  if (!date) return 'Sans terme';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
    .format(new Date(date)) + ' UTC';
}

export function Hidden({ values }: { values: Record<string, string> }) {
  return <>{Object.entries(values).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}</>;
}

// Every studio form posts to the API with its return view; the server checks
// permissions again and redirects with a status message.
export function ActionForm({ action, back, hidden = {}, submit, children, inline, confirm }: {
  action: string; back: string; hidden?: Record<string, string>; submit: string; children?: ReactNode;
  inline?: boolean; confirm?: string;
}) {
  return (
    <form method="post" action={action} className={inline ? 'studio-inline' : 'studio-form'}>
      <Hidden values={{ return: back, ...hidden }} />
      {children}
      {confirm && <p className="studio-wide studio-help">{confirm}</p>}
      <div className={inline ? undefined : 'studio-wide'}><button className={inline ? 'secondary' : 'action'} type="submit">{submit}</button></div>
    </form>
  );
}

export function Panel({ title, id, children, actions }: { title: string; id: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="studio-panel" aria-labelledby={id}>
      <div className="panel-head"><h2 id={id}>{title}</h2>{actions}</div>
      {children}
    </section>
  );
}

export function Editor({ summary, children }: { summary: string; children: ReactNode }) {
  return <details className="studio-panel studio-editor"><summary>{summary}</summary>{children}</details>;
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'muted' | 'info' | 'danger'; children: ReactNode }) {
  return <span className={'badge badge-' + tone}>{children}</span>;
}

export function Table({ label, head, children }: { label: string; head: string[]; children: ReactNode }) {
  return (
    <div className="studio-table" role="region" aria-label={label} tabIndex={0}>
      <table>
        <thead><tr>{head.map(cell => <th key={cell} scope="col">{cell}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const shortId = (id: string) => id.slice(0, 8);
