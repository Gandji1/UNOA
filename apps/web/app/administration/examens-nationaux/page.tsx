import type { Metadata } from 'next';
import { scopeIdFormat } from '@/lib/iam/settings';
import { evidenceStates, exnContexts, exnOverview, kindLabels, methodLabels } from '@/lib/external/store';
import { ActionForm, Badge, Editor, formatTime, Hidden, Notice, Panel, Table } from '../forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Examens nationaux' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/examens-nationaux';
const api = '/api/v1/exn/';
const examStates: Record<string, [string, 'warn' | 'ok' | 'muted']> = { draft: ['Brouillon', 'warn'], published: ['Publiée', 'ok'], archived: ['Archivée', 'muted'] };

export default async function ExamensAdmin({ searchParams }: { searchParams: Promise<Search> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const scopeId = field(search.scope);
  const data = scopeIdFormat.test(scopeId) ? await exnOverview(settings, actor, scopeId).catch(refusedAs(null)) : null;
  const crumbs = <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › {data ? <><a href={path}>Examens nationaux</a> › <span aria-current="page">{data.scope.label}</span></> : <span aria-current="page">Examens nationaux</span>}</nav>;
  if (!data) {
    const scopes = await exnContexts(settings, actor);
    return (
      <main id="contenu" className="studio">{crumbs}
        <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Examens nationaux</h1><p>Choisissez un pays ou un établissement.</p></section>
        {notice}
        {scopes.length === 0 ? <p className="card-note">Aucun périmètre accessible.</p> : <ul className="program-grid">{scopes.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>}
      </main>
    );
  }
  const back = `${path}?scope=${data.scope.id}`;
  return (
    <main id="contenu" className="studio">{crumbs}
      <section className="studio-heading"><p className="eyebrow">Suivi documentaire</p><h1>Examens nationaux — {data.scope.label}</h1>
        <p>Information officielle, déclarations des étudiants, pièces déposées et vérification auprès de l’autorité. La plateforme n’organise pas ces examens et ne produit aucun résultat ni diplôme d’État.</p></section>
      {notice}
      <Panel title="Informations publiées" id="informations">
        {data.exams.length === 0 ? <p>Aucune information.</p> : (
          <Table label="Examens nationaux" head={['Examen', 'Autorité organisatrice', 'Session', 'Déclarations', 'État', '']}>
            {data.exams.map(item => <tr key={item.id}><td>{item.title}</td><td>{item.authority}</td><td>{item.session_label}</td><td>{item.declarations}</td>
              <td><Badge tone={examStates[item.state][1]}>{examStates[item.state][0]}</Badge></td>
              <td>{data.rights.manage && item.state === 'draft' && <ActionForm inline action={api + 'publish'} back={back} hidden={{ examId: item.id }} submit="Publier" />}
                {data.rights.manage && item.state === 'published' && <ActionForm inline action={api + 'archive'} back={back} hidden={{ examId: item.id }} submit="Archiver" />}</td></tr>)}
          </Table>
        )}
        {data.rights.manage && (
          <Editor summary="Nouvelle information">
            <ActionForm action={api + 'exams'} back={back} hidden={{ scopeId: data.scope.id }} submit="Enregistrer le brouillon">
              <label>Intitulé<input name="title" required maxLength={200} /></label>
              <label>Autorité organisatrice<input name="authority" required maxLength={200} /></label>
              <label>Session<input name="sessionLabel" required maxLength={120} /></label>
              <label>Lien officiel (https)<input type="url" name="officialUrl" maxLength={2000} /></label>
              <label className="studio-wide">Information<textarea name="description" required rows={4} maxLength={6000} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>
      <Panel title="Pièces déposées et vérifications" id="pieces">
        {data.evidence.length === 0 ? <p>Aucune pièce.</p> : data.evidence.map(item => (
          <section key={item.id} className="studio-panel">
            <h3>{item.name} — {item.exam} <Badge tone={item.state === 'verified' ? 'ok' : item.state === 'rejected' ? 'danger' : 'warn'}>{evidenceStates[item.state]}</Badge></h3>
            <p>{kindLabels[item.kind]} délivré par <strong>{item.issuing_authority}</strong>{item.document_reference ? ` · réf. ${item.document_reference}` : ''}
              {item.stated_outcome ? ` · mention : « ${item.stated_outcome} »` : ''}{item.candidate_number ? ` · candidat n° ${item.candidate_number}` : ''}</p>
            <p className="muted">Déposée le {formatTime(item.deposited_at)} · <a href={`${api}evidence/${item.id}`}>{item.filename}</a> · empreinte {item.sha256.slice(0, 16)}…</p>
            {item.checks.length > 0 && <ul>{item.checks.map(check => <li key={check.id}>{formatTime(check.at)} — {evidenceStates[check.step]} par {check.verifier} ({methodLabels[check.method]}) : {check.note}
              {check.proof && data.rights.verify && <> · <a href={`${api}proofs/${check.id}`}>preuve</a></>}</li>)}</ul>}
            {data.rights.verify && !['verified', 'rejected'].includes(item.state) && (
              <form method="post" action={api + 'verify'} encType="multipart/form-data" className="studio-form">
                <Hidden values={{ return: back, evidenceId: item.id }} />
                <label>Étape<select name="step">{item.state === 'deposited' && <option value="in_review">Engager la vérification</option>}<option value="verified">Authenticité confirmée</option><option value="rejected">Rejeter (non authentique ou illisible)</option></select></label>
                <label>Méthode<select name="method">{Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="studio-wide">Constat<textarea name="note" required maxLength={2000} /></label>
                <label className="studio-wide">Preuve de vérification (facultatif)<input type="file" name="proof" accept=".pdf,.png,.jpg,.jpeg" /></label>
                <div className="studio-wide"><button className="action" type="submit">Enregistrer</button></div>
              </form>
            )}
          </section>
        ))}
      </Panel>
    </main>
  );
}
