import 'server-only';
import { createHash } from 'node:crypto';
import { matchesFormat } from '@unoa/domain/forms';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, ensure, https, optional, Problem, text, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';

// External national examinations (module EXN): information, voluntary
// declaration, deposit of an official copy and its verification. Nothing here
// computes or issues a national result; the status shown is always the
// verification status of a document issued by the named authority.

type Right = 'read' | 'manage' | 'verify';
export const evidenceStates: Record<string, string> = { deposited: 'Déposée', in_review: 'Vérification en cours', verified: 'Vérifiée', rejected: 'Rejetée' };
export const methodLabels: Record<string, string> = {
  authority_register: 'Registre officiel de l’autorité', authority_contact: 'Confirmation écrite de l’autorité', original_seen: 'Original présenté', other: 'Autre (préciser)',
};
export const kindLabels: Record<string, string> = { result: 'Relevé ou attestation de résultat', diploma: 'Diplôme' };
export const notCommunicated = 'Non communiqué : aucune pièce officielle vérifiée';

async function rights(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`SELECT unoa.has_scope_permission($1, 'exn.read', $2) AS read,
    unoa.has_scope_permission($1, 'exn.manage', $2) AS manage, unoa.has_scope_permission($1, 'exn.verify', $2) AS verify`, [actor, scopeId]);
  return rows[0];
}
async function require(store: Queryable, actor: string, scopeId: string, right: Right) {
  const granted = await rights(store, actor, scopeId);
  ensure(granted?.[right], 403, 'Action réservée aux responsables habilités');
  return granted;
}
const event = (store: Queryable, participation: string, kind: string, actor: string, detail: string | null = null) =>
  store.query('INSERT INTO unoa.external_event(participation_id, kind, detail, actor_id) VALUES ($1, $2, $3, $4)', [participation, kind, detail, actor]);

// Public information: published references only, with the official authority.
// On an establishment's site, only the references of that establishment, its campuses and its country.
export async function publicExams(settings: IamSettings, siteScope: string | null) {
  const { rows } = await database(settings).query<{ id: string; title: string; authority: string; official_url: string | null; session_label: string; description: string; scope_label: string }>(`
    SELECT exam.id, exam.title, exam.authority, exam.official_url, exam.session_label, exam.description, scope.label AS scope_label
    FROM unoa.external_exam AS exam JOIN unoa.scope ON scope.id = exam.scope_id WHERE exam.state = 'published'
      AND ($1::uuid IS NULL OR unoa.scope_within(exam.scope_id, $1) OR unoa.scope_within($1, exam.scope_id)) ORDER BY exam.published_at DESC LIMIT 200`, [siteScope]);
  return rows;
}

// ------------------------------------------------------------- staff side

export async function staffAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.exn.staff', async store => {
    if (action === 'exams') {
      const scopeId = uuid(input.scopeId);
      await require(store, actor, scopeId, 'manage');
      const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.external_exam(scope_id, title, authority, official_url, session_label, description, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [scopeId, boundedText(input.title, 200, 'Intitulé'), boundedText(input.authority, 200, 'Autorité organisatrice'),
        optional(input.officialUrl, value => https(value, 'Lien officiel')), boundedText(input.sessionLabel, 120, 'Session'), boundedText(input.description, 6000, 'Information'), actor]);
      await audit(store, actor, scopeId, 'exn.exam_created', correlation, rows[0].id);
      return { scopeId, examId: rows[0].id };
    }
    if (action === 'publish' || action === 'archive') {
      const { rows: [exam] } = await store.query<{ id: string; scope_id: string; state: string }>('SELECT id, scope_id, state FROM unoa.external_exam WHERE id = $1 FOR UPDATE', [uuid(input.examId)]);
      ensure(exam, 404, 'Référence introuvable');
      await require(store, actor, exam.scope_id, 'manage');
      if (action === 'publish') {
        ensure(exam.state === 'draft', 409, 'Déjà publiée');
        await store.query("UPDATE unoa.external_exam SET state = 'published', published_at = now() WHERE id = $1", [exam.id]);
      } else {
        ensure(exam.state === 'published', 409, 'Seule une information publiée s’archive');
        await store.query("UPDATE unoa.external_exam SET state = 'archived' WHERE id = $1", [exam.id]);
      }
      await audit(store, actor, exam.scope_id, 'exn.exam_' + action, correlation, exam.id);
      return { scopeId: exam.scope_id, examId: exam.id };
    }
    throw new Problem(404, 'Opération inconnue');
  });
}

