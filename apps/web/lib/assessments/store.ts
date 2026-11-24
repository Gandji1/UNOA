import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { matchesFormat } from '@unoa/domain/forms';
import { AssessmentError, autoKinds, autoScore, draw, needsModeration, parseQuestion, type QuestionDefinition, type QuestionKind } from '@unoa/domain/assessment';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, ensure, flag, integer, numeric, optional, Problem, text, utcTime, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';

// Internal assessments (module ASS). Staff act through scope permissions on the
// offering's owner scope; an offering's teacher authors and grades its
// assessments; a tutor grades; a learner takes them. Subjects never leave the
// server with their answers, copies are frozen at submission.

const kinds = ['single', 'multiple', 'matching', 'numeric', 'text', 'code', 'file'] as const;
const assessmentKinds = ['quiz', 'assignment', 'exam'] as const;
export const assessmentKindLabels: Record<string, string> = { quiz: 'Quiz', assignment: 'Devoir', exam: 'Examen' };

export interface Access {
  offeringId: string; scopeId: string; label: string; course: string; timeZone: string; role: string | null;
  read: boolean; author: boolean; grade: boolean; moderate: boolean; integrity: boolean;
}

async function access(store: Queryable, actor: string, offeringId: string): Promise<Access> {
  const { rows } = await store.query<{ scope_id: string; label: string; course: string; time_zone: string; role: string | null;
    read: boolean; author: boolean; grade: boolean; moderate: boolean; integrity: boolean }>(`
    SELECT offering.owner_scope_id AS scope_id, offering.label, version.title AS course, offering.time_zone, unoa.offering_role(offering.id, $1) AS role,
      unoa.has_scope_permission($1, 'ass.read', offering.owner_scope_id) AS read, unoa.has_scope_permission($1, 'ass.author', offering.owner_scope_id) AS author,
      unoa.has_scope_permission($1, 'ass.grade', offering.owner_scope_id) AS grade, unoa.has_scope_permission($1, 'ass.moderate', offering.owner_scope_id) AS moderate,
      unoa.has_scope_permission($1, 'ass.integrity', offering.owner_scope_id) AS integrity
    FROM unoa.course_offering AS offering JOIN unoa.course_version AS version ON version.id = offering.course_version_id WHERE offering.id = $2`, [actor, uuid(offeringId)]);
  const row = rows[0];
  ensure(row, 404, 'Offre de cours introuvable');
  const teacher = row.role === 'teacher';
  const tutor = row.role === 'tutor';
  return { offeringId, scopeId: row.scope_id, label: row.label, course: row.course, timeZone: row.time_zone, role: row.role,
    read: row.read || teacher || tutor, author: row.author || teacher, grade: row.grade || teacher || tutor, moderate: row.moderate, integrity: row.integrity };
}
const staffOnly = (granted: Access, right: 'read' | 'author' | 'grade' | 'moderate' | 'integrity') =>
  ensure(granted[right], 403, 'Action réservée à l’équipe pédagogique habilitée');

