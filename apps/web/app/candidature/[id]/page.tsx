import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { scopeIdFormat } from '@/lib/iam/settings';
import { applicationView } from '@/lib/admissions/store';
import { ActionForm, Badge, formatTime, Hidden, Notice, Panel, Table } from '../../administration/forms';
import { learner, refusedAs } from '../../apprendre/session';
import { applicationStates, decisionLabels, documentStates } from '../labels';

export const metadata: Metadata = { title: 'Candidature' };
export const dynamic = 'force-dynamic';

export default async function Candidature({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { id } = await params;
  if (!scopeIdFormat.test(id)) notFound();
  const { settings, actor } = await learner();
  const search = await searchParams;
  const view = await applicationView(settings, actor, id).catch(refusedAs(null));
  if (!view || !view.own) notFound();
  const { application, round } = view;
  const back = `/candidature/${application.id}`;
  const api = `/api/v1/admissions/applications/${application.id}/`;
  const editable = ['draft', 'incomplete'].includes(application.state);
  const openRequests = view.requests.filter(item => !item.answered_at);
  const last = view.decisions.at(-1);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/candidature">Mes candidatures</a> › <span aria-current="page">{round.program_code}</span></nav>
      <section className="studio-heading">
        <p className="eyebrow">{round.label} · {round.owner_label}</p>
        <h1>{round.program_title}</h1>
        <p><Badge tone={applicationStates[application.state][1]}>{applicationStates[application.state][0]}</Badge>
          {application.receipt && <Badge tone="muted">Accusé {application.receipt}</Badge>}
          <span className="muted"> Clôture : {formatTime(round.closes_at)}</span></p>
      </section>
      <Notice error={search.error} message={search.message} />
      {round.instructions && <p className="card-note">{round.instructions}</p>}
      {openRequests.map(item => <p key={item.id} className="studio-notice" role="alert">Complément demandé le {formatTime(item.requested_at)} : {item.message}</p>)}

      <Panel title="Formulaire" id="formulaire">
        {editable ? (
          <ActionForm action={api + 'answers'} back={back} submit="Enregistrer le brouillon">
            {round.form.map(field => {
              const name = 'f_' + field.key;
              const value = application.answers[field.key] ?? '';
              return (
                <label key={field.key} className={field.type === 'textarea' ? 'studio-wide' : undefined}>
                  {field.label}{field.required ? ' *' : ''}
                  {field.type === 'textarea' ? <textarea name={field.key} defaultValue={value} required={field.required} maxLength={4000} id={name} />
                    : field.type === 'choice' ? (
                      <select name={field.key} defaultValue={value} required={field.required} id={name}>
                        <option value="">—</option>{field.choices.map(choice => <option key={choice}>{choice}</option>)}
                      </select>
                    ) : <input name={field.key} id={name} defaultValue={value} required={field.required}
                      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'} maxLength={500} />}
                </label>
              );
            })}
          </ActionForm>
        ) : (
          <section className="facts">{round.form.map(field => <div key={field.key}><span>{field.label}</span><strong>{application.answers[field.key] || '—'}</strong></div>)}</section>
        )}
      </Panel>

      <Panel title="Pièces justificatives" id="pieces">
        {round.documents.length === 0 ? <p>Aucune pièce demandée.</p> : (
          <Table label="Pièces" head={['Pièce', 'Format', 'Dépôt', 'Contrôle', editable ? 'Déposer' : '']}>
            {round.documents.map(rule => {
              const doc = view.documents.find(item => item.document_key === rule.key);
              return (
                <tr key={rule.key}>
                  <td>{rule.label}{rule.required ? ' *' : ''}</td>
                  <td>{rule.formats.join(', ')} · {rule.maxKb} Ko max.</td>
                  <td>{doc ? <a href={`/api/v1/admissions-documents/${doc.id}`}>{doc.filename}</a> : '—'}</td>
                  <td>{doc ? <><Badge tone={documentStates[doc.state][1]}>{documentStates[doc.state][0]}</Badge>{doc.note && <span className="muted"> {doc.note}</span>}</> : '—'}</td>
                  <td>{editable && (
                    <form method="post" action={api + 'documents'} encType="multipart/form-data" className="studio-inline">
                      <Hidden values={{ return: back, key: rule.key }} />
                      <input type="file" name="file" required aria-label={'Fichier : ' + rule.label}
                        accept={rule.formats.map(format => '.' + format).join(',')} />
                      <button className="secondary" type="submit">Déposer</button>
                    </form>
                  )}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>

      {editable && (
        <Panel title="Dépôt du dossier" id="depot">
          {view.completeness.complete ? <p>Le dossier est complet. Le dépôt produit un accusé de réception horodaté.</p> : (
            <p className="studio-notice">Éléments manquants : {[...view.completeness.missingFields, ...view.completeness.missingDocuments].join(', ')}</p>
          )}
          <ActionForm inline action={api + 'submit'} back={back} submit={application.state === 'incomplete' ? 'Redéposer le dossier' : 'Déposer le dossier'} />
        </Panel>
      )}

      {view.interviews.length > 0 && (
        <Panel title="Convocations" id="convocations">
          <ul>{view.interviews.map(item => <li key={item.id}>{item.kind} — {formatTime(item.scheduled_at)} — {item.place}</li>)}</ul>
        </Panel>
      )}

      {view.decisions.length > 0 && (
        <Panel title="Décisions" id="decisions">
          <ul>{view.decisions.map(item => (
            <li key={item.id}><strong>{decisionLabels[item.decision]}</strong> le {formatTime(item.decided_at)} — {item.reason}
              {item.conditions && <p>Conditions : {item.conditions}</p>}</li>
          ))}</ul>
          {application.state === 'decided' && last && ['admitted', 'conditional'].includes(last.decision) && (
            <div className="studio-actions">
              <ActionForm inline action={api + 'accept'} back={back} submit="Accepter l’admission" />
              <ActionForm inline action={api + 'decline'} back={back} submit="Décliner" />
            </div>
          )}
          {application.state === 'decided' && !view.appeals.some(item => item.state === 'submitted') && (
            <ActionForm action={api + 'appeal'} back={back} submit="Former un recours">
              <label className="studio-wide">Motif du recours<textarea name="reason" required maxLength={4000} /></label>
            </ActionForm>
          )}
        </Panel>
      )}

      {view.appeals.length > 0 && (
        <Panel title="Recours" id="recours">
          <ul>{view.appeals.map(item => <li key={item.id}>{formatTime(item.filed_at)} — {item.reason} — <strong>{
            item.state === 'submitted' ? 'en attente' : item.state === 'granted' ? 'accueilli' : 'rejeté'}</strong>{item.ruling && ' : ' + item.ruling}</li>)}</ul>
        </Panel>
      )}

      {['draft', 'submitted', 'incomplete', 'review'].includes(application.state) && (
        <ActionForm inline action={api + 'withdraw'} back={back} submit="Retirer ma candidature" confirm="Le retrait est définitif pour cette campagne." />
      )}
    </main>
  );
}
