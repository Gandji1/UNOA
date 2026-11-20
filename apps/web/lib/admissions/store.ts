import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  cleanAnswers, completeness, FormError, matchesFormat, parseCriteria, parseDocuments, parseFields, weightedScore,
  type Criterion, type DocumentRule, type FormField,
} from '@unoa/domain/forms';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, ensure, optional, Problem, text, utcTime, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';

// Admissions (module ADM). Staff rights are checked on the owner scope of the
// programme; a candidate only reaches their own applications.

export const decisions = ['admitted', 'conditional', 'waitlisted', 'refused'] as const;
type Right = 'read' | 'manage' | 'review' | 'decide' | 'appeal';

function rules<T>(read: () => T) {
  try { return read(); } catch (error) {
    if (error instanceof FormError) throw new Problem(400, error.message);
    throw error;
  }
}

async function rights(store: Queryable, actor: string, scope: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`
    SELECT unoa.has_scope_permission($1, 'adm.read', $2) AS read, unoa.has_scope_permission($1, 'adm.manage', $2) AS manage,
           unoa.has_scope_permission($1, 'adm.review', $2) AS review, unoa.has_scope_permission($1, 'adm.decide', $2) AS decide,
           unoa.has_scope_permission($1, 'adm.appeal', $2) AS appeal
  `, [actor, scope]);
  return rows[0];
}

export interface RoundRow {
  id: string; version_id: string; label: string; opens_at: Date; closes_at: Date; form: FormField[]; documents: DocumentRule[];
  criteria: Criterion[]; instructions: string | null; state: string; program_id: string; program_code: string;
  program_title: string; owner_scope_id: string; owner_label: string;
}

const roundFields = `
  campaign.*, program.id AS program_id, program.code AS program_code, version.title AS program_title,
  program.owner_scope_id, owner.label AS owner_label
  FROM unoa.admission_round AS campaign
  JOIN unoa.program_version AS version ON version.id = campaign.version_id
  JOIN unoa.program ON program.id = version.program_id
  JOIN unoa.scope AS owner ON owner.id = program.owner_scope_id
`;

async function round(store: Queryable, roundId: string) {
  const { rows } = await store.query<RoundRow>(`SELECT ${roundFields} WHERE campaign.id = $1`, [roundId]);
  ensure(rows[0], 404, 'Campagne introuvable');
  return rows[0];
}

async function staffRound(store: Queryable, actor: string, roundId: string, right: Right) {
  const found = await round(store, roundId);
  const granted = await rights(store, actor, found.owner_scope_id);
  ensure(granted?.[right], 403, 'Action non autorisée pour cette campagne');
  return { round: found, rights: granted };
}

// ------------------------------------------------------------------ staff

export async function admissionsContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`
    SELECT scope.id, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature IN ('institution', 'academic_unit') AND unoa.has_scope_permission($1, 'adm.read', scope.id)
    ORDER BY kind.nature DESC, scope.label LIMIT 200
  `, [actor]);
  return rows;
}

export async function admissionsOverview(settings: IamSettings, actor: string, scopeId: string) {
  const store = database(settings);
  const granted = await rights(store, actor, uuid(scopeId));
  ensure(granted?.read, 403, 'Structure inaccessible');
  const [scope, versions, rounds] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]),
    store.query<{ id: string; title: string; code: string; number: number; admission_open: boolean; allowed: boolean }>(`
      SELECT version.id, version.title, program.code, version.number, version.admission_open,
             unoa.program_admission_allowed(program.id) AS allowed
      FROM unoa.program_version AS version JOIN unoa.program ON program.id = version.program_id
      WHERE version.state = 'published' AND unoa.scope_within(program.owner_scope_id, $1) ORDER BY program.code
    `, [scopeId]),
    store.query<{ id: string; label: string; state: string; opens_at: Date; closes_at: Date; program_code: string; counts: Record<string, number> }>(`
      SELECT campaign.id, campaign.label, campaign.state, campaign.opens_at, campaign.closes_at, program.code AS program_code,
        coalesce((SELECT jsonb_object_agg(state, total) FROM (SELECT state, count(*)::int AS total FROM unoa.application
          WHERE round_id = campaign.id AND state <> 'draft' GROUP BY state) AS tally), '{}') AS counts
      FROM unoa.admission_round AS campaign
      JOIN unoa.program_version AS version ON version.id = campaign.version_id
      JOIN unoa.program ON program.id = version.program_id
      WHERE unoa.scope_within(program.owner_scope_id, $1) ORDER BY campaign.opens_at DESC LIMIT 200
    `, [scopeId]),
  ]);
  return { scope: { id: scopeId, label: scope.rows[0]?.label ?? '' }, rights: granted, versions: versions.rows, rounds: rounds.rows };
}