interface AssessmentRow {
  id: string; offering_id: string; title: string; kind: string; team: boolean; instructions: string | null; opens_at: Date; closes_at: Date;
  duration_minutes: number | null; attempts_allowed: number; draw_count: number | null; rubric: { criterion: string; points: number }[];
  double_grading: boolean; state: string;
}
async function assessmentOf(store: Queryable, id: string, lock = false) {
  const { rows } = await store.query<AssessmentRow>(`SELECT * FROM unoa.assessment WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [uuid(id)]);
  ensure(rows[0], 404, 'Évaluation introuvable');
  return rows[0];
}

const definition = (row: { kind: QuestionKind; choices: string[]; answer: unknown; points: string | number }): QuestionDefinition =>
  ({ kind: row.kind, choices: row.choices, answer: row.answer, points: Number(row.points) });
const rubricTotal = (rubric: { points: number }[]) => rubric.reduce((sum, item) => sum + Number(item.points), 0);
const round = (value: number) => Math.round(value * 100) / 100;

// -------------------------------------------------------------- authoring

export async function authorAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.ass.author', async store => {
    const granted = await access(store, actor, String(input.offeringId ?? ''));
    staffOnly(granted, 'author');
    const result = await authoring(store, actor, granted, action, input);
    await audit(store, actor, granted.scopeId, 'ass.' + action.replace(/-/g, '_'), correlation, result.subject ?? null);
    if (action === 'publish') {
      const assessment = await assessmentOf(store, String(input.assessmentId));
      const { rows } = await store.query<{ account_id: string }>("SELECT DISTINCT account_id FROM unoa.offering_member WHERE offering_id = $1 AND role = 'learner' AND removed_at IS NULL", [granted.offeringId]);
      await dispatch(store, { event: 'ass.published', scopeId: granted.scopeId, recipients: rows.map(row => row.account_id), correlation,
        values: { title: assessment.title, course: granted.course, opens: assessment.opens_at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
          closes: assessment.closes_at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' }, link: '/evaluations' });
    }
    return { offeringId: granted.offeringId, ...result };
  });
}

async function bankOf(store: Queryable, granted: Access, id: unknown) {
  const { rows } = await store.query<{ id: string }>('SELECT id FROM unoa.question_bank WHERE id = $1 AND scope_id = $2', [uuid(id), granted.scopeId]);
  ensure(rows[0], 404, 'Banque introuvable dans cet établissement');
  return rows[0].id;
}
function parse(kind: QuestionKind, input: Input) {
  try {
    return parseQuestion(kind, String(input.source ?? ''), numeric(input.points));
  } catch (error) {
    if (error instanceof AssessmentError) throw new Problem(400, error.message);
    throw error;
  }
}
function rubric(input: unknown) {
  if (input === undefined || input === null || input === '') return [];
  const lines = String(input).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  ensure(lines.length <= 20, 400, 'Vingt critères au plus');
  return lines.map(line => {
    const match = line.match(/^(.{1,200}?)\s*[:=]\s*(\d+(?:[.,]\d+)?)$/);
    ensure(match, 400, 'Critère « libellé : points » attendu');
    const points = Number(match[2].replace(',', '.'));
    ensure(points > 0 && points <= 1000, 400, 'Points de critère invalides');
    return { criterion: match[1], points };
  });
}

async function authoring(store: Queryable, actor: string, granted: Access, action: string, input: Input): Promise<{ subject?: string; [key: string]: unknown }> {
  if (action === 'banks') {
    const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.question_bank(scope_id, title, created_by) VALUES ($1, $2, $3) RETURNING id',
      [granted.scopeId, boundedText(input.title, 200, 'Titre de la banque'), actor]);
    return { subject: rows[0].id, bankId: rows[0].id };
  }
  if (action === 'questions') {
    const bankId = await bankOf(store, granted, input.bankId);
    const kind = choice(input.kind, kinds, 'Type de question');
    const parsed = parse(kind, input);
    const lineage = randomUUID();
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.question(bank_id, lineage, version, kind, prompt, choices, answer, points, tags, author_id)
      VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [bankId, lineage, kind, boundedText(input.prompt, 6000, 'Énoncé'),
      JSON.stringify(parsed.choices), JSON.stringify(parsed.answer), parsed.points, optional(input.tags, text(200, 'Mots-clés')), actor]);
    return { subject: rows[0].id, questionId: rows[0].id };
  }
  if (action === 'revise') {
    const { rows: [current] } = await store.query<{ id: string; bank_id: string; lineage: string; version: number; kind: QuestionKind; tags: string | null }>(`
      SELECT question.id, question.bank_id, question.lineage, question.version, question.kind, question.tags FROM unoa.question
      JOIN unoa.question_bank AS bank ON bank.id = question.bank_id WHERE question.id = $1 AND bank.scope_id = $2 AND question.retired_at IS NULL FOR UPDATE OF question`,
      [uuid(input.questionId), granted.scopeId]);
    ensure(current, 404, 'Question introuvable ou retirée');
    const { rows: [latest] } = await store.query('SELECT 1 FROM unoa.question WHERE lineage = $1 AND version > $2', [current.lineage, current.version]);
    ensure(!latest, 409, 'Une version plus récente existe');
    const parsed = parse(current.kind, input);
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.question(bank_id, lineage, version, kind, prompt, choices, answer, points, tags, author_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [current.bank_id, current.lineage, current.version + 1, current.kind,
      boundedText(input.prompt, 6000, 'Énoncé'), JSON.stringify(parsed.choices), JSON.stringify(parsed.answer), parsed.points, current.tags, actor]);
    await store.query('UPDATE unoa.question SET retired_at = now() WHERE id = $1', [current.id]);
    return { subject: rows[0].id, questionId: rows[0].id };
  }
  if (action === 'retire') {
    const { rowCount } = await store.query(`UPDATE unoa.question SET retired_at = now() FROM unoa.question_bank AS bank
      WHERE question.id = $1 AND bank.id = question.bank_id AND bank.scope_id = $2 AND question.retired_at IS NULL`, [uuid(input.questionId), granted.scopeId]);
    ensure(rowCount, 404, 'Question introuvable ou déjà retirée');
    return { subject: String(input.questionId) };
  }
  if (action === 'assessments') {
    const opens = utcTime(input.opensAt);
    const closes = utcTime(input.closesAt);
    ensure(closes > opens, 400, 'La fermeture suit l’ouverture');
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.assessment(offering_id, title, kind, team, instructions, opens_at, closes_at, duration_minutes,
      attempts_allowed, draw_count, rubric, double_grading, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`, [
      granted.offeringId, boundedText(input.title, 200, 'Titre'), choice(input.kind, assessmentKinds, 'Type d’évaluation'), flag(input.team),
      optional(input.instructions, text(6000, 'Consignes')), opens, closes, optional(input.durationMinutes, value => integer(value, 'Durée', 1, 600)),
      input.attemptsAllowed ? integer(input.attemptsAllowed, 'Tentatives', 1, 20) : 1, optional(input.drawCount, value => integer(value, 'Tirage', 1, 500)),
      JSON.stringify(rubric(input.rubric)), flag(input.doubleGrading), actor]);
    return { subject: rows[0].id, assessmentId: rows[0].id };
  }
  const assessment = await assessmentOf(store, String(input.assessmentId), true);
  ensure(assessment.offering_id === granted.offeringId, 404, 'Évaluation introuvable dans cette offre');
  if (action === 'add-question' || action === 'remove-question') {
    ensure(assessment.state === 'draft', 409, 'Le sujet publié est figé');
    const questionId = uuid(input.questionId);
    if (action === 'remove-question') {
      await store.query('DELETE FROM unoa.assessment_question WHERE assessment_id = $1 AND question_id = $2', [assessment.id, questionId]);
    } else {
      const { rows } = await store.query(`SELECT 1 FROM unoa.question JOIN unoa.question_bank AS bank ON bank.id = question.bank_id
        WHERE question.id = $1 AND bank.scope_id = $2 AND question.retired_at IS NULL`, [questionId, granted.scopeId]);
      ensure(rows[0], 404, 'Question introuvable ou retirée');
      await store.query(`INSERT INTO unoa.assessment_question(assessment_id, question_id, ordinal)
        VALUES ($1, $2, (SELECT coalesce(max(ordinal), 0) + 1 FROM unoa.assessment_question WHERE assessment_id = $1)) ON CONFLICT DO NOTHING`, [assessment.id, questionId]);
    }
    return { subject: assessment.id, assessmentId: assessment.id };
  }
  if (action === 'publish') {
    ensure(assessment.state === 'draft', 409, 'Évaluation déjà publiée');
    const { rows: [count] } = await store.query<{ total: number }>('SELECT count(*)::int AS total FROM unoa.assessment_question WHERE assessment_id = $1', [assessment.id]);
    ensure(count.total > 0 || assessment.rubric.length > 0, 422, 'Ajoutez des questions ou une grille de critères');
    ensure(!assessment.draw_count || assessment.draw_count <= count.total, 422, 'Le tirage dépasse le nombre de questions');
    ensure(assessment.closes_at.getTime() > Date.now(), 422, 'La fermeture est déjà passée');
    await store.query("UPDATE unoa.assessment SET state = 'published', published_at = now() WHERE id = $1", [assessment.id]);
    return { subject: assessment.id, assessmentId: assessment.id };
  }
  if (action === 'close') {
    ensure(assessment.state === 'published', 409, 'Seule une évaluation publiée se clôt');
    await store.query("UPDATE unoa.assessment SET state = 'closed' WHERE id = $1", [assessment.id]);
    return { subject: assessment.id, assessmentId: assessment.id };
  }
  if (action === 'accommodations') {
    const accountId = uuid(input.accountId);
    ensure(await store.query("SELECT 1 FROM unoa.offering_member WHERE offering_id = $1 AND account_id = $2 AND role = 'learner' AND removed_at IS NULL",
      [granted.offeringId, accountId]).then(result => result.rows[0]), 422, 'L’aménagement concerne un apprenant de l’offre');
    const minutes = input.extraMinutes ? integer(input.extraMinutes, 'Temps supplémentaire', 0, 600) : 0;
    const days = input.extraDays ? integer(input.extraDays, 'Délai supplémentaire', 0, 60) : 0;
    ensure(minutes > 0 || days > 0, 400, 'Temps ou délai supplémentaire requis');
    await store.query(`INSERT INTO unoa.accommodation(assessment_id, account_id, extra_minutes, extra_days, reason, granted_by) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (assessment_id, account_id) DO UPDATE SET extra_minutes = EXCLUDED.extra_minutes, extra_days = EXCLUDED.extra_days, reason = EXCLUDED.reason,
        granted_by = EXCLUDED.granted_by, granted_at = now()`, [assessment.id, accountId, minutes, days, boundedText(input.reason, 1000, 'Justification'), actor]);
    return { subject: assessment.id, assessmentId: assessment.id };
  }
  throw new Problem(404, 'Opération inconnue');
}

