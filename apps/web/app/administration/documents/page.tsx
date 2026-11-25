import type { Metadata } from 'next';
import { scopeIdFormat } from '@/lib/iam/settings';
import { categoryLabels, credContexts, credOverview, eligibilityLabels, placeholders, stateLabels } from '@/lib/credentials/store';
import { ActionForm, Badge, Editor, formatTime, Notice, Panel, Table } from '../forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Documents et diplômes' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/documents';
const api = '/api/v1/cred/';
const typeStates: Record<string, [string, 'warn' | 'ok' | 'muted']> = { draft: ['À approuver', 'warn'], published: ['Approuvé', 'ok'], retired: ['Retiré', 'muted'], superseded: ['Remplacé', 'muted'] };

export default async function DocumentsAdmin({ searchParams }: { searchParams: Promise<Search> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const scopeId = field(search.scope);
  const data = scopeIdFormat.test(scopeId) ? await credOverview(settings, actor, scopeId).catch(refusedAs(null)) : null;
  const crumbs = <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › {data ? <><a href={path}>Documents et diplômes</a> › <span aria-current="page">{data.scope.label}</span></> : <span aria-current="page">Documents et diplômes</span>}</nav>;
  if (!data) {
    const scopes = await credContexts(settings, actor);
    return (
      <main id="contenu" className="studio">{crumbs}
        <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Documents et diplômes</h1><p>Choisissez un établissement.</p></section>
        {notice}
        {scopes.length === 0 ? <p className="card-note">Aucun établissement accessible.</p> : <ul className="program-grid">{scopes.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>}
      </main>
    );
  }
  const back = `${path}?scope=${data.scope.id}`;
  const can = data.rights;
  const published = data.types.filter(type => type.state === 'published');
  return (
    <main id="contenu" className="studio">{crumbs}
      <section className="studio-heading"><p className="eyebrow">Documents</p><h1>Documents et diplômes — {data.scope.label}</h1>
        <p>Modèle approuvé → contrôle des conditions et de l’habilitation → signatures par d’autres personnes → délivrance numérotée et scellée → vérification par QR → révocation et réémission tracées.
          Aucun titre national ne peut être émis ici.</p></section>
      {notice}
      <Panel title="Types de documents" id="types">
        {data.types.length === 0 ? <p>Aucun type.</p> : (
          <Table label="Types de documents" head={['Type', 'Catégorie', 'Autorité émettrice', 'Condition', 'Signatures', 'État', '']}>
            {data.types.map(type => {
              const program = data.programs.find(item => item.id === type.program_id);
              return (
                <tr key={type.id}><td>{type.label}<br /><span className="muted">{type.code}{type.program ? ` · ${type.program}` : ''}</span></td><td>{categoryLabels[type.category]}
                  {type.category === 'institutional_diploma' && (program?.authorised ? <> <Badge tone="ok">habilitation en vigueur</Badge></> : <> <Badge tone="danger">verrouillé : sans habilitation</Badge></>)}</td>
                  <td>{type.issuing_authority}</td><td>{eligibilityLabels[type.eligibility]}</td><td>{type.required_signatures}</td><td><Badge tone={typeStates[type.state][1]}>{typeStates[type.state][0]}</Badge></td>
                  <td>{can.approve && type.state === 'draft' && type.author_id !== actor && <ActionForm inline action={api + 'publish-type'} back={back} hidden={{ typeId: type.id }} submit="Approuver" />}
                    {can.approve && type.state === 'published' && <ActionForm inline action={api + 'retire-type'} back={back} hidden={{ typeId: type.id }} submit="Retirer" />}</td></tr>
              );
            })}
          </Table>
        )}
        {can.design && (
          <Editor summary="Nouveau type de document">
            <ActionForm action={api + 'types'} back={back} hidden={{ scopeId: data.scope.id }} submit="Enregistrer le type">
              <label>Code<input name="code" required maxLength={16} pattern="[A-Za-z0-9][A-Za-z0-9-]{1,15}" /></label>
              <label>Libellé<input name="label" required maxLength={160} /></label>
              <label>Catégorie<select name="category">{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Autorité émettrice<input name="issuingAuthority" required maxLength={200} /></label>
              <label>Formation (obligatoire pour un diplôme)<select name="programId"><option value="">—</option>{data.programs.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
              <label>Condition<select name="eligibility">{Object.entries(eligibilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Signatures requises<input name="requiredSignatures" inputMode="numeric" defaultValue="1" /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Modèles par langue" id="modeles">
        <p className="studio-help">Champs disponibles : {placeholders.map(item => `{{${item}}}`).join(', ')}. Chaque publication crée une nouvelle version ; les versions émises restent archivées.</p>
        {data.templates.length === 0 ? <p>Aucun modèle.</p> : (
          <Table label="Modèles" head={['Type', 'Langue', 'Version', 'Titre', 'État', '']}>
            {data.templates.map(template => <tr key={template.id}><td>{data.types.find(type => type.id === template.type_id)?.label}</td><td>{template.language}</td><td>v{template.version}</td>
              <td>{template.title}</td><td><Badge tone={typeStates[template.state][1]}>{typeStates[template.state][0]}</Badge></td>
              <td>{can.approve && template.state === 'draft' && template.author_id !== actor && <ActionForm inline action={api + 'publish-template'} back={back} hidden={{ templateId: template.id }} submit="Approuver" />}</td></tr>)}
          </Table>
        )}
        {can.design && data.types.length > 0 && (
          <Editor summary="Nouvelle version de modèle">
            <ActionForm action={api + 'templates'} back={back} submit="Enregistrer le modèle">
              <label>Type<select name="typeId">{data.types.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
              <label>Langue<input name="language" required defaultValue="fr" maxLength={6} /></label>
              <label className="studio-wide">Titre<input name="title" required maxLength={200} /></label>
              <label className="studio-wide">Texte<textarea name="body" required rows={6} maxLength={8000} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      {can.issue && published.length > 0 && (
        <Panel title="Préparer un document" id="preparer">
          <ActionForm action={api + 'prepare'} back={back} submit="Préparer (puis signatures)">
            <label>Type<select name="typeId">{published.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
            <label>Étudiant<select name="studentId">{data.students.map(item => <option key={item.id} value={item.id}>{item.name} · {item.matricule}</option>)}</select></label>
            <label>Langue<input name="language" defaultValue="fr" maxLength={6} /></label>
          </ActionForm>
        </Panel>
      )}

      <Panel title="Registre" id="registre">
        {data.credentials.length === 0 ? <p>Aucun document.</p> : (
          <Table label="Registre des documents" head={['Numéro', 'Type', 'Titulaire', 'Signatures', 'État', '']}>
            {data.credentials.map(item => <tr key={item.id}><td>{item.number}{item.replaces && <><br /><span className="muted">réémission</span></>}</td><td>{item.type}</td><td>{item.name}<br /><span className="muted">{item.matricule}</span></td>
              <td>{item.signatures.length} / {item.required}{item.signatures.length > 0 && <><br /><span className="muted">{item.signatures.map(sig => sig.signer).join(', ')}</span></>}</td>
              <td><Badge tone={item.state === 'issued' ? 'ok' : item.state === 'revoked' ? 'danger' : 'warn'}>{stateLabels[item.state]}</Badge>{item.issued_at && <><br /><span className="muted">{formatTime(item.issued_at)}</span></>}{item.reason && <><br /><span className="muted">{item.reason}</span></>}</td>
              <td><a href={`/documents/voir?id=${item.id}`}>Voir</a>
                {can.sign && item.state === 'pending_signature' && item.requested_by !== actor && !item.signatures.some(sig => sig.signer_id === actor) && <ActionForm inline action={api + 'sign'} back={back} hidden={{ credentialId: item.id }} submit="Signer" />}
                {can.revoke && item.state !== 'revoked' && (
                  <Editor summary="Révoquer">
                    <ActionForm action={api + 'revoke'} back={back} hidden={{ credentialId: item.id }} submit="Révoquer">
                      <label className="studio-wide">Motif<input name="reason" required maxLength={1000} /></label>
                    </ActionForm>
                    {item.state === 'issued' && <ActionForm action={api + 'reissue'} back={back} hidden={{ credentialId: item.id }} submit="Révoquer et réémettre">
                      <label className="studio-wide">Motif<input name="reason" required maxLength={1000} /></label>
                    </ActionForm>}
                  </Editor>
                )}</td></tr>)}
          </Table>
        )}
      </Panel>
    </main>
  );
}