// One verification step, with a method, a reasoned note and an optional proof file.
export async function verify(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const step = choice(input.step, ['in_review', 'verified', 'rejected'] as const, 'Étape');
  const method = choice(input.method, ['authority_register', 'authority_contact', 'original_seen', 'other'] as const, 'Méthode');
  let proof: { name: string; sha: string; bytes: Buffer } | null = null;
  if (input.proof instanceof File && input.proof.size > 0) {
    const bytes = new Uint8Array(await input.proof.arrayBuffer());
    const extension = (input.proof.name.split('.').pop() ?? '').toLowerCase().replace('jpeg', 'jpg');
    ensure(['pdf', 'png', 'jpg'].includes(extension) && matchesFormat(bytes, extension), 400, 'Preuve : PDF, PNG ou JPG');
    ensure(bytes.byteLength <= 5 * 1024 * 1024, 413, 'Preuve de 5 Mo au plus');
    proof = { name: input.proof.name.slice(0, 200), sha: createHash('sha256').update(bytes).digest('hex'), bytes: Buffer.from(bytes) };
  }
  return transaction(settings, 'unoa.exn.verify', async store => {
    const { rows: [evidence] } = await store.query<{ id: string; state: string; participation_id: string; scope_id: string; account_id: string; title: string }>(`
      SELECT evidence.id, evidence.state, evidence.participation_id, exam.scope_id, participation.account_id, exam.title FROM unoa.external_evidence AS evidence
      JOIN unoa.external_participation AS participation ON participation.id = evidence.participation_id JOIN unoa.external_exam AS exam ON exam.id = participation.exam_id
      WHERE evidence.id = $1 FOR UPDATE OF evidence`, [uuid(input.evidenceId)]);
    ensure(evidence, 404, 'Pièce introuvable');
    await require(store, actor, evidence.scope_id, 'verify');
    ensure(!['verified', 'rejected'].includes(evidence.state), 409, 'Vérification déjà close');
    ensure(step !== 'in_review' || evidence.state === 'deposited', 409, 'Vérification déjà en cours');
    // A positive verification states how the authority confirmed the document.
    ensure(step !== 'verified' || method !== 'other' || proof, 422, 'Une vérification positive par « autre » méthode exige une preuve jointe');
    await store.query(`INSERT INTO unoa.external_verification(evidence_id, step, method, note, verifier_id, proof_filename, proof_sha256, proof_content)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [evidence.id, step, method, boundedText(input.note, 2000, 'Constat'), actor, proof?.name ?? null, proof?.sha ?? null, proof?.bytes ?? null]);
    await store.query('UPDATE unoa.external_evidence SET state = $2 WHERE id = $1', [evidence.id, step]);
    await event(store, evidence.participation_id, 'evidence_' + step, actor, methodLabels[method]);
    await audit(store, actor, evidence.scope_id, 'exn.evidence_' + step, correlation, evidence.id);
    if (step !== 'in_review') {
      await dispatch(store, { event: 'exn.verified', scopeId: evidence.scope_id, recipients: [evidence.account_id], correlation,
        values: { exam: evidence.title, state: evidenceStates[step].toLowerCase() }, link: '/examens-nationaux/suivi' });
    }
    return { scopeId: evidence.scope_id, evidenceId: evidence.id };
  });
}

export async function exnContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`
    SELECT scope.id, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature IN ('territory', 'jurisdiction', 'institution') AND unoa.has_scope_permission($1, 'exn.read', scope.id) ORDER BY kind.nature, scope.label LIMIT 200`, [actor]);
  return rows;
}

export async function exnOverview(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  const granted = await require(store, actor, scopeId, 'read');
  const [label, exams, evidence] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]),
    store.query<{ id: string; title: string; authority: string; session_label: string; state: string; official_url: string | null; declarations: number }>(`
      SELECT exam.id, exam.title, exam.authority, exam.session_label, exam.state, exam.official_url,
        (SELECT count(*)::int FROM unoa.external_participation WHERE exam_id = exam.id AND withdrawn_at IS NULL) AS declarations
      FROM unoa.external_exam AS exam WHERE unoa.scope_within(exam.scope_id, $1) ORDER BY exam.created_at DESC LIMIT 200`, [scopeId]),
    store.query<{ id: string; kind: string; issuing_authority: string; document_reference: string | null; stated_outcome: string | null; filename: string; sha256: string;
      state: string; deposited_at: Date; name: string | null; exam: string; candidate_number: string | null;
      checks: { id: string; step: string; method: string; note: string; verifier: string | null; at: string; proof: string | null }[] }>(`
      SELECT evidence.id, evidence.kind, evidence.issuing_authority, evidence.document_reference, evidence.stated_outcome, evidence.filename, evidence.sha256,
        evidence.state, evidence.deposited_at, account.display_name AS name, exam.title AS exam, participation.candidate_number,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id', check_row.id, 'step', check_row.step, 'method', check_row.method, 'note', check_row.note, 'verifier', verifier.display_name,
          'at', check_row.created_at, 'proof', check_row.proof_sha256) ORDER BY check_row.created_at)
          FROM unoa.external_verification AS check_row JOIN unoa.account AS verifier ON verifier.id = check_row.verifier_id WHERE check_row.evidence_id = evidence.id), '[]') AS checks
      FROM unoa.external_evidence AS evidence JOIN unoa.external_participation AS participation ON participation.id = evidence.participation_id
      JOIN unoa.external_exam AS exam ON exam.id = participation.exam_id JOIN unoa.account ON account.id = participation.account_id
      WHERE unoa.scope_within(exam.scope_id, $1) ORDER BY (evidence.state IN ('deposited', 'in_review')) DESC, evidence.deposited_at DESC LIMIT 300`, [scopeId]),
  ]);
  ensure(label.rows[0], 404, 'Portée introuvable');
  return { scope: { id: scopeId, label: label.rows[0].label }, rights: granted, exams: exams.rows, evidence: evidence.rows };
}

// -------------------------------------------------------- declarant side

export async function mySpace(settings: IamSettings, actor: string) {
  const store = database(settings);
  const { rows } = await store.query<{ id: string; exam_id: string; title: string; authority: string; session_label: string; candidate_number: string | null; declared_at: Date;
    withdrawn_at: Date | null; evidence: { id: string; kind: string; issuing_authority: string; stated_outcome: string | null; state: string; deposited_at: string; filename: string }[];
    history: { kind: string; detail: string | null; at: string }[] }>(`
    SELECT participation.id, participation.exam_id, exam.title, exam.authority, exam.session_label, participation.candidate_number, participation.declared_at, participation.withdrawn_at,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'issuing_authority', issuing_authority, 'stated_outcome', stated_outcome, 'state', state,
        'deposited_at', deposited_at, 'filename', filename) ORDER BY deposited_at) FROM unoa.external_evidence WHERE participation_id = participation.id), '[]') AS evidence,
      coalesce((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'detail', detail, 'at', occurred_at) ORDER BY occurred_at) FROM unoa.external_event WHERE participation_id = participation.id), '[]') AS history
    FROM unoa.external_participation AS participation JOIN unoa.external_exam AS exam ON exam.id = participation.exam_id
    WHERE participation.account_id = $1 ORDER BY participation.declared_at DESC`, [actor]);
  // The only status ever shown: the verification of an official document, never a presumed success (EXN-010).
  return rows.map(row => {
    const verified = row.evidence.filter(item => item.state === 'verified');
    return { ...row, status: verified.length ? `Pièce vérifiée — ${verified.map(item => `${kindLabels[item.kind]} délivré par ${item.issuing_authority}`).join(' ; ')}` : notCommunicated };
  });
}

export async function declarantAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.exn.declarant.' + actor, async store => {
    if (action === 'declare') {
      const { rows: [exam] } = await store.query<{ id: string; scope_id: string }>("SELECT id, scope_id FROM unoa.external_exam WHERE id = $1 AND state = 'published'", [uuid(input.examId)]);
      ensure(exam, 404, 'Information introuvable ou non publiée');
      const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.external_participation(exam_id, account_id, candidate_number, statement) VALUES ($1, $2, $3, $4)
        ON CONFLICT (exam_id, account_id) DO UPDATE SET withdrawn_at = NULL, candidate_number = EXCLUDED.candidate_number, statement = EXCLUDED.statement RETURNING id`,
        [exam.id, actor, optional(input.candidateNumber, text(60, 'Numéro de candidat')), optional(input.statement, text(2000, 'Précisions'))]);
      await event(store, rows[0].id, 'declared', actor);
      await audit(store, actor, exam.scope_id, 'exn.declared', correlation, rows[0].id);
      return { participationId: rows[0].id };
    }
    if (action === 'withdraw') {
      const { rows } = await store.query<{ id: string }>('UPDATE unoa.external_participation SET withdrawn_at = now() WHERE id = $1 AND account_id = $2 AND withdrawn_at IS NULL RETURNING id',
        [uuid(input.participationId), actor]);
      ensure(rows[0], 404, 'Déclaration introuvable');
      await event(store, rows[0].id, 'withdrawn', actor);
      return { participationId: rows[0].id };
    }
    throw new Problem(404, 'Opération inconnue');
  });
}