// ---------------------------------------------------------------- learner

async function learnerOf(store: Queryable, actor: string, assessment: AssessmentRow) {
  const { rows } = await store.query("SELECT 1 FROM unoa.offering_member WHERE offering_id = $1 AND account_id = $2 AND role = 'learner' AND removed_at IS NULL",
    [assessment.offering_id, actor]);
  ensure(rows[0], 403, 'Évaluation réservée aux apprenants de l’offre');
}
async function ownAttempt(store: Queryable, actor: string, id: unknown) {
  const { rows } = await store.query<{ id: string; assessment_id: string; account_id: string; team_members: string[]; questions: string[]; answers: Record<string, unknown>;
    deadline: Date; state: string; receipt: string | null; submitted_at: Date | null }>('SELECT * FROM unoa.attempt WHERE id = $1 FOR UPDATE', [uuid(id)]);
  ensure(rows[0], 404, 'Copie introuvable');
  ensure(rows[0].account_id === actor || rows[0].team_members.includes(actor), 403, 'Copie d’un autre apprenant');
  return rows[0];
}

// Answers from a JSON body ({ answers: { questionId: value } }) or a form ("q.<id>" and "q.<id>.<index>").
function answersFrom(input: Input, questions: string[]) {
  const answers: Record<string, unknown> = {};
  const given = input.answers && typeof input.answers === 'object' ? input.answers as Record<string, unknown> : null;
  for (const id of questions) {
    if (given) { if (id in given) answers[id] = given[id]; continue; }
    if (typeof input['q.' + id] === 'string') answers[id] = input['q.' + id];
    const parts = Object.keys(input).filter(key => key.startsWith('q.' + id + '.')).map(key => [Number(key.split('.')[2]), input[key]] as const)
      .filter(([index]) => Number.isInteger(index)).sort((a, b) => a[0] - b[0]);
    if (parts.length) answers[id] = parts.map(([index, value]) => value === 'on' ? index : value);
  }
  const size = JSON.stringify(answers).length;
  ensure(size <= 64_000, 413, 'Réponses trop volumineuses');
  for (const value of Object.values(answers)) {
    ensure(typeof value === 'string' || typeof value === 'number' || (Array.isArray(value) && value.length <= 50
      && value.every(item => typeof item === 'string' || typeof item === 'number')), 400, 'Réponse invalide');
  }
  return answers;
}

