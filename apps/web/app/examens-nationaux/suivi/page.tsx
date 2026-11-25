import type { Metadata } from 'next';
import { iamSettings } from '@/lib/iam/settings';
import { evidenceStates, kindLabels, mySpace, publicExams } from '@/lib/external/store';
import { ActionForm, Badge, Editor, formatTime, Hidden, Notice, Panel } from '../../administration/forms';
import { learner } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Mon suivi des examens nationaux' };
export const dynamic = 'force-dynamic';

const api = '/api/v1/exn/';
const back = '/examens-nationaux/suivi';
const eventLabels: Record<string, string> = { declared: 'Participation déclarée', withdrawn: 'Déclaration retirée', evidence_deposited: 'Document déposé',
  evidence_in_review: 'Vérification engagée', evidence_verified: 'Document vérifié', evidence_rejected: 'Document rejeté' };
const tone = (state: string) => state === 'verified' ? 'ok' : state === 'rejected' ? 'danger' : 'warn';

export default async function Suivi({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const [declarations, exams] = await Promise.all([mySpace(settings, actor), publicExams(iamSettings()!, null)]);
  const open = exams.filter(exam => !declarations.some(item => item.exam_id === exam.id && !item.withdrawn_at));
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Examens nationaux</span></nav>
      <section className="studio-heading"><p className="eyebrow">Suivi documentaire</p><h1>Mes examens nationaux</h1>
        <p>Déclaration volontaire, dépôt de la copie officielle (relevé ou diplôme délivré par l’autorité) et état de sa vérification.
          Sans document vérifié, aucun résultat n’est présumé.</p></section>
      <Notice error={search.error} message={search.message} />
      {open.length > 0 && (
        <Panel title="Déclarer une participation" id="declarer">
          <ActionForm action={api + 'declare'} back={back} submit="Déclarer ma participation">
            <label>Examen<select name="examId">{open.map(item => <option key={item.id} value={item.id}>{item.title} — {item.session_label} ({item.authority})</option>)}</select></label>
            <label>Numéro de candidat (facultatif)<input name="candidateNumber" maxLength={60} /></label>
            <label className="studio-wide">Précisions (facultatif)<textarea name="statement" maxLength={2000} /></label>
          </ActionForm>
        </Panel>
      )}
      {declarations.length === 0 ? <Panel title="Mes déclarations" id="liste"><p>Aucune déclaration.</p></Panel> : declarations.map(item => (
        <Panel key={item.id} title={`${item.title} — ${item.session_label}`} id={'p' + item.id.slice(0, 8)}>
          <p>Autorité organisatrice : <strong>{item.authority}</strong>{item.candidate_number ? ` · candidat n° ${item.candidate_number}` : ''}
            {item.withdrawn_at && <> <Badge tone="muted">retirée</Badge></>}</p>
          <p><strong>État :</strong> {item.status}</p>
          {item.evidence.length > 0 && <ul>{item.evidence.map(evidence => <li key={evidence.id}>{kindLabels[evidence.kind]} — {evidence.issuing_authority}
            {evidence.stated_outcome ? ` · mention portée sur le document : « ${evidence.stated_outcome} »` : ''} · <a href={`${api}evidence/${evidence.id}`}>{evidence.filename}</a>{' '}
            <Badge tone={tone(evidence.state)}>{evidenceStates[evidence.state]}</Badge></li>)}</ul>}
          {!item.withdrawn_at && <>
            <form method="post" action={api + 'evidence'} encType="multipart/form-data" className="studio-form">
              <Hidden values={{ return: back, participationId: item.id }} />
              <label>Type de pièce<select name="kind"><option value="result">Relevé ou attestation de résultat</option><option value="diploma">Diplôme</option></select></label>
              <label>Autorité émettrice<input name="issuingAuthority" required maxLength={200} defaultValue={item.authority} /></label>
              <label>Référence du document<input name="documentReference" maxLength={120} /></label>
              <label>Mention portée sur le document<input name="statedOutcome" maxLength={200} /></label>
              <label className="studio-wide">Fichier (PDF, PNG ou JPG)<input type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg" /></label>
              <div className="studio-wide"><button className="action" type="submit">Déposer la copie officielle</button></div>
            </form>
            <ActionForm inline action={api + 'withdraw'} back={back} hidden={{ participationId: item.id }} submit="Retirer ma déclaration" />
          </>}
          <Editor summary="Historique">
            <ul>{item.history.map((entry, index) => <li key={index}>{formatTime(entry.at)} — {eventLabels[entry.kind] ?? entry.kind}{entry.detail ? ` (${entry.detail})` : ''}</li>)}</ul>
          </Editor>
        </Panel>
      ))}
    </main>
  );
}
