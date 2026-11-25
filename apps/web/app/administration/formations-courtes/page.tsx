import type { Metadata } from 'next';
import { scopeIdFormat } from '@/lib/iam/settings';
import { enrollmentStates, modalityLabels, rplStates, shortContexts, shortOverview } from '@/lib/short/store';
import { ActionForm, Badge, Editor, Notice, Panel, Table } from '../forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Formations courtes' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/formations-courtes';
const api = '/api/v1/short/';
const courseStates: Record<string, [string, 'warn' | 'ok' | 'muted']> = { draft: ['Brouillon', 'warn'], published: ['Publiée', 'ok'], archived: ['Archivée', 'muted'] };

export default async function ShortAdmin({ searchParams }: { searchParams: Promise<Search> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const scopeId = field(search.scope);
  const data = scopeIdFormat.test(scopeId) ? await shortOverview(settings, actor, scopeId).catch(refusedAs(null)) : null;
  const crumbs = <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › {data ? <><a href={path}>Formations courtes</a> › <span aria-current="page">{data.scope.label}</span></> : <span aria-current="page">Formations courtes</span>}</nav>;
  if (!data) {
    const scopes = await shortContexts(settings, actor);
    return (
      <main id="contenu" className="studio">{crumbs}
        <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Formations courtes</h1><p>Choisissez un établissement ou une composante.</p></section>
        {notice}
        {scopes.length === 0 ? <p className="card-note">Aucun périmètre accessible.</p> : <ul className="program-grid">{scopes.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>}
      </main>
    );
  }
  const back = `${path}?scope=${data.scope.id}`;
  const can = data.rights;
  const published = data.courses.filter(course => course.state === 'published');
  const completers: [string, string][] = [];
  for (const item of data.enrollments) if (item.state === 'completed' && !completers.some(([id]) => id === item.account_id)) completers.push([item.account_id, item.name ?? item.account_id.slice(0, 8)]);
  return (
    <main id="contenu" className="studio">{crumbs}
      <section className="studio-heading"><p className="eyebrow">Formation continue</p><h1>Formations courtes — {data.scope.label}</h1>
        <p>Catalogue → sessions → inscriptions (public et entreprises) → progression validée avec preuve → attestation privée ou badge → parcours de microcertifications.</p></section>
      {notice}

      <Panel title="Catalogue" id="catalogue">
        {data.courses.length === 0 ? <p>Aucune formation.</p> : data.courses.map(course => {
          const modules = data.modules.filter(module => module.course_id === course.id);
          return (
            <section key={course.id} className="studio-panel">
              <h3>{course.title} <Badge tone={courseStates[course.state][1]}>{courseStates[course.state][0]}</Badge></h3>
              <p className="muted">{course.code} · {Number(course.duration_hours)} h · réussite à {course.pass_threshold} / 100 par module · {course.credential ? `document : ${course.credential}` : 'sans document'}
                {course.competencies.length ? ` · ${course.competencies.join(', ')}` : ''}</p>
              <ol>{modules.map(module => <li key={module.id}>{module.title} ({Number(module.hours)} h){module.content ? ` — contenu réutilisé : ${module.content}, licence : ${module.licence}` : ''}</li>)}</ol>
              {can.manage && course.state === 'draft' && (
                <Editor summary="Ajouter un module">
                  <ActionForm action={api + 'modules'} back={back} hidden={{ courseId: course.id }} submit="Ajouter">
                    <label>Module<input name="title" required maxLength={200} /></label>
                    <label>Heures<input name="hours" required inputMode="decimal" /></label>
                    <label>Compétences (séparées par des virgules)<input name="competencies" maxLength={1000} /></label>
                    <label>Contenu validé réutilisé (facultatif)<select name="contentVersionId"><option value="">—</option>{data.contents.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
                    <label>Licence de réutilisation<input name="licence" maxLength={500} /></label>
                  </ActionForm>
                </Editor>
              )}
              <div className="studio-actions">
                {can.approve && course.state === 'draft' && course.author_id !== actor && <ActionForm inline action={api + 'publish'} back={back} hidden={{ courseId: course.id }} submit="Publier" />}
                {can.approve && course.state === 'published' && <ActionForm inline action={api + 'archive'} back={back} hidden={{ courseId: course.id }} submit="Archiver" />}
              </div>
            </section>
          );
        })}
        {can.manage && (
          <Editor summary="Nouvelle formation courte">
            <ActionForm action={api + 'courses'} back={back} hidden={{ scopeId: data.scope.id }} submit="Enregistrer">
              <label>Code<input name="code" required maxLength={32} /></label>
              <label>Intitulé<input name="title" required maxLength={200} /></label>
              <label>Durée totale (heures)<input name="durationHours" required inputMode="decimal" /></label>
              <label>Seuil de réussite par module (/100)<input name="passThreshold" inputMode="numeric" defaultValue="50" /></label>
              <label>Document délivré (facultatif)<select name="credentialTypeId"><option value="">—</option>{data.types.filter(type => type.eligibility === 'short_completion').map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
              <label>Public<input name="audience" maxLength={500} /></label>
              <label className="studio-wide">Compétences (séparées par des virgules)<input name="competencies" maxLength={2000} /></label>
              <label className="studio-wide">Description<textarea name="description" required maxLength={6000} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Sessions et inscriptions" id="sessions">
        {can.manage && published.length > 0 && (
          <Editor summary="Nouvelle session">
            <ActionForm action={api + 'sessions'} back={back} submit="Ouvrir la session">
              <label>Formation<select name="courseId">{published.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
              <label>Libellé<input name="label" required maxLength={160} /></label>
              <label>Modalité<select name="modality">{Object.entries(modalityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Début<input type="date" name="startsOn" required /></label>
              <label>Fin<input type="date" name="endsOn" required /></label>
              <label>Capacité<input name="capacity" inputMode="numeric" /></label>
              <label>Tarif approuvé (facultatif)<select name="priceRuleId"><option value="">Gratuit</option>{data.rules.map(rule => <option key={rule.id} value={rule.id}>{rule.label}</option>)}</select></label>
              <label>Réservée au client (facultatif)<select name="clientId"><option value="">Session publique</option>{data.clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            </ActionForm>
          </Editor>
        )}
        {data.sessions.length === 0 ? <p>Aucune session.</p> : data.sessions.map(session => {
          const course = data.courses.find(item => item.id === session.course_id);
          const modules = data.modules.filter(module => module.course_id === session.course_id);
          const enrolled = data.enrollments.filter(item => item.session_id === session.id);
          return (
            <section key={session.id} className="studio-panel">
              <h3>{course?.title} — {session.label}</h3>
              <p className="muted">{modalityLabels[session.modality]} · {session.starts_on} → {session.ends_on}{session.capacity ? ` · ${enrolled.length}/${session.capacity}` : ''}{session.client ? ` · client : ${session.client}` : ' · publique'}</p>
              {can.clients && session.client_id && (
                <ActionForm inline action={api + 'enrol-employees'} back={back} hidden={{ sessionId: session.id, clientId: session.client_id }} submit="Inscrire les salariés">
                  <label>Adresses des salariés<input name="emails" required maxLength={8000} /></label>
                </ActionForm>
              )}
              {enrolled.length > 0 && (
                <Table label={'Inscrits — ' + session.label} head={['Apprenant', 'État', 'Résultat de module', 'Conclusion']}>
                  {enrolled.map(item => <tr key={item.id}><td>{item.name}{item.client ? <><br /><span className="muted">{item.client}</span></> : null}</td>
                    <td>{enrollmentStates[item.state]}{item.certificate ? <><br /><span className="muted">{item.certificate}</span></> : null}</td>
                    <td>{item.state === 'enrolled' && can.train && modules.length > 0 && (
                      <ActionForm inline action={api + 'results'} back={back} hidden={{ enrollmentId: item.id }} submit="Enregistrer">
                        <label>Module<select name="moduleId">{modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}</select></label>
                        <label>Score /100<input name="score" required inputMode="numeric" /></label>
                        <label>Preuve<input name="evidence" required maxLength={2000} /></label>
                      </ActionForm>
                    )}</td>
                    <td>{item.state === 'enrolled' && can.train && <ActionForm inline action={api + 'conclude'} back={back} hidden={{ enrollmentId: item.id }} submit="Conclure" />}
                      {item.state === 'completed' && !item.certificate && can.manage && course?.credential && <ActionForm inline action={api + 'certify'} back={back} hidden={{ enrollmentId: item.id }} submit="Préparer l’attestation" />}</td></tr>)}
                </Table>
              )}
            </section>
          );
        })}
      </Panel>

      <Panel title="Clients entreprises" id="clients">
        {data.clients.length === 0 ? <p>Aucun client.</p> : <ul>{data.clients.map(client => <li key={client.id}>{client.name}{client.registration ? ` (${client.registration})` : ''} — contact : {client.contact}</li>)}</ul>}
        {can.clients && (
          <Editor summary="Nouveau client">
            <ActionForm action={api + 'clients'} back={back} hidden={{ scopeId: data.scope.id }} submit="Enregistrer le client">
              <label>Raison sociale<input name="name" required maxLength={200} /></label>
              <label>Identifiant légal<input name="registration" maxLength={80} /></label>
              <label>Adresse du contact (compte existant)<input type="email" name="contactEmail" required maxLength={254} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Parcours de microcertifications" id="parcours">
        {data.stacks.length === 0 ? <p>Aucun parcours.</p> : <ul>{data.stacks.map(stack => <li key={stack.id}>{stack.title} — {stack.course_ids.map(id => data.courses.find(course => course.id === id)?.title).join(' + ')} → {stack.credential}
          {can.manage && (
            <ActionForm inline action={api + 'certify-stack'} back={back} hidden={{ stackId: stack.id }} submit="Préparer le badge">
              <label>Apprenant<select name="accountId">{completers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            </ActionForm>
          )}</li>)}</ul>}
        {can.manage && published.length >= 2 && (
          <Editor summary="Nouveau parcours">
            <ActionForm action={api + 'stacks'} back={back} hidden={{ scopeId: data.scope.id }} submit="Enregistrer le parcours">
              <label>Titre<input name="title" required maxLength={200} /></label>
              <label>Badge délivré<select name="credentialTypeId">{data.types.filter(type => type.eligibility === 'stack_completion').map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
              <fieldset className="studio-wide"><legend>Formations requises</legend>
                {published.map(course => <label key={course.id} className="studio-check"><input type="checkbox" name="courseIds" value={course.id} /> {course.title}</label>)}</fieldset>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Reconnaissance des acquis" id="acquis">
        {data.rpl.length === 0 ? <p>Aucune demande.</p> : data.rpl.map(item => (
          <section key={item.id} className="studio-panel">
            <p><strong>{item.name}</strong> — {item.target} <Badge tone={item.state === 'accepted' ? 'ok' : item.state === 'rejected' ? 'danger' : 'warn'}>{rplStates[item.state]}</Badge></p>
            <p>{item.experience}</p>{item.decision && <p className="muted">{item.decision}</p>}
            {can.rpl && ['submitted', 'in_review'].includes(item.state) && item.account_id !== actor && (
              <ActionForm action={api + 'decide-rpl'} back={back} hidden={{ rplId: item.id }} submit="Statuer">
                <label>Décision<select name="decision"><option value="in_review">Mettre en examen</option><option value="accepted">Acquis reconnus</option><option value="partially_accepted">Reconnus en partie</option><option value="rejected">Non reconnus</option></select></label>
                <label className="studio-wide">Motivation (obligatoire pour une décision)<textarea name="reason" maxLength={4000} /></label>
              </ActionForm>
            )}
          </section>
        ))}
      </Panel>

      <Panel title="Participation et qualité" id="rapport" actions={<a className="secondary" href={`${api}report?scopeId=${data.scope.id}`}>Exporter (CSV)</a>}>
        {data.report.length === 0 ? <p>Aucune donnée.</p> : (
          <Table label="Participation" head={['Formation', 'Inscrits', 'Réussis', 'Non réussis', 'Retraits', 'Satisfaction']}>
            {data.report.map(row => <tr key={row.course_id}><td>{row.title}</td><td>{row.enrolled}</td><td>{row.completed}</td><td>{row.not_passed}</td><td>{row.withdrawn}</td>
              <td>{row.rating ? `${row.rating} / 5 (${row.ratings} avis)` : '—'}</td></tr>)}
          </Table>
        )}
      </Panel>
    </main>
  );
}