export async function learnerAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.ass.learner.' + actor, async store => {
    if (action === 'start') {
      const assessment = await assessmentOf(store, String(input.assessmentId), true);
      await learnerOf(store, actor, assessment);
      ensure(assessment.state === 'published', 409, 'Évaluation non ouverte');
      const { rows: [extra] } = await store.query<{ extra_minutes: number; extra_days: number }>(
        'SELECT extra_minutes, extra_days FROM unoa.accommodation WHERE assessment_id = $1 AND account_id = $2', [assessment.id, actor]);
      const closes = assessment.closes_at.getTime() + (extra?.extra_days ?? 0) * 86_400_000;
      const now = Date.now();
      ensure(now >= assessment.opens_at.getTime(), 409, 'Évaluation pas encore ouverte');
      ensure(now < closes, 409, 'Évaluation fermée');
      const team = assessment.team ? boundedText(input.teamLabel, 120, 'Nom de l’équipe') : null;
      const { rows: open } = await store.query<{ id: string }>(`SELECT id FROM unoa.attempt WHERE assessment_id = $1 AND state = 'in_progress'
        AND (account_id = $2 OR $2 = ANY(team_members) OR ($3::text IS NOT NULL AND team_label = $3))`, [assessment.id, actor, team]);
      if (open[0]) {
        if (team) await store.query('UPDATE unoa.attempt SET team_members = array_append(team_members, $2) WHERE id = $1 AND NOT ($2 = ANY(team_members))', [open[0].id, actor]);
        return { attemptId: open[0].id };
      }
      const { rows: [done] } = await store.query<{ total: number }>(`SELECT count(*)::int AS total FROM unoa.attempt WHERE assessment_id = $1
        AND (account_id = $2 OR $2 = ANY(team_members) OR ($3::text IS NOT NULL AND team_label = $3))`, [assessment.id, actor, team]);
      ensure(done.total < assessment.attempts_allowed, 409, 'Nombre de tentatives atteint');
      const id = randomUUID();
      const { rows: subject } = await store.query<{ question_id: string }>('SELECT question_id FROM unoa.assessment_question WHERE assessment_id = $1 ORDER BY ordinal', [assessment.id]);
      const questions = draw(subject.map(row => row.question_id), assessment.draw_count, id);
      const limit = assessment.duration_minutes ? now + (assessment.duration_minutes + (extra?.extra_minutes ?? 0)) * 60_000 : closes;
      await store.query(`INSERT INTO unoa.attempt(id, assessment_id, account_id, number, team_label, team_members, questions, deadline) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, assessment.id, actor, done.total + 1, team, [actor], JSON.stringify(questions), new Date(Math.min(limit, closes))]).catch(error => {
        if (error?.code === '23505') throw new Problem(409, 'Une tentative de l’équipe est déjà en cours');
        throw error;
      });
      await audit(store, actor, null, 'ass.attempt_started', correlation, id);
      return { attemptId: id };
    }
    if (action === 'respond') return respond(store, actor, input, correlation);
    const attempt = await ownAttempt(store, actor, input.attemptId);
    if (action === 'save' || action === 'submit') {
      // Idempotent retry: an already submitted copy returns its receipt unchanged (ASS-010).
      if (attempt.state === 'submitted') {
        ensure(action === 'submit', 409, 'Copie déjà soumise');
        return { attemptId: attempt.id, receipt: attempt.receipt, submittedAt: attempt.submitted_at, replay: true };
      }
      ensure(Date.now() <= attempt.deadline.getTime() + 60_000, 409, 'Délai dépassé : la copie ne peut plus être modifiée');
      const answers = input.answers !== undefined || input.answersForm === '1' ? answersFrom(input, attempt.questions) : attempt.answers;
      if (action === 'save') {
        await store.query('UPDATE unoa.attempt SET answers = $2, saved_at = now() WHERE id = $1', [attempt.id, JSON.stringify(answers)]);
        return { attemptId: attempt.id, savedAt: new Date().toISOString() };
      }
      const { rows: questions } = await store.query<{ id: string; kind: QuestionKind; choices: string[]; answer: unknown; points: string }>(
        'SELECT id, kind, choices, answer, points FROM unoa.question WHERE id = ANY($1::uuid[])', [attempt.questions]);
      const automatic = questions.reduce((sum, question) => sum + (autoScore(definition(question), answers[question.id]) ?? 0), 0);
      const { rows: [clock] } = await store.query<{ now: Date }>('SELECT now()');
      const receipt = createHash('sha256').update(JSON.stringify([attempt.id, answers, clock.now.toISOString()])).digest('hex');
      await store.query("UPDATE unoa.attempt SET answers = $2, saved_at = now(), state = 'submitted', submitted_at = now(), receipt = $3, auto_score = $4 WHERE id = $1",
        [attempt.id, JSON.stringify(answers), receipt, round(automatic)]);
      const assessment = await assessmentOf(store, attempt.assessment_id);
      const { rows: [offering] } = await store.query<{ owner_scope_id: string }>('SELECT owner_scope_id FROM unoa.course_offering WHERE id = $1', [assessment.offering_id]);
      await audit(store, actor, offering.owner_scope_id, 'ass.submitted', correlation, attempt.id);
      await dispatch(store, { event: 'ass.receipt', scopeId: offering.owner_scope_id, recipients: attempt.team_members.length ? attempt.team_members : [actor], correlation,
        values: { title: assessment.title, receipt: receipt.slice(0, 16) }, link: '/evaluations/copie?id=' + attempt.id });
      return { attemptId: attempt.id, receipt, submittedAt: clock.now };
    }
    throw new Problem(404, 'Opération inconnue');
  });
}

export async function uploadAnswerFile(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const file = input.file;
  ensure(file instanceof File, 400, 'Fichier requis');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = (file.name.split('.').pop() ?? '').toLowerCase().replace('jpeg', 'jpg');
  ensure(['pdf', 'png', 'jpg'].includes(extension) && matchesFormat(bytes, extension), 400, 'Formats acceptés : PDF, PNG, JPG');
  ensure(bytes.byteLength > 0 && bytes.byteLength <= 5 * 1024 * 1024, 413, 'Fichier de 5 Mo au plus');
  return transaction(settings, 'unoa.ass.file.' + actor, async store => {
    const attempt = await ownAttempt(store, actor, input.attemptId);
    ensure(attempt.state === 'in_progress', 409, 'Copie déjà soumise');
    ensure(Date.now() <= attempt.deadline.getTime() + 60_000, 409, 'Délai dépassé');
    const questionId = uuid(input.questionId);
    const { rows } = await store.query("SELECT 1 FROM unoa.question WHERE id = $1 AND kind = 'file'", [questionId]);
    ensure(rows[0] && attempt.questions.includes(questionId), 422, 'Question à fichier absente de la copie');
    const sha = createHash('sha256').update(bytes).digest('hex');
    await store.query(`INSERT INTO unoa.attempt_file(attempt_id, question_id, filename, format, size_bytes, sha256, content) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [attempt.id, questionId, file.name.slice(0, 200), extension, bytes.byteLength, sha, Buffer.from(bytes)]);
    await store.query('UPDATE unoa.attempt SET answers = answers || jsonb_build_object($2::text, $3::text), saved_at = now() WHERE id = $1', [attempt.id, questionId, sha]);
    await audit(store, actor, null, 'ass.file_deposited', correlation, attempt.id);
    return { attemptId: attempt.id };
  });
}

