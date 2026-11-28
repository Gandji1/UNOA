import type { Metadata } from 'next';
import { scopeIdFormat } from '@/lib/iam/settings';
import { companiesOverview, companyContexts, companyStates, documentKinds } from '@/lib/companies/store';
import { ActionForm, Badge, Editor, Notice, Panel, Table } from '../forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Entreprises partenaires' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/entreprises';
const api = '/api/v1/ent/';
const decisions: Record<string, [string, string][]> = {
  pending: [['approved', 'Approuver'], ['rejected', 'Refuser']],
  approved: [['suspended', 'Suspendre'], ['closed', 'Clore']],
  suspended: [['reinstated', 'Rétablir'], ['closed', 'Clore']],
};
const decisionLabels: Record<string, string> = { approved: 'approuvée', rejected: 'refusée', suspended: 'suspendue', reinstated: 'rétablie', closed: 'close' };
const actions: Record<string, string> = { 'company.registered': 'Inscription', 'company.document_added': 'Pièce déposée', 'company.updated': 'Profil modifié', 'member.added': 'Membre ajouté',
  'member.removed': 'Membre retiré', 'partnership.signed': 'Convention signée', 'company.closed': 'Compte clos' };

export default async function EntreprisesAdmin({ searchParams }: { searchParams: Promise<Search> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const scopeId = field(search.scope);
  const data = scopeIdFormat.test(scopeId) ? await companiesOverview(settings, actor, scopeId).catch(refusedAs(null)) : null;
  const crumbs = <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › {data ? <><a href={path}>Entreprises partenaires</a> › <span aria-current="page">{data.scope.label}</span></> : <span aria-current="page">Entreprises partenaires</span>}</nav>;
  if (!data) {
    const scopes = await companyContexts(settings, actor);
    return (
      <main id="contenu" className="studio">{crumbs}
        <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Entreprises partenaires</h1><p>Choisissez un établissement.</p></section>
        {notice}
        {scopes.length === 0 ? <p className="card-note">Aucun établissement accessible.</p> : <ul className="program-grid">{scopes.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>}
      </main>
    );
  }
  const back = `${path}?scope=${data.scope.id}`;
  const can = data.rights;
  return (
    <main id="contenu" className="studio">{crumbs}
      <section className="studio-heading"><p className="eyebrow">Campus-Entreprise</p><h1>Entreprises partenaires — {data.scope.label}</h1>
        <p>Vérification des entreprises (existence légale, mandat du représentant), conventions de partenariat, signalements et activité des recruteurs.</p></section>
      {notice}
      <Panel title="Entreprises" id="entreprises">
        {data.companies.length === 0 ? <p>Aucune entreprise inscrite.</p> : data.companies.map(company => (
          <section key={company.id} className="studio-panel">
            <h3>{company.name}{company.parent ? ` (antenne de ${company.parent})` : ''} <Badge tone={company.state === 'approved' ? 'ok' : company.state === 'pending' ? 'info' : 'warn'}>{companyStates[company.state]}</Badge></h3>
            <p className="muted">Immatriculation {company.registration_number} ({company.country}) · Représentant : {company.representative_name}, {company.representative_title}</p>
            <p>Pièces : {company.documents.length === 0 ? 'aucune' : company.documents.map((doc, index) => <span key={doc.id}>{index > 0 && ' · '}{doc.purged ? documentKinds[doc.kind] + ' (purgée)' : <a href={api + 'documents/' + doc.id}>{documentKinds[doc.kind]}</a>}</span>)}</p>
            {company.verifications.length > 0 && <p className="muted">Historique : {company.verifications.map(row => `${decisionLabels[row.decision]} par ${row.verifier}${row.reason ? ' (' + row.reason + ')' : ''}`).join(' ; ')}</p>}
            {can.verify && decisions[company.state] && (
              <Editor summary="Vérifier et décider">
                <ActionForm action={api + 'verify'} back={back} hidden={{ companyId: company.id }} submit="Enregistrer la décision">
                  <label className="studio-check"><input type="checkbox" name="legalExists" /> Existence légale contrôlée sur pièce</label>
                  <label className="studio-check"><input type="checkbox" name="mandateOk" /> Mandat du représentant contrôlé</label>
                  <label>Décision<select name="decision">{decisions[company.state].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label className="studio-wide">Motif (obligatoire pour refuser, suspendre ou clore)<input name="reason" maxLength={2000} /></label>
                </ActionForm>
              </Editor>
            )}
            {can.manage && company.state === 'approved' && (
              <Editor summary="Préparer une convention de partenariat">
                <ActionForm action={api + 'partnerships'} back={back} hidden={{ companyId: company.id }} submit="Créer la convention">
                  <label className="studio-wide">Intitulé<input name="title" required maxLength={300} /></label>
                  <label>Début<input type="date" name="startsOn" required /></label>
                  <label>Fin<input type="date" name="endsOn" required /></label>
                  <label className="studio-wide">Clauses<textarea name="terms" required rows={6} maxLength={20000} /></label>
                </ActionForm>
              </Editor>
            )}
          </section>
        ))}
      </Panel>
      <Panel title="Conventions de partenariat" id="conventions">
        {data.partnerships.length === 0 ? <p>Aucune convention.</p> : (
          <Table label="Conventions" head={['Entreprise', 'Intitulé', 'Période', 'Entreprise', 'Établissement', '']}>
            {data.partnerships.map(deal => <tr key={deal.id}><td>{deal.company}</td><td>{deal.title}</td><td>{deal.starts_on} → {deal.ends_on}</td>
              <td>{deal.company_signed_at ? 'signée' : 'à signer'}</td><td>{deal.institution_signed_at ? 'signée' : 'à signer'}</td>
              <td>{can.manage && deal.state === 'draft' && !deal.institution_signed_at ? <ActionForm inline action={api + 'partnership-sign'} back={back} hidden={{ partnershipId: deal.id, party: 'institution' }} submit="Signer" /> : deal.state === 'active' ? 'Active' : ''}</td></tr>)}
          </Table>
        )}
      </Panel>
      <Panel title="Signalements" id="signalements">
        {data.reports.length === 0 ? <p>Aucun signalement.</p> : data.reports.map(report => (
          <div key={report.id}><p><strong>{report.company}</strong> — {report.reason} {report.state === 'closed' ? <Badge tone="muted">Traité : {report.outcome}</Badge> : <Badge tone="warn">Ouvert</Badge>}</p>
            {can.manage && report.state === 'open' && <ActionForm inline action={api + 'handle-report'} back={back} hidden={{ reportId: report.id }} submit="Clore le signalement"><label>Suite donnée<input name="outcome" required maxLength={2000} /></label></ActionForm>}</div>
        ))}
      </Panel>
      <Panel title="Activité des entreprises" id="activite">
        {data.activity.length === 0 ? <p>Aucune activité.</p> : (
          <Table label="Activité" head={['Date', 'Entreprise', 'Personne', 'Action', 'Détail']}>
            {data.activity.map((row, index) => <tr key={index}><td>{new Date(row.created_at).toLocaleString('fr-FR')}</td><td>{row.company}</td><td>{row.actor}</td><td>{actions[row.action] ?? row.action}</td><td>{row.detail}</td></tr>)}
          </Table>
        )}
      </Panel>
    </main>
  );
}