function roundInput(input: Input) {
  return {
    label: boundedText(input.label, 200, 'Intitulé'),
    opensAt: utcTime(input.opensAt), closesAt: utcTime(input.closesAt),
    form: rules(() => parseFields(String(input.form ?? ''))),
    documents: rules(() => parseDocuments(String(input.documents ?? ''))),
    criteria: rules(() => parseCriteria(String(input.criteria ?? ''))),
    instructions: optional(input.instructions, text(4000, 'Consignes')),
  };
}

export async function createRound(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const versionId = uuid(input.versionId);
  const item = roundInput(input);
  ensure(item.form.length > 0, 400, 'Le formulaire doit comporter au moins un champ');
  return transaction(settings, 'unoa.adm.version.' + versionId, async store => {
    const { rows: owner } = await store.query<{ owner_scope_id: string }>(`
      SELECT program.owner_scope_id FROM unoa.program_version AS version JOIN unoa.program ON program.id = version.program_id WHERE version.id = $1
    `, [versionId]);
    ensure(owner[0], 404, 'Version introuvable');
    ensure((await rights(store, actor, owner[0].owner_scope_id))?.manage, 403, 'Gestion des campagnes non autorisée');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.admission_round(version_id, label, opens_at, closes_at, form, documents, criteria, instructions, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
    `, [versionId, item.label, item.opensAt, item.closesAt, JSON.stringify(item.form), JSON.stringify(item.documents),
      JSON.stringify(item.criteria), item.instructions, actor]);
    await audit(store, actor, owner[0].owner_scope_id, 'adm.round_created', correlation, rows[0].id);
    return { id: rows[0].id, scopeId: owner[0].owner_scope_id };
  });
}

export async function roundAction(settings: IamSettings, actor: string, id: string, action: string, correlation: string) {
  const roundId = uuid(id);
  ensure(action === 'open' || action === 'close', 404, 'Opération inconnue');
  return transaction(settings, 'unoa.adm.round.' + roundId, async store => {
    const { round: found } = await staffRound(store, actor, roundId, 'manage');
    await store.query(`UPDATE unoa.admission_round SET state = $2, opened_by = coalesce(opened_by, $3) WHERE id = $1`,
      [roundId, action === 'open' ? 'open' : 'closed', actor]);
    await audit(store, actor, found.owner_scope_id, 'adm.round_' + action, correlation, roundId);
    return { id: roundId, scopeId: found.owner_scope_id };
  });
}

export async function roundDetails(settings: IamSettings, actor: string, id: string, state?: string) {
  const store = database(settings);
  const { round: found, rights: granted } = await staffRound(store, actor, uuid(id), 'read');
  const { rows } = await store.query<{ id: string; receipt: string | null; state: string; decision: string | null; submitted_at: Date | null; applicant: string | null; score: string | null }>(`
    SELECT application.id, application.receipt, application.state, application.decision, application.submitted_at,
           application.answers->>(($3::jsonb)->0->>'key') AS applicant,
           (SELECT avg(score) FROM unoa.application_review WHERE application_id = application.id AND kind = 'academic') AS score
    FROM unoa.application WHERE round_id = $1 AND submitted_at IS NOT NULL AND ($2::text IS NULL OR state = $2)
    ORDER BY application.submitted_at NULLS LAST LIMIT 500
  `, [found.id, state ?? null, JSON.stringify(found.form)]);
  return { round: found, rights: granted, applications: rows };
}

// -------------------------------------------------------------- applicant

export async function myApplications(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; state: string; decision: string | null; receipt: string | null; label: string; program_title: string; closes_at: Date }>(`
    SELECT application.id, application.state, application.decision, application.receipt, campaign.label, version.title AS program_title, campaign.closes_at
    FROM unoa.application JOIN unoa.admission_round AS campaign ON campaign.id = application.round_id
    JOIN unoa.program_version AS version ON version.id = campaign.version_id
    WHERE application.applicant_id = $1 ORDER BY application.created_at DESC LIMIT 100
  `, [actor]);
  return rows;
}

export async function openRounds(settings: IamSettings, siteId: string, programId: string) {
  const { rows } = await database(settings).query<{ round_id: string; label: string; opens_at: Date; closes_at: Date; instructions: string | null }>(
    'SELECT * FROM unoa.public_rounds($1, $2)', [siteId, programId],
  );
  return rows;
}

export async function startApplication(settings: IamSettings, actor: string, id: string, correlation: string) {
  const roundId = uuid(id);
  return transaction(settings, 'unoa.adm.apply.' + roundId + actor, async store => {
    const found = await round(store, roundId);
    const existing = await store.query<{ id: string }>(
      "SELECT id FROM unoa.application WHERE round_id = $1 AND applicant_id = $2 AND state <> 'withdrawn'", [roundId, actor]);
    if (existing.rows[0]) return { id: existing.rows[0].id };
    const { rows } = await store.query<{ id: string }>(
      'INSERT INTO unoa.application(round_id, applicant_id) VALUES ($1, $2) RETURNING id', [roundId, actor]);
    await audit(store, actor, found.owner_scope_id, 'adm.application_started', correlation, rows[0].id);
    return { id: rows[0].id };
  });
}

interface ApplicationRow {
  id: string; round_id: string; applicant_id: string; state: string; answers: Record<string, string>; receipt: string | null;
  submitted_at: Date | null; revision: number; decision: string | null;
}

async function access(store: Queryable, actor: string, applicationId: string, staffRight?: Right) {
  const { rows } = await store.query<ApplicationRow>('SELECT * FROM unoa.application WHERE id = $1', [applicationId]);
  ensure(rows[0], 404, 'Candidature introuvable');
  const found = await round(store, rows[0].round_id);
  const granted = await rights(store, actor, found.owner_scope_id);
  const own = rows[0].applicant_id === actor;
  if (staffRight) ensure(granted?.[staffRight], 403, 'Action réservée aux services habilités');
  else ensure(own || granted?.read, 403, 'Candidature inaccessible');
  return { application: rows[0], round: found, rights: granted, own };
}

async function lock(store: PoolClient, applicationId: string) {
  await store.query('SELECT 1 FROM unoa.application WHERE id = $1 FOR UPDATE', [applicationId]);
}

export async function applicationView(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const found = await access(store, actor, uuid(id));
  const staff = !!found.rights?.read;
  const [documents, requests, interviews, decisionsRows, appeals, reviews, revisions] = await Promise.all([
    store.query<{ id: string; document_key: string; filename: string; format: string; size_bytes: number; sha256: string; state: string; note: string | null; uploaded_at: Date }>(
      'SELECT id, document_key, filename, format, size_bytes, sha256, state, note, uploaded_at FROM unoa.application_document WHERE application_id = $1 ORDER BY uploaded_at DESC', [found.application.id]),
    store.query<{ id: string; message: string; requested_at: Date; answered_at: Date | null }>(
      'SELECT id, message, requested_at, answered_at FROM unoa.application_request WHERE application_id = $1 ORDER BY requested_at', [found.application.id]),
    store.query<{ id: string; kind: string; scheduled_at: Date; place: string; outcome: string | null }>(
      'SELECT id, kind, scheduled_at, place, outcome FROM unoa.application_interview WHERE application_id = $1 ORDER BY scheduled_at', [found.application.id]),
    store.query<{ id: string; decision: string; reason: string; conditions: string | null; decided_at: Date; decided_by: string }>(
      'SELECT id, decision, reason, conditions, decided_at, decided_by FROM unoa.application_decision WHERE application_id = $1 ORDER BY decided_at', [found.application.id]),
    store.query<{ id: string; reason: string; state: string; filed_at: Date; ruling: string | null }>(
      'SELECT id, reason, state, filed_at, ruling FROM unoa.application_appeal WHERE application_id = $1 ORDER BY filed_at', [found.application.id]),
    staff ? store.query<{ id: string; kind: string; reviewer_id: string; score: string | null; recommendation: string; note: string; created_at: Date; scores: Record<string, number> }>(
      'SELECT id, kind, reviewer_id, score, recommendation, note, created_at, scores FROM unoa.application_review WHERE application_id = $1 ORDER BY created_at', [found.application.id])
      : Promise.resolve({ rows: [] }),
    store.query<{ revision: number; submitted_at: Date }>(
      'SELECT revision, submitted_at FROM unoa.application_revision WHERE application_id = $1 ORDER BY revision', [found.application.id]),
  ]);
  const current = documents.rows.filter(item => item.state !== 'replaced');
  return {
    ...found, staff, documents: current, history: documents.rows.filter(item => item.state === 'replaced'),
    requests: requests.rows, interviews: interviews.rows, decisions: decisionsRows.rows, appeals: appeals.rows,
    reviews: reviews.rows, revisions: revisions.rows,
    completeness: completeness(found.round.form, found.round.documents, found.application.answers,
      current.map(item => ({ key: item.document_key, state: item.state }))),
  };
}

async function notifyApplicant(store: Queryable, campaign: RoundRow, applicant: string, event: string,
  values: Record<string, string | null>, applicationId: string, correlation: string) {
  await dispatch(store, { event, scopeId: campaign.owner_scope_id, recipients: [applicant],
    values: { program: campaign.program_title, ...values }, link: '/candidature/' + applicationId, correlation });
}

export async function applicantAction(settings: IamSettings, actor: string, id: string, action: string, input: Input, correlation: string) {
  const applicationId = uuid(id);
  return transaction(settings, 'unoa.adm.application.' + applicationId, async store => {
    await lock(store, applicationId);
    const found = await access(store, actor, applicationId);
    ensure(found.own, 403, 'Seul le candidat agit sur sa candidature');
    const { application, round: campaign } = found;
    if (action === 'answers') {
      ensure(['draft', 'incomplete'].includes(application.state), 409, 'Candidature non modifiable');
      const answers = rules(() => cleanAnswers(campaign.form, input));
      await store.query('UPDATE unoa.application SET answers = $2 WHERE id = $1', [applicationId, JSON.stringify(answers)]);
    } else if (action === 'submit') {
      ensure(['draft', 'incomplete'].includes(application.state), 409, 'Candidature déjà déposée');
      const { rows: documents } = await store.query<{ document_key: string; state: string; sha256: string }>(
        "SELECT document_key, state, sha256 FROM unoa.application_document WHERE application_id = $1 AND state <> 'replaced'", [applicationId]);
      const state = completeness(campaign.form, campaign.documents, application.answers, documents.map(item => ({ key: item.document_key, state: item.state })));
      ensure(state.complete, 422, 'Dossier incomplet : ' + [...state.missingFields, ...state.missingDocuments].join(', '));
      const receipt = application.receipt ?? 'ADM-' + new Date().getUTCFullYear() + '-' + randomBytes(6).toString('hex').toUpperCase();
      const revision = application.revision + 1;
      await store.query(`UPDATE unoa.application SET state = 'submitted', receipt = $2, revision = $3, submitted_at = now() WHERE id = $1`,
        [applicationId, receipt, revision]);
      await store.query('INSERT INTO unoa.application_revision(application_id, revision, answers, documents) VALUES ($1, $2, $3, $4)',
        [applicationId, revision, JSON.stringify(application.answers), JSON.stringify(documents)]);
      await store.query('UPDATE unoa.application_request SET answered_at = now() WHERE application_id = $1 AND answered_at IS NULL', [applicationId]);
      await notifyApplicant(store, campaign, actor, 'adm.receipt', { receipt, revision: String(revision) }, applicationId, correlation);
    } else if (action === 'withdraw') {
      await store.query("UPDATE unoa.application SET state = 'withdrawn' WHERE id = $1", [applicationId]);
    } else if (action === 'accept' || action === 'decline') {
      ensure(application.state === 'decided', 409, 'Aucune décision à accepter');
      await store.query('UPDATE unoa.application SET state = $2 WHERE id = $1', [applicationId, action === 'accept' ? 'accepted' : 'declined']);
    } else if (action === 'appeal') {
      ensure(application.state === 'decided', 409, 'Le recours porte sur une décision');
      const { rows } = await store.query<{ id: string }>(
        'SELECT id FROM unoa.application_decision WHERE application_id = $1 ORDER BY decided_at DESC LIMIT 1', [applicationId]);
      await store.query('INSERT INTO unoa.application_appeal(application_id, decision_id, reason) VALUES ($1, $2, $3)',
        [applicationId, rows[0].id, boundedText(input.reason, 4000, 'Motif du recours')]);
    } else {
      throw new Problem(404, 'Opération inconnue');
    }
    await audit(store, actor, campaign.owner_scope_id, 'adm.application_' + action, correlation, applicationId);
    return { id: applicationId };
  });
}

export async function uploadDocument(settings: IamSettings, actor: string, id: string, key: string, file: File, correlation: string) {
  const applicationId = uuid(id);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return transaction(settings, 'unoa.adm.application.' + applicationId, async store => {
    await lock(store, applicationId);
    const found = await access(store, actor, applicationId);
    ensure(found.own, 403, 'Seul le candidat dépose ses pièces');
    const rule = found.round.documents.find(item => item.key === key);
    ensure(rule, 400, 'Pièce non prévue par la campagne');
    const extension = (file.name.split('.').pop() ?? '').toLowerCase().replace('jpeg', 'jpg');
    ensure(rule.formats.includes(extension) && matchesFormat(bytes, extension), 400, 'Format refusé : ' + rule.formats.join(', '));
    ensure(bytes.byteLength > 0 && bytes.byteLength <= rule.maxKb * 1024, 413, 'Fichier trop volumineux');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await store.query(`UPDATE unoa.application_document SET state = 'replaced' WHERE application_id = $1 AND document_key = $2 AND state <> 'replaced'`, [applicationId, key]);
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.application_document(application_id, document_key, filename, format, size_bytes, sha256, content)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [applicationId, key, file.name.slice(0, 200), extension, bytes.byteLength, sha256, Buffer.from(bytes)]);
    await audit(store, actor, found.round.owner_scope_id, 'adm.document_deposited', correlation, rows[0].id);
    return { id: applicationId, document: rows[0].id, sha256 };
  });
}

export async function documentContent(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const { rows } = await store.query<{ application_id: string; filename: string; format: string; content: Buffer }>(
    'SELECT application_id, filename, format, content FROM unoa.application_document WHERE id = $1', [uuid(id)]);
  ensure(rows[0], 404, 'Pièce introuvable');
  await access(store, actor, rows[0].application_id);
  return rows[0];
}

// ------------------------------------------------------------- instruction

export async function staffAction(settings: IamSettings, actor: string, id: string, action: string, input: Input, correlation: string) {
  const applicationId = uuid(id);
  const right: Right = action === 'decide' ? 'decide' : action === 'rule' ? 'appeal' : 'review';
  return transaction(settings, 'unoa.adm.application.' + applicationId, async store => {
    await lock(store, applicationId);
    const found = await access(store, actor, applicationId, right);
    const { application, round: campaign } = found;
    const open = ['submitted', 'review'].includes(application.state);
    if (action === 'document') {
      const state = choice(input.state, ['verified', 'rejected'] as const, 'Contrôle');
      const note = optional(input.note, text(500, 'Observation'));
      ensure(state === 'verified' || note, 400, 'Motiver le rejet de la pièce');
      const updated = await store.query(`UPDATE unoa.application_document SET state = $3, note = $4, checked_by = $5
        WHERE id = $1 AND application_id = $2 AND state IN ('deposited', 'verified', 'rejected')`,
        [uuid(input.documentId), applicationId, state, note, actor]);
      ensure(updated.rowCount === 1, 404, 'Pièce introuvable');
    } else if (action === 'request') {
      ensure(open, 409, 'Candidature hors instruction');
      const message = boundedText(input.message, 2000, 'Demande');
      await store.query('INSERT INTO unoa.application_request(application_id, message, requested_by) VALUES ($1, $2, $3)', [applicationId, message, actor]);
      await store.query("UPDATE unoa.application SET state = 'incomplete' WHERE id = $1", [applicationId]);
      await notifyApplicant(store, campaign, application.applicant_id, 'adm.complement', { message }, applicationId, correlation);
    } else if (action === 'review') {
      ensure(open, 409, 'Candidature hors instruction');
      const kind = choice(input.kind, ['administrative', 'academic'] as const, 'Instruction');
      const scores = typeof input.scores === 'object' && input.scores ? input.scores as Record<string, unknown>
        : Object.fromEntries(campaign.criteria.map(item => [item.key, input['score_' + item.key]]));
      const score = kind === 'academic' ? rules(() => weightedScore(campaign.criteria, scores)) : null;
      await store.query(`INSERT INTO unoa.application_review(application_id, kind, reviewer_id, scores, score, recommendation, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`, [applicationId, kind, actor,
        JSON.stringify(kind === 'academic' ? Object.fromEntries(campaign.criteria.map(item => [item.key, Number(scores[item.key])])) : {}),
        score, choice(input.recommendation, ['favourable', 'reserved', 'unfavourable'] as const, 'Avis'), boundedText(input.note, 2000, 'Observation')]);
      if (application.state === 'submitted') await store.query("UPDATE unoa.application SET state = 'review' WHERE id = $1", [applicationId]);
    } else if (action === 'interview') {
      ensure(open, 409, 'Candidature hors instruction');
      await store.query(`INSERT INTO unoa.application_interview(application_id, kind, scheduled_at, place, outcome, scheduled_by)
        VALUES ($1, $2, $3, $4, $5, $6)`, [applicationId, boundedText(input.kind, 120, 'Nature'), utcTime(input.scheduledAt),
        boundedText(input.place, 500, 'Lieu ou lien'), optional(input.outcome, text(2000, 'Résultat')), actor]);
      await notifyApplicant(store, campaign, application.applicant_id, 'adm.interview', { kind: String(input.kind).slice(0, 100), place: String(input.place).slice(0, 500) }, applicationId, correlation);
    } else if (action === 'decide') {
      ensure(open, 409, 'Candidature hors instruction');
      const { rows: reviewed } = await store.query('SELECT 1 FROM unoa.application_review WHERE application_id = $1 LIMIT 1', [applicationId]);
      ensure(reviewed[0], 422, 'Une décision suit une instruction');
      const decision = choice(input.decision, decisions, 'Décision');
      const conditions = decision === 'conditional' ? boundedText(input.conditions, 2000, 'Conditions') : null;
      const { rows: prior } = await store.query<{ id: string }>(
        'SELECT id FROM unoa.application_decision WHERE application_id = $1 ORDER BY decided_at DESC LIMIT 1', [applicationId]);
      await store.query(`INSERT INTO unoa.application_decision(application_id, decision, reason, conditions, decided_by, supersedes)
        VALUES ($1, $2, $3, $4, $5, $6)`, [applicationId, decision, boundedText(input.reason, 2000, 'Motif'), conditions, actor, prior[0]?.id ?? null]);
      await store.query("UPDATE unoa.application SET state = 'decided', decision = $2 WHERE id = $1", [applicationId, decision]);
      await notifyApplicant(store, campaign, application.applicant_id, 'adm.decision', {}, applicationId, correlation);
    } else if (action === 'rule') {
      const ruling = choice(input.ruling, ['upheld', 'granted'] as const, 'Décision sur recours');
      const updated = await store.query(`UPDATE unoa.application_appeal SET state = $2, ruled_by = $3, ruled_at = now(), ruling = $4
        WHERE application_id = $1 AND state = 'submitted'`, [applicationId, ruling, actor, boundedText(input.note, 2000, 'Motif')]);
      ensure(updated.rowCount === 1, 404, 'Aucun recours en attente');
      // A granted appeal reopens the instruction; the prior decision stays in the history.
      if (ruling === 'granted') await store.query("UPDATE unoa.application SET state = 'review', decision = NULL WHERE id = $1", [applicationId]);
      await notifyApplicant(store, campaign, application.applicant_id, 'adm.appeal_ruled', { outcome: ruling === 'granted' ? 'Recours accueilli : réexamen' : 'Décision maintenue' }, applicationId, correlation);
    } else {
      throw new Problem(404, 'Opération inconnue');
    }
    await audit(store, actor, campaign.owner_scope_id, 'adm.' + action, correlation, applicationId);
    return { id: applicationId };
  });
}