async function respond(store: Queryable, actor: string, input: Input, correlation: string) {
  const { rows } = await store.query<{ id: string; state: string; attempt_id: string }>('SELECT id, state, attempt_id FROM unoa.integrity_case WHERE id = $1 FOR UPDATE', [uuid(input.caseId)]);
  ensure(rows[0], 404, 'Procédure introuvable');
  await ownAttempt(store, actor, rows[0].attempt_id);
  ensure(rows[0].state === 'open', 409, 'Observations déjà présentées ou procédure close');
  await store.query("UPDATE unoa.integrity_case SET learner_response = $2, answered_at = now(), state = 'answered' WHERE id = $1",
    [rows[0].id, boundedText(input.response, 4000, 'Observations')]);
  await audit(store, actor, null, 'ass.integrity_answered', correlation, rows[0].id);
  return { attemptId: rows[0].attempt_id };
}

// ---------------------------------------------------------------- grading

async function attemptForStaff(store: Queryable, actor: string, id: unknown) {
  const { rows } = await store.query<{ id: string; assessment_id: string; account_id: string; team_members: string[]; questions: string[]; answers: Record<string, unknown>;
    state: string; auto_score: string | null; offering_id: string }>(`SELECT attempt.*, assessment.offering_id FROM unoa.attempt
    JOIN unoa.assessment ON assessment.id = attempt.assessment_id WHERE attempt.id = $1`, [uuid(id)]);
  ensure(rows[0], 404, 'Copie introuvable');
  const granted = await access(store, actor, rows[0].offering_id);
  return { attempt: rows[0], granted };
}

// The final mark of a copy: single grading, mean of two close gradings, or the moderation.
export function finalMark(double: boolean, gradings: { round: string; total: string | number }[], maximum: number) {
  const by = Object.fromEntries(gradings.map(item => [item.round, Number(item.total)]));
  if (by.moderation !== undefined) return { mark: by.moderation, pending: null };
  if (!double) return by.first !== undefined ? { mark: by.first, pending: null } : { mark: null, pending: 'first' };
  if (by.first === undefined) return { mark: null, pending: 'first' };
  if (by.second === undefined) return { mark: null, pending: 'second' };
  if (needsModeration(by.first, by.second, maximum)) return { mark: null, pending: 'moderation' };
  return { mark: round((by.first + by.second) / 2), pending: null };
}