export async function deposit(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const file = input.file;
  ensure(file instanceof File, 400, 'Fichier requis');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = (file.name.split('.').pop() ?? '').toLowerCase().replace('jpeg', 'jpg');
  ensure(['pdf', 'png', 'jpg'].includes(extension) && matchesFormat(bytes, extension), 400, 'Formats acceptés : PDF, PNG, JPG');
  ensure(bytes.byteLength > 0 && bytes.byteLength <= 5 * 1024 * 1024, 413, 'Fichier de 5 Mo au plus');
  return transaction(settings, 'unoa.exn.deposit.' + actor, async store => {
    const { rows: [participation] } = await store.query<{ id: string; account_id: string; withdrawn_at: Date | null; scope_id: string }>(`
      SELECT participation.id, participation.account_id, participation.withdrawn_at, exam.scope_id FROM unoa.external_participation AS participation
      JOIN unoa.external_exam AS exam ON exam.id = participation.exam_id WHERE participation.id = $1`, [uuid(input.participationId)]);
    ensure(participation, 404, 'Déclaration introuvable');
    ensure(participation.account_id === actor, 403, 'Dépôt réservé au déclarant');
    ensure(!participation.withdrawn_at, 409, 'Déclaration retirée');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const { rows: [duplicate] } = await store.query('SELECT 1 FROM unoa.external_evidence WHERE participation_id = $1 AND sha256 = $2', [participation.id, sha]);
    ensure(!duplicate, 409, 'Ce fichier a déjà été déposé');
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.external_evidence(participation_id, kind, issuing_authority, document_reference, stated_outcome,
      filename, format, size_bytes, sha256, content, deposited_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`, [participation.id,
      choice(input.kind, ['result', 'diploma'] as const, 'Type de pièce'), boundedText(input.issuingAuthority, 200, 'Autorité émettrice'),
      optional(input.documentReference, text(120, 'Référence du document')), optional(input.statedOutcome, text(200, 'Mention portée sur le document')),
      file.name.slice(0, 200), extension, bytes.byteLength, sha, Buffer.from(bytes), actor]);
    await event(store, participation.id, 'evidence_deposited', actor);
    await audit(store, actor, participation.scope_id, 'exn.evidence_deposited', correlation, rows[0].id);
    return { participationId: participation.id, evidenceId: rows[0].id };
  });
}

// File access: the declarant, or verifiers and readers of the exam scope (EXN-009).
export async function evidenceFile(settings: IamSettings, actor: string, id: string, proof = false) {
  const store = database(settings);
  const { rows: [found] } = await store.query<{ filename: string; format: string; content: Buffer; account_id: string; scope_id: string }>(proof ? `
    SELECT check_row.proof_filename AS filename, lower(split_part(check_row.proof_filename, '.', -1)) AS format, check_row.proof_content AS content, participation.account_id, exam.scope_id
    FROM unoa.external_verification AS check_row JOIN unoa.external_evidence AS evidence ON evidence.id = check_row.evidence_id
    JOIN unoa.external_participation AS participation ON participation.id = evidence.participation_id JOIN unoa.external_exam AS exam ON exam.id = participation.exam_id
    WHERE check_row.id = $1 AND check_row.proof_content IS NOT NULL` : `
    SELECT evidence.filename, evidence.format, evidence.content, participation.account_id, exam.scope_id FROM unoa.external_evidence AS evidence
    JOIN unoa.external_participation AS participation ON participation.id = evidence.participation_id JOIN unoa.external_exam AS exam ON exam.id = participation.exam_id
    WHERE evidence.id = $1`, [uuid(id)]);
  ensure(found, 404, 'Fichier introuvable');
  // Proofs of verification stay internal: only the verification team reads them.
  const granted = await rights(store, actor, found.scope_id);
  ensure(proof ? granted?.verify : found.account_id === actor || granted?.read, 403, 'Fichier réservé');
  return found;
}
