import type { Metadata } from 'next';
import { assessmentKindLabels, learnerSpace } from '@/lib/assessments/store';
import { ActionForm, Badge, formatTime, Notice, Panel, Table } from '../administration/forms';
import { learner } from '../apprendre/session';

export const metadata: Metadata = { title: 'Mes évaluations' };
export const dynamic = 'force-dynamic';

const api = '/api/v1/ass/';
const back = '/evaluations';

export default async function Evaluations({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = await learnerSpace(settings, actor);
  const now = Date.now();
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Mes évaluations</span></nav>
      <section className="studio-heading"><p className="eyebrow">Évaluer</p><h1>Mes évaluations</h1>
        <p>Quiz, devoirs et examens de vos cours : brouillon enregistré, accusé de réception horodaté par le serveur, correction et commentaires.</p></section>
      <Notice error={search.error} message={search.message} />
      {data.teaching.length > 0 && (
        <Panel title="Cours que j’évalue" id="cours">
          <ul className="program-grid">{data.teaching.map(item => (
            <li key={item.id} className="program-card"><p className="eyebrow">{item.label}</p><h3>{item.course}</h3>
              <p><a className="action" href={`/evaluations/gestion?offre=${item.id}`}>Banques, épreuves et copies</a></p></li>
          ))}</ul>
        </Panel>
      )}
      <Panel title="À faire et réalisées" id="liste">
        {data.assessments.length === 0 ? <p>Aucune évaluation publiée dans vos cours.</p> : (
          <Table label="Évaluations" head={['Évaluation', 'Cours', 'Période', 'Tentatives', 'Action']}>
            {data.assessments.map(item => {
              const closes = new Date(item.closes_at).getTime() + (item.extra_days ?? 0) * 86_400_000;
              const open = item.state === 'published' && now >= new Date(item.opens_at).getTime() && now < closes;
              const current = item.attempts.find(attempt => attempt.state === 'in_progress');
              const used = item.attempts.length;
              return (
                <tr key={item.id}>
                  <td><strong>{item.title}</strong><br /><Badge tone="info">{assessmentKindLabels[item.kind]}</Badge>{item.team && <> <Badge tone="muted">En équipe</Badge></>}
                    {(item.extra_days || item.extra_minutes) ? <p className="muted">Aménagement : {item.extra_minutes ? `+${item.extra_minutes} min` : ''} {item.extra_days ? `+${item.extra_days} j` : ''}</p> : null}</td>
                  <td>{item.course}<br /><span className="muted">{item.offering}</span></td>
                  <td>{formatTime(item.opens_at)} → {formatTime(new Date(closes))}{item.duration_minutes ? <><br />Durée : {item.duration_minutes} min</> : null}</td>
                  <td>{used} / {item.attempts_allowed}
                    <ul>{item.attempts.map(attempt => <li key={attempt.id}><a href={`/evaluations/copie?id=${attempt.id}`}>Tentative {attempt.number}{attempt.team_label ? ' · ' + attempt.team_label : ''}</a>{' '}
                      {attempt.state === 'submitted' ? <Badge tone="ok">soumise</Badge> : <Badge tone="warn">en cours</Badge>}</li>)}</ul></td>
                  <td>{current ? <a className="action" href={`/evaluations/copie?id=${current.id}`}>Reprendre</a>
                    : open && used < item.attempts_allowed ? (
                      <ActionForm inline action={api + 'start'} back={back} hidden={{ assessmentId: item.id }} submit="Commencer">
                        {item.team && <label>Nom de l’équipe<input name="teamLabel" required maxLength={120} /></label>}
                      </ActionForm>
                    ) : <span className="muted">{item.state === 'closed' || now >= closes ? 'Fermée' : now < new Date(item.opens_at).getTime() ? 'Pas encore ouverte' : 'Tentatives épuisées'}</span>}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>
    </main>
  );
}