export async function gradeAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.ass.grade.' + String(input.attemptId ?? input.caseId ?? ''), async store => {
    if (action === 'decide') {
      const { rows } = await store.query<{ id: string; state: string; attempt_id: string; reported_by: string }>(
        'SELECT id, state, attempt_id, reported_by FROM unoa.integrity_case WHERE id = $1 FOR UPDATE', [uuid(input.caseId)]);
      ensure(rows[0], 404, 'Procédure introuvable');
      const { granted } = await attemptForStaff(store, actor, rows[0].attempt_id);
      staffOnly(granted, 'integrity');
      ensure(rows[0].reported_by !== actor, 403, 'La décision revient à une autre personne que l’auteur du signalement');
      ensure(rows[0].state === 'answered' || (rows[0].state === 'open' && flag(input.noResponse)), 409,
        'Le droit de réponse de l’apprenant précède la décision (ou constatez l’absence de réponse)');
      const outcome = choice(input.outcome, ['dismissed', 'sanctioned'] as const, 'Issue');
      await store.query('UPDATE unoa.integrity_case SET state = $2, decision = $3, decided_by = $4, decided_at = now() WHERE id = $1',
        [rows[0].id, outcome, boundedText(input.decision, 4000, 'Motivation'), actor]);
      await audit(store, actor, granted.scopeId, 'ass.integrity_' + outcome, correlation, rows[0].id);
      return { attemptId: rows[0].attempt_id };
    }
    const { attempt, granted } = await attemptForStaff(store, actor, input.attemptId);
    ensure(attempt.state === 'submitted', 409, 'Copie non soumise');
    const assessment = await assessmentOf(store, attempt.assessment_id);
    const learners = attempt.team_members.length ? attempt.team_members : [attempt.account_id];
    ensure(!learners.includes(actor), 403, 'Un apprenant ne corrige pas sa propre copie');
    if (action === 'report') {
      staffOnly(granted, 'grade');
      const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.integrity_case(attempt_id, reported_by, reason) VALUES ($1, $2, $3) RETURNING id',
        [attempt.id, actor, boundedText(input.reason, 4000, 'Motif du signalement')]);
      await audit(store, actor, granted.scopeId, 'ass.integrity_reported', correlation, rows[0].id);
      await dispatch(store, { event: 'ass.integrity', scopeId: granted.scopeId, recipients: learners, correlation, values: { title: assessment.title }, link: '/evaluations/copie?id=' + attempt.id });
      return { attemptId: attempt.id };
    }
    if (action !== 'grade') throw new Problem(404, 'Opération inconnue');
    const roundName = choice(input.round ?? 'first', ['first', 'second', 'moderation'] as const, 'Tour de correction');
    staffOnly(granted, roundName === 'moderation' ? 'moderate' : 'grade');
    ensure(roundName === 'first' || assessment.double_grading, 422, 'Double correction non prévue pour cette évaluation');
    const { rows: previous } = await store.query<{ round: string; total: string }>('SELECT round, total FROM unoa.grading WHERE attempt_id = $1', [attempt.id]);
    const { rows: questions } = await store.query<{ id: string; kind: QuestionKind; points: string }>('SELECT id, kind, points FROM unoa.question WHERE id = ANY($1::uuid[])', [attempt.questions]);
    const maximum = questions.reduce((sum, item) => sum + Number(item.points), 0) + rubricTotal(assessment.rubric);
    const pending = finalMark(assessment.double_grading, previous, maximum).pending;
    ensure(pending === roundName, 409, pending ? 'Tour attendu : ' + ({ first: 'première correction', second: 'seconde correction', moderation: 'modération' } as Record<string, string>)[pending] : 'Copie déjà notée');
    // Only questions that cannot be scored automatically, and rubric criteria, take a human score (ASS-011).
    const scores: Record<string, number> = {};
    for (const question of questions.filter(item => !autoKinds.includes(item.kind))) {
      const value = numeric(input['s.' + question.id] ?? (input.scores as Record<string, unknown> | undefined)?.[question.id] ?? 0);
      ensure(value >= 0 && value <= Number(question.points), 400, 'Note de question hors barème');
      scores[question.id] = value;
    }
    assessment.rubric.forEach((item, index) => {
      const value = numeric(input['c.' + index] ?? (input.scores as Record<string, unknown> | undefined)?.['c' + index] ?? 0);
      ensure(value >= 0 && value <= Number(item.points), 400, 'Note de critère hors barème');
      scores['c' + index] = value;
    });
    const total = round(Number(attempt.auto_score ?? 0) + Object.values(scores).reduce((sum, value) => sum + value, 0));
    await store.query('INSERT INTO unoa.grading(attempt_id, round, grader_id, scores, total, feedback) VALUES ($1, $2, $3, $4, $5, $6)',
      [attempt.id, roundName, actor, JSON.stringify(scores), total, optional(input.feedback, text(8000, 'Commentaire'))]);
    await audit(store, actor, granted.scopeId, 'ass.graded_' + roundName, correlation, attempt.id);
    const after = finalMark(assessment.double_grading, [...previous, { round: roundName, total }], maximum);
    if (after.mark !== null) {
      await dispatch(store, { event: 'ass.graded', scopeId: granted.scopeId, recipients: learners, correlation, values: { title: assessment.title }, link: '/evaluations/copie?id=' + attempt.id });
    }
    return { attemptId: attempt.id, total, pending: after.pending };
  });
}

// ------------------------------------------------------------------ views

export async function learnerSpace(settings: IamSettings, actor: string) {
  const store = database(settings);
  const [assessments, teaching] = await Promise.all([
    store.query<{ id: string; title: string; kind: string; team: boolean; opens_at: Date; closes_at: Date; duration_minutes: number | null; attempts_allowed: number;
      state: string; course: string; offering: string; time_zone: string; extra_days: number | null; extra_minutes: number | null;
      attempts: { id: string; number: number; state: string; receipt: string | null; submitted_at: string | null; team_label: string | null }[] }>(`
      SELECT assessment.id, assessment.title, assessment.kind, assessment.team, assessment.opens_at, assessment.closes_at, assessment.duration_minutes,
        assessment.attempts_allowed, assessment.state, version.title AS course, offering.label AS offering, offering.time_zone,
        accommodation.extra_days, accommodation.extra_minutes,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id', attempt.id, 'number', attempt.number, 'state', attempt.state, 'receipt', attempt.receipt,
          'submitted_at', attempt.submitted_at, 'team_label', attempt.team_label) ORDER BY attempt.number)
          FROM unoa.attempt WHERE attempt.assessment_id = assessment.id AND (attempt.account_id = $1 OR $1 = ANY(attempt.team_members))), '[]') AS attempts
      FROM unoa.assessment JOIN unoa.course_offering AS offering ON offering.id = assessment.offering_id
      JOIN unoa.course_version AS version ON version.id = offering.course_version_id
      JOIN unoa.offering_member AS member ON member.offering_id = offering.id AND member.account_id = $1 AND member.role = 'learner' AND member.removed_at IS NULL
      LEFT JOIN unoa.accommodation ON accommodation.assessment_id = assessment.id AND accommodation.account_id = $1
      WHERE assessment.state <> 'draft' ORDER BY assessment.closes_at LIMIT 200`, [actor]),
    store.query<{ id: string; label: string; course: string }>(`
      SELECT DISTINCT offering.id, offering.label, version.title AS course FROM unoa.course_offering AS offering
      JOIN unoa.course_version AS version ON version.id = offering.course_version_id
      WHERE offering.state = 'open' AND (unoa.offering_role(offering.id, $1) IN ('teacher', 'tutor') OR unoa.has_scope_permission($1, 'ass.read', offering.owner_scope_id))
      ORDER BY version.title LIMIT 100`, [actor]),
  ]);
  return { assessments: assessments.rows, teaching: teaching.rows };
}

