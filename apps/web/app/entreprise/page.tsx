import type { Metadata } from 'next';
import { companySpace, companyStates, documentKinds, memberRoles } from '@/lib/companies/store';
import { internshipStates } from '@/lib/internships/store';
import { ActionForm, Badge, Editor, Hidden, Notice, Panel, Table } from '../administration/forms';
import { learner } from '../apprendre/session';

export const metadata: Metadata = { title: 'Mon entreprise' };
export const dynamic = 'force-dynamic';

const api = '/api/v1/ent/';
const tone = (state: string) => state === 'approved' ? 'ok' : state === 'pending' ? 'info' : state === 'suspended' ? 'warn' : 'muted';

export default async function Entreprise({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const { companies } = await companySpace(settings, actor);
  const back = '/entreprise';
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Mon entreprise</span></nav>
      <section className="studio-heading"><p className="eyebrow">Entreprise</p><h1>Mon entreprise</h1>
        <p>Profil, pièces justificatives, équipe, conventions avec l’établissement et stagiaires accueillis.</p></section>
      <Notice error={search.error} message={search.message} />
      {companies.length === 0 && <p className="card-note">Vous ne faites partie d’aucune entreprise. <a href="/entreprises/inscription">Inscrire mon entreprise</a></p>}
      {companies.map(company => {
        const owner = company.role === 'owner';
        const open = ['pending', 'approved', 'suspended'].includes(company.state);
        const counts = { stages: company.internships.length, actifs: company.internships.filter(item => item.state === 'active').length, conventions: company.partnerships.filter(item => item.state === 'active').length };
        return (
          <section key={company.id} className="studio-panel" aria-labelledby={'c-' + company.id}>
            <div className="panel-head"><h2 id={'c-' + company.id}>{company.name} <Badge tone={tone(company.state)}>{companyStates[company.state]}</Badge></h2>
              <span className="muted">{company.scope}{company.role ? ' · ' + memberRoles[company.role] : ''}</span></div>
            {company.decision_reason && <p className="muted">Motif : {company.decision_reason}</p>}
            <p>{counts.stages} stagiaire(s), dont {counts.actifs} en cours · {counts.conventions} convention(s) active(s) avec l’établissement</p>

            {owner && (
              <Panel title="Pièces justificatives" id={'p-' + company.id}>
                {company.documents.length === 0 ? <p>Aucune pièce : déposez l’immatriculation et le mandat du représentant.</p> : (
                  <ul>{company.documents.map(item => <li key={item.id}>{documentKinds[item.kind]} — {item.purged_at ? 'purgée' : <a href={api + 'documents/' + item.id}>{item.filename}</a>}</li>)}</ul>
                )}
                {open && (
                  <form method="post" action={api + 'documents'} encType="multipart/form-data" className="studio-inline">
                    <Hidden values={{ return: back, companyId: company.id }} />
                    <label>Nature<select name="kind">{Object.entries(documentKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <input type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg" aria-label="Pièce justificative" />
                    <button className="secondary" type="submit">Déposer</button>
                  </form>
                )}
              </Panel>
            )}

            <Panel title="Équipe" id={'e-' + company.id}>
              <ul>{company.members.map(member => <li key={member.id}>{member.name} — {memberRoles[member.role]}{member.job_title ? ` (${member.job_title})` : ''}
                {owner && <ActionForm inline action={api + 'remove-member'} back={back} hidden={{ companyId: company.id, memberId: member.id }} submit="Retirer" confirm="Cette personne perdra l’accès à l’entreprise." />}</li>)}</ul>
              {owner && company.state === 'approved' && (
                <Editor summary="Ajouter un membre">
                  <ActionForm action={api + 'members'} back={back} hidden={{ companyId: company.id }} submit="Ajouter">
                    <label>Identifiant de son compte<input name="login" required maxLength={120} /></label>
                    <label>Rôle<select name="role">{Object.entries(memberRoles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label>Fonction<input name="jobTitle" maxLength={200} /></label>
                  </ActionForm>
                </Editor>
              )}
            </Panel>

            <Panel title="Conventions avec l’établissement" id={'v-' + company.id}>
              {company.partnerships.length === 0 ? <p>Aucune convention.</p> : (
                <Table label="Conventions" head={['Intitulé', 'Période', 'Entreprise', 'Établissement', 'État', '']}>
                  {company.partnerships.map(deal => <tr key={deal.id}><td>{deal.title}</td><td>{deal.starts_on} → {deal.ends_on}</td>
                    <td>{deal.company_signed_at ? 'signée' : 'à signer'}</td><td>{deal.institution_signed_at ? 'signée' : 'à signer'}</td>
                    <td>{deal.state === 'active' ? 'Active' : deal.state === 'ended' ? 'Terminée' : 'En signature'}</td>
                    <td>{owner && deal.state === 'draft' && !deal.company_signed_at && <ActionForm inline action={api + 'partnership-sign'} back={back} hidden={{ partnershipId: deal.id, party: 'company' }} submit="Signer" />}</td></tr>)}
                </Table>
              )}
            </Panel>

            <Panel title="Stagiaires" id={'s-' + company.id}>
              {company.internships.length === 0 ? <p>Aucun stagiaire pour le moment.</p> : (
                <Table label="Stagiaires" head={['Stagiaire', 'Stage', 'Période', 'État']}>
                  {company.internships.map(item => <tr key={item.id}><td>{item.student}</td><td><a href={'/stages?id=' + item.id}>{item.title}</a></td>
                    <td>{item.starts_on} → {item.ends_on}</td><td>{internshipStates[item.state]}</td></tr>)}
                </Table>
              )}
            </Panel>

            {owner && open && (
              <Editor summary="Modifier le profil">
                <ActionForm action={api + 'update'} back={back} hidden={{ companyId: company.id }} submit="Enregistrer">
                  <label>Raison sociale<input name="name" required defaultValue={company.name} maxLength={200} /></label>
                  <label>Forme juridique<input name="legalForm" defaultValue={company.legal_form ?? ''} maxLength={100} /></label>
                  <label>Secteur<input name="sector" defaultValue={company.sector ?? ''} maxLength={200} /></label>
                  <label>Ville<input name="city" defaultValue={company.city ?? ''} maxLength={200} /></label>
                  <label>Site web<input name="website" type="url" defaultValue={company.website ?? ''} /></label>
                  <label>Nom du représentant<input name="representativeName" required defaultValue={company.representative_name} maxLength={200} /></label>
                  <label>Fonction du représentant<input name="representativeTitle" required defaultValue={company.representative_title} maxLength={200} /></label>
                  <label>Courriel<input name="contactEmail" type="email" defaultValue={company.contact_email ?? ''} /></label>
                  <label>Téléphone<input name="contactPhone" defaultValue={company.contact_phone ?? ''} maxLength={40} /></label>
                  <label className="studio-wide">Adresse (privée)<textarea name="address" defaultValue={company.address ?? ''} rows={2} maxLength={1000} /></label>
                  <label className="studio-wide">Présentation publique<textarea name="description" defaultValue={company.description ?? ''} rows={4} maxLength={4000} /></label>
                </ActionForm>
              </Editor>
            )}
            {owner && company.state === 'approved' && (
              <Editor summary="Ajouter une antenne ou filiale">
                <ActionForm action={api + 'register'} back={back} hidden={{ parentId: company.id, scopeId: company.scope_id, registrationNumber: company.registration_number, country: company.country,
                  representativeName: company.representative_name, representativeTitle: company.representative_title }} submit="Ajouter l’antenne">
                  <label>Nom de l’antenne<input name="name" required maxLength={200} /></label>
                  <label>Ville<input name="city" maxLength={200} /></label>
                </ActionForm>
              </Editor>
            )}
            {owner && company.state !== 'closed' && (
              <Editor summary="Clore le compte de l’entreprise">
                <ActionForm action={api + 'close'} back={back} hidden={{ companyId: company.id }} submit="Clore définitivement" confirm="L’équipe perd l’accès et les pièces justificatives sont supprimées. L’historique des vérifications est conservé.">
                  <label className="studio-wide">Motif<input name="reason" maxLength={500} /></label>
                </ActionForm>
              </Editor>
            )}
          </section>
        );
      })}
    </main>
  );
}