export async function offeringAssessments(settings: IamSettings, actor: string, offeringId: string) {
  const store = database(settings);
  const granted = await access(store, actor, offeringId);
  staffOnly(granted, 'read');
  const [banks, questions, assessments, subject, copies, learners, accommodations, cases] = await Promise.all([
    store.query<{ id: string; title: string }>('SELECT id, title FROM unoa.question_bank WHERE scope_id = $1 ORDER BY created_at', [granted.scopeId]),
    store.query<{ id: string; bank_id: string; lineage: string; version: number; kind: QuestionKind; prompt: string; choices: string[]; answer: unknown; points: string; tags: string | null }>(`
      SELECT question.id, question.bank_id, question.lineage, question.version, question.kind, question.prompt, question.choices, question.answer, question.points, question.tags
      FROM unoa.question JOIN unoa.question_bank AS bank ON bank.id = question.bank_id WHERE bank.scope_id = $1 AND question.retired_at IS NULL
      ORDER BY question.created_at LIMIT 500`, [granted.scopeId]),
    store.query<AssessmentRow & { copies: number }>(`SELECT assessment.*, (SELECT count(*)::int FROM unoa.attempt WHERE assessment_id = assessment.id AND state = 'submitted') AS copies
      FROM unoa.assessment WHERE offering_id = $1 ORDER BY created_at DESC`, [granted.offeringId]),
    store.query<{ assessment_id: string; question_id: string; ordinal: number; prompt: string; kind: string; points: string; version: number }>(`
      SELECT link.assessment_id, link.question_id, link.ordinal, question.prompt, question.kind, question.points, question.version FROM unoa.assessment_question AS link
      JOIN unoa.question ON question.id = link.question_id JOIN unoa.assessment ON assessment.id = link.assessment_id WHERE assessment.offering_id = $1 ORDER BY link.ordinal`, [granted.offeringId]),
    store.query<{ id: string; assessment_id: string; name: string | null; team_label: string | null; submitted_at: Date; receipt: string; auto_score: string | null;
      rounds: string[]; open_cases: number }>(`
      SELECT attempt.id, attempt.assessment_id, account.display_name AS name, attempt.team_label, attempt.submitted_at, attempt.receipt, attempt.auto_score,
        coalesce((SELECT array_agg(round ORDER BY created_at) FROM unoa.grading WHERE attempt_id = attempt.id), '{}') AS rounds,
        (SELECT count(*)::int FROM unoa.integrity_case WHERE attempt_id = attempt.id AND state IN ('open', 'answered')) AS open_cases
      FROM unoa.attempt JOIN unoa.assessment ON assessment.id = attempt.assessment_id JOIN unoa.account ON account.id = attempt.account_id
      WHERE assessment.offering_id = $1 AND attempt.state = 'submitted' ORDER BY attempt.submitted_at DESC LIMIT 500`, [granted.offeringId]),
    store.query<{ account_id: string; name: string | null }>(`SELECT member.account_id, account.display_name AS name FROM unoa.offering_member AS member
      JOIN unoa.account ON account.id = member.account_id WHERE member.offering_id = $1 AND member.role = 'learner' AND member.removed_at IS NULL ORDER BY account.display_name LIMIT 500`, [granted.offeringId]),
    store.query<{ assessment_id: string; name: string | null; extra_minutes: number; extra_days: number; reason: string }>(`
      SELECT accommodation.assessment_id, account.display_name AS name, accommodation.extra_minutes, accommodation.extra_days, accommodation.reason
      FROM unoa.accommodation JOIN unoa.assessment ON assessment.id = accommodation.assessment_id JOIN unoa.account ON account.id = accommodation.account_id
      WHERE assessment.offering_id = $1`, [granted.offeringId]),
    store.query<{ id: string; attempt_id: string; title: string; name: string | null; reason: string; state: string; learner_response: string | null; decision: string | null; reported_by: string }>(`
      SELECT integrity.id, integrity.attempt_id, assessment.title, account.display_name AS name, integrity.reason, integrity.state, integrity.learner_response,
        integrity.decision, integrity.reported_by FROM unoa.integrity_case AS integrity JOIN unoa.attempt ON attempt.id = integrity.attempt_id
      JOIN unoa.assessment ON assessment.id = attempt.assessment_id JOIN unoa.account ON account.id = attempt.account_id
      WHERE assessment.offering_id = $1 ORDER BY integrity.reported_at DESC`, [granted.offeringId]),
  ]);
  return { access: granted, banks: banks.rows, questions: questions.rows, assessments: assessments.rows, subject: subject.rows, copies: copies.rows,
    learners: learners.rows, accommodations: accommodations.rows, cases: cases.rows };
}

// A copy: the learner sees their subject (without answers), their answers, receipt and,
// once the mark is final, the feedback; the teaching team sees everything needed to grade.
export async function copyDetails(settings: IamSettings, actor: string, attemptId: string) {
  const store = database(settings);
  const { rows: [attempt] } = await store.query<{ id: string; assessment_id: string; account_id: string; team_members: string[]; team_label: string | null; number: number;
    questions: string[]; answers: Record<string, unknown>; started_at: Date; deadline: Date; saved_at: Date | null; state: string; submitted_at: Date | null;
    receipt: string | null; auto_score: string | null; name: string | null }>(`SELECT attempt.*, account.display_name AS name FROM unoa.attempt
    JOIN unoa.account ON account.id = attempt.account_id WHERE attempt.id = $1`, [uuid(attemptId)]);
  ensure(attempt, 404, 'Copie introuvable');
  const assessment = await assessmentOf(store, attempt.assessment_id);
  const granted = await access(store, actor, assessment.offering_id);
  const own = attempt.account_id === actor || attempt.team_members.includes(actor);
  ensure(own || granted.read, 403, 'Copie inaccessible');
  const staff = granted.read && !own;
  const [questions, files, gradings, cases] = await Promise.all([
    store.query<{ id: string; kind: QuestionKind; prompt: string; choices: string[]; answer: unknown; points: string }>(
      'SELECT id, kind, prompt, choices, answer, points FROM unoa.question WHERE id = ANY($1::uuid[])', [attempt.questions]),
    store.query<{ id: string; question_id: string; filename: string; sha256: string; size_bytes: number; uploaded_at: Date }>(
      'SELECT id, question_id, filename, sha256, size_bytes, uploaded_at FROM unoa.attempt_file WHERE attempt_id = $1 ORDER BY uploaded_at', [attempt.id]),
    store.query<{ round: string; total: string; scores: Record<string, number>; feedback: string | null; created_at: Date; grader: string | null; grader_id: string }>(`
      SELECT grading.round, grading.total, grading.scores, grading.feedback, grading.created_at, account.display_name AS grader, grading.grader_id FROM unoa.grading
      JOIN unoa.account ON account.id = grading.grader_id WHERE attempt_id = $1 ORDER BY grading.created_at`, [attempt.id]),
    store.query<{ id: string; reason: string; state: string; learner_response: string | null; decision: string | null; reported_by: string; reported_at: Date }>(
      'SELECT id, reason, state, learner_response, decision, reported_by, reported_at FROM unoa.integrity_case WHERE attempt_id = $1 ORDER BY reported_at', [attempt.id]),
  ]);
  const order = new Map(attempt.questions.map((id, index) => [id, index]));
  const sorted = [...questions.rows].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const maximum = sorted.reduce((sum, item) => sum + Number(item.points), 0) + rubricTotal(assessment.rubric);
  const final = finalMark(assessment.double_grading, gradings.rows, maximum);
  const sanctioned = cases.rows.some(item => item.state === 'sanctioned');
  const underReview = cases.rows.some(item => ['open', 'answered'].includes(item.state));
  // The matching right-hand side is offered in a stable shuffled order; answers never leave for a learner.
  const subject = sorted.map(question => ({
    id: question.id, kind: question.kind, prompt: question.prompt, points: Number(question.points),
    choices: question.kind === 'matching' ? question.choices : question.choices,
    options: question.kind === 'matching' ? draw(question.answer as string[], null, attempt.id + question.id) : null,
    answer: staff ? question.answer : undefined,
    auto: attempt.state === 'submitted' && (staff || final.mark !== null) ? autoScore(definition(question), attempt.answers[question.id]) : null,
  }));
  return {
    attempt: { ...attempt, account_id: staff ? attempt.account_id : undefined }, assessment, access: granted, own, staff, subject, files: files.rows, maximum,
    gradings: staff ? gradings.rows : final.mark !== null ? gradings.rows.map(item => ({ round: item.round, total: item.total, scores: item.scores, feedback: item.feedback, created_at: item.created_at })) : [],
    mark: sanctioned ? 0 : underReview ? null : final.mark, pending: final.pending, underReview, sanctioned,
    cases: staff ? cases.rows : cases.rows.map(item => ({ id: item.id, reason: item.reason, state: item.state, learner_response: item.learner_response, decision: item.decision, reported_at: item.reported_at })),
  };
}

export async function answerFile(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const { rows } = await store.query<{ filename: string; format: string; content: Buffer; attempt_id: string }>(
    'SELECT filename, format, content, attempt_id FROM unoa.attempt_file WHERE id = $1', [uuid(id)]);
  ensure(rows[0], 404, 'Fichier introuvable');
  await copyDetails(settings, actor, rows[0].attempt_id);
  return rows[0];
}

// Archive of an assessment (ASS-015): subject with versions, every copy with its
// receipt, files' fingerprints, gradings and integrity cases, sealed by a hash.
export async function assessmentArchive(settings: IamSettings, actor: string, assessmentId: string) {
  const store = database(settings);
  const assessment = await assessmentOf(store, assessmentId);
  const granted = await access(store, actor, assessment.offering_id);
  staffOnly(granted, 'read');
  const [subject, copies] = await Promise.all([
    store.query(`SELECT question.id, question.lineage, question.version, question.kind, question.prompt, question.choices, question.answer, question.points, link.ordinal
      FROM unoa.assessment_question AS link JOIN unoa.question ON question.id = link.question_id WHERE link.assessment_id = $1 ORDER BY link.ordinal`, [assessment.id]),
    store.query(`SELECT attempt.id, attempt.account_id, account.display_name AS name, attempt.team_label, attempt.team_members, attempt.number, attempt.questions,
        attempt.answers, attempt.started_at, attempt.deadline, attempt.submitted_at, attempt.receipt, attempt.auto_score,
        coalesce((SELECT jsonb_agg(jsonb_build_object('round', round, 'grader', grader_id, 'scores', scores, 'total', total, 'feedback', feedback, 'at', created_at) ORDER BY created_at)
          FROM unoa.grading WHERE attempt_id = attempt.id), '[]') AS gradings,
        coalesce((SELECT jsonb_agg(jsonb_build_object('question', question_id, 'filename', filename, 'sha256', sha256, 'size', size_bytes, 'at', uploaded_at))
          FROM unoa.attempt_file WHERE attempt_id = attempt.id), '[]') AS files,
        coalesce((SELECT jsonb_agg(jsonb_build_object('reason', reason, 'state', state, 'response', learner_response, 'decision', decision, 'decided_by', decided_by, 'at', reported_at))
          FROM unoa.integrity_case WHERE attempt_id = attempt.id), '[]') AS integrity
      FROM unoa.attempt JOIN unoa.account ON account.id = attempt.account_id WHERE attempt.assessment_id = $1 AND attempt.state = 'submitted' ORDER BY attempt.submitted_at`, [assessment.id]),
  ]);
  const body = { format: 'unoa.assessment-archive/1', generatedAt: new Date().toISOString(), offering: { id: granted.offeringId, label: granted.label, course: granted.course },
    assessment, subject: subject.rows, copies: copies.rows };
  const json = JSON.stringify(body);
  return JSON.stringify({ ...body, seal: createHash('sha256').update(json).digest('hex') }, null, 2);
}
