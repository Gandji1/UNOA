import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, ensure, integer, language, optional, Problem, text, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';
import { activeHolds } from '@/lib/finance/store';

// Documents and diplomas (module CRED). A type names its issuing authority;
// an establishment diploma is issued only under a verified programme
// authorisation in force; a document is sealed, signed by the required number
// of other people, verifiable with minimal disclosure, revoked and reissued
// with a trace. National (State) titles cannot be modelled.

type Right = 'read' | 'design' | 'approve' | 'issue' | 'sign' | 'revoke';
export const categoryLabels: Record<string, string> = {
  internal_attestation: 'Attestation interne', institutional_diploma: 'Diplôme d’établissement (sous habilitation)', badge: 'Badge numérique / microcertification',
};
export const eligibilityLabels: Record<string, string> = { enrolled: 'Inscription validée', result_published: 'Résultat publié favorable', graduated: 'Statut « diplômé » au dossier',
  short_completion: 'Formation courte réussie', stack_completion: 'Parcours de microcertifications complet' };
export const stateLabels: Record<string, string> = { pending_signature: 'En attente de signature', issued: 'Délivré', revoked: 'Révoqué' };
// Fields a template may use; any other placeholder is refused at publication.
export const placeholders = ['nom', 'matricule', 'formation', 'etablissement', 'autorite', 'date', 'numero', 'annee', 'credits', 'type'] as const;

async function rights(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`SELECT unoa.has_scope_permission($1, 'cred.read', $2) AS read, unoa.has_scope_permission($1, 'cred.design', $2) AS design,
    unoa.has_scope_permission($1, 'cred.approve', $2) AS approve, unoa.has_scope_permission($1, 'cred.issue', $2) AS issue,
    unoa.has_scope_permission($1, 'cred.sign', $2) AS sign, unoa.has_scope_permission($1, 'cred.revoke', $2) AS revoke`, [actor, scopeId]);
  return rows[0];
}
async function require(store: Queryable, actor: string, scopeId: string, right: Right) {
  const granted = await rights(store, actor, scopeId);
  ensure(granted?.[right], 403, 'Action réservée aux personnes habilitées pour les documents');
  return granted;
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const base32 = (bytes: Buffer) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let value = 0; let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
};
export const render = (body: string, values: Record<string, string>) => body.replace(/\{\{\s*([a-z]+)\s*\}\}/g, (_, key: string) => values[key] ?? '');
function checkTemplate(body: string) {
  const used = [...body.matchAll(/\{\{\s*([a-z]+)\s*\}\}/g)].map(match => match[1]);
  const unknown = used.filter(key => !(placeholders as readonly string[]).includes(key));
  ensure(unknown.length === 0, 400, 'Champs inconnus dans le modèle : ' + [...new Set(unknown)].join(', '));
}

export interface TypeRow { id: string; scope_id: string; code: string; label: string; category: string; issuing_authority: string; program_id: string | null; eligibility: string;
  required_signatures: number; state: string; author_id: string }

// ------------------------------------------------------------ types, templates

async function designAction(store: Queryable, actor: string, action: string, input: Input) {
  if (action === 'types') {
    const scopeId = uuid(input.scopeId);
    await require(store, actor, scopeId, 'design');
    const { rows: [nature] } = await store.query<{ nature: string }>('SELECT kind.nature FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code WHERE scope.id = $1', [scopeId]);
    ensure(nature?.nature === 'institution', 422, 'Les documents sont délivrés par un établissement');
    const category = choice(input.category, ['internal_attestation', 'institutional_diploma', 'badge'] as const, 'Catégorie');
    const programId = optional(input.programId, uuid);
    if (programId) ensure((await store.query('SELECT 1 FROM unoa.program WHERE id = $1 AND institution_id = $2', [programId, scopeId])).rows[0], 422, 'Formation d’un autre établissement');
    const code = String(input.code ?? '').toUpperCase();
    ensure(/^[A-Z0-9][A-Z0-9-]{1,15}$/.test(code), 400, 'Code de 2 à 16 caractères (lettres, chiffres, tiret)');
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.credential_type(scope_id, code, label, category, issuing_authority, program_id, eligibility, required_signatures, author_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [scopeId, code, boundedText(input.label, 160, 'Libellé'), category,
      boundedText(input.issuingAuthority, 200, 'Autorité émettrice'), programId, choice(input.eligibility, ['enrolled', 'result_published', 'graduated', 'short_completion', 'stack_completion'] as const, 'Condition'),
      integer(input.requiredSignatures ?? 1, 'Signatures requises', 1, 3), actor]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Ce code existe déjà');
      if (error?.code === '23514') throw new Problem(422, 'Un diplôme d’établissement exige une formation, le statut « diplômé » et au moins deux signatures');
      throw error;
    });
    return { scopeId, subject: rows[0].id };
  }
  if (action === 'templates') {
    const type = await typeOf(store, input.typeId);
    await require(store, actor, type.scope_id, 'design');
    const body = boundedText(input.body, 8000, 'Texte du modèle');
    checkTemplate(body);
    const lang = language(input.language ?? 'fr');
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.document_template(type_id, language, version, title, body, author_id)
      VALUES ($1, $2, (SELECT coalesce(max(version), 0) + 1 FROM unoa.document_template WHERE type_id = $1 AND language = $2), $3, $4, $5) RETURNING id`,
      [type.id, lang, boundedText(input.title, 200, 'Titre'), body, actor]);
    return { scopeId: type.scope_id, subject: rows[0].id };
  }
  if (action === 'publish-type' || action === 'retire-type') {
    const type = await typeOf(store, input.typeId, true);
    await require(store, actor, type.scope_id, 'approve');
    if (action === 'publish-type') {
      ensure(type.state === 'draft', 409, 'Déjà publié');
      ensure(type.author_id !== actor, 403, 'L’approbation revient à une autre personne que l’auteur');
      await store.query("UPDATE unoa.credential_type SET state = 'published', publisher_id = $2 WHERE id = $1", [type.id, actor]);
    } else {
      ensure(type.state === 'published', 409, 'Seul un type publié se retire');
      await store.query("UPDATE unoa.credential_type SET state = 'retired' WHERE id = $1", [type.id]);
    }
    return { scopeId: type.scope_id, subject: type.id };
  }
  if (action === 'publish-template') {
    const { rows: [template] } = await store.query<{ id: string; type_id: string; language: string; state: string; author_id: string; scope_id: string }>(`SELECT template.id, template.type_id,
      template.language, template.state, template.author_id, kind.scope_id FROM unoa.document_template AS template JOIN unoa.credential_type AS kind ON kind.id = template.type_id
      WHERE template.id = $1 FOR UPDATE OF template`, [uuid(input.templateId)]);
    ensure(template, 404, 'Modèle introuvable');
    await require(store, actor, template.scope_id, 'approve');
    ensure(template.state === 'draft', 409, 'Déjà publié');
    ensure(template.author_id !== actor, 403, 'L’approbation revient à une autre personne que l’auteur');
    await store.query("UPDATE unoa.document_template SET state = 'superseded' WHERE type_id = $1 AND language = $2 AND state = 'published'", [template.type_id, template.language]);
    await store.query("UPDATE unoa.document_template SET state = 'published', publisher_id = $2 WHERE id = $1", [template.id, actor]);
    return { scopeId: template.scope_id, subject: template.id };
  }
  throw new Problem(404, 'Opération inconnue');
}
export async function typeOf(store: Queryable, id: unknown, lock = false) {
  const { rows } = await store.query<TypeRow>(`SELECT * FROM unoa.credential_type WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [uuid(id)]);
  ensure(rows[0], 404, 'Type de document introuvable');
  return rows[0];
}

// ------------------------------------------------------------------ issuance

// Authorisation in force for an establishment diploma (CRED-003/004/013).
export async function authorisation(store: Queryable, programId: string, institutionId: string) {
  const { rows } = await store.query<{ authority: string; status: string; valid_until: Date | null }>(`SELECT authorization_row.authority, authorization_row.status, authorization_row.valid_until
    FROM unoa.program_authorization AS authorization_row WHERE authorization_row.program_id = $1 AND authorization_row.status = 'authorized' AND authorization_row.verified_by IS NOT NULL
      AND authorization_row.valid_from <= now() AND (authorization_row.valid_until IS NULL OR authorization_row.valid_until > now())
      AND (authorization_row.territory_id IS NULL OR unoa.scope_within($2, authorization_row.territory_id))
    ORDER BY authorization_row.valid_from DESC LIMIT 1`, [programId, institutionId]);
  return rows[0] ?? null;
}

async function prepare(store: Queryable, actor: string, input: Input, correlation: string, replaces: string | null = null) {
  const type = await typeOf(store, input.typeId);
  await require(store, actor, type.scope_id, 'issue');
  ensure(type.state === 'published', 422, 'Type de document non approuvé ou retiré');
  const { rows: [student] } = await store.query<{ id: string; account_id: string; matricule: string; status: string; name: string | null; institution: string }>(`
    SELECT student.id, student.account_id, student.matricule, student.status, account.display_name AS name, scope.label AS institution FROM unoa.student
    JOIN unoa.account ON account.id = student.account_id JOIN unoa.scope ON scope.id = student.institution_id WHERE student.id = $1 AND student.institution_id = $2`,
    [uuid(input.studentId), type.scope_id]);
  ensure(student, 404, 'Étudiant introuvable dans cet établissement');
  const lang = language(input.language ?? 'fr');
  ensure(['enrolled', 'result_published', 'graduated'].includes(type.eligibility), 422, 'Ce document se délivre depuis le module de formation concerné');
  const template = await templateFor(store, type.id, lang);
  // Eligibility from the student's own records.
  const { rows: [record] } = await store.query<{ program: string | null; year: string | null; credits: string | null; result: boolean; program_ok: boolean }>(`
    SELECT (SELECT version.title FROM unoa.registration JOIN unoa.cohort ON cohort.id = registration.cohort_id JOIN unoa.program_version AS version ON version.id = cohort.version_id
        WHERE registration.student_id = $1 AND registration.state = 'validated' AND ($2::uuid IS NULL OR version.program_id = $2) ORDER BY registration.created_at DESC LIMIT 1) AS program,
      (SELECT registration.academic_year FROM unoa.registration WHERE registration.student_id = $1 AND registration.state = 'validated' ORDER BY registration.created_at DESC LIMIT 1) AS year,
      (SELECT sum(award.credits) FROM unoa.credit_award AS award WHERE award.student_id = $1 AND award.revoked_at IS NULL) AS credits,
      EXISTS (SELECT 1 FROM unoa.jury_decision AS decision JOIN unoa.jury ON jury.id = decision.jury_id JOIN unoa.registration ON registration.id = decision.registration_id
        WHERE registration.student_id = $1 AND jury.state = 'published' AND jury.publish_at <= now() AND decision.outcome IN ('admitted', 'compensated')
        AND NOT EXISTS (SELECT 1 FROM unoa.jury_decision AS later WHERE later.amends = decision.id)) AS result,
      ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM unoa.registration JOIN unoa.cohort ON cohort.id = registration.cohort_id JOIN unoa.program_version AS version ON version.id = cohort.version_id
        WHERE registration.student_id = $1 AND registration.state = 'validated' AND version.program_id = $2)) AS program_ok`, [student.id, type.program_id]);
  ensure(record.program_ok, 422, 'L’étudiant n’est pas inscrit à la formation de ce document');
  if (type.eligibility === 'enrolled') ensure(record.program, 422, 'Condition non remplie : inscription validée');
  if (type.eligibility === 'result_published') ensure(record.result, 422, 'Condition non remplie : résultat favorable publié');
  if (type.eligibility === 'graduated') ensure(student.status === 'graduated', 422, 'Condition non remplie : statut « diplômé » au dossier');
  let authority = type.issuing_authority;
  if (type.category === 'institutional_diploma') {
    const found = await authorisation(store, type.program_id!, type.scope_id);
    ensure(found, 422, 'Diplôme verrouillé : habilitation absente, non vérifiée ou expirée pour cette formation');
    authority = `${type.issuing_authority} (habilitation : ${found.authority})`;
  } else {
    // Legally admitted hold: internal attestations are withheld while it applies.
    const holds = (await activeHolds(store, student.account_id, type.scope_id)).filter(hold => hold.effect === 'withhold_internal_documents');
    ensure(holds.length === 0, 423, 'Délivrance suspendue : ' + holds.map(hold => hold.label).join(', '));
  }
  return seal(store, actor, type, { holder: student.account_id, student: student.id, source: null, language: lang, template, authority, replaces, correlation,
    values: { nom: student.name ?? '', matricule: student.matricule, formation: record.program ?? '', etablissement: student.institution, annee: record.year ?? '', credits: String(Number(record.credits ?? 0)) } });
}

// Numbering, rendering and sealing, shared by every module that issues a
// document of the register (students here, short-course learners in SHORT).
export async function seal(store: Queryable, actor: string, type: TypeRow, input: { holder: string; student: string | null; source: string | null; language: string;
  template: { id: string; title: string; body: string; version: number }; authority: string; replaces: string | null; correlation: string; values: Record<string, string> }) {
  const year = new Date().getUTCFullYear();
  const { rows: [counter] } = await store.query<{ value: string }>(`INSERT INTO unoa.cred_counter(type_id, year, next_value) VALUES ($1, $2, 2)
    ON CONFLICT (type_id, year) DO UPDATE SET next_value = cred_counter.next_value + 1 RETURNING next_value - 1 AS value`, [type.id, year]);
  const number = `${type.code}-${year}-${String(counter.value).padStart(6, '0')}`;
  const values: Record<string, string> = { ...input.values, autorite: input.authority, date: new Date().toISOString().slice(0, 10), numero: number, type: type.label };
  const rendered = `${input.template.title}\n\n${render(input.template.body, values)}`;
  const content = { format: 'unoa.credential/1', type: type.label, category: type.category, authority: input.authority, number,
    template: { id: input.template.id, version: input.template.version, language: input.language }, values };
  const id = randomUUID();
  const fingerprint = sha(JSON.stringify(content) + '\n' + rendered);
  await store.query(`INSERT INTO unoa.credential(id, type_id, template_id, holder_id, student_id, source_id, number, exclusive, content, rendered, sha256, verification_code, replaces, requested_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`, [id, type.id, input.template.id, input.holder, input.student, input.source, number,
    type.category === 'institutional_diploma', JSON.stringify(content), rendered, fingerprint, base32(randomBytes(16)), input.replaces, actor]).catch(error => {
    if (error?.code === '23505') throw new Problem(409, 'Un document de ce type est déjà en vigueur pour ce titulaire (révoquer avant de réémettre)');
    throw error;
  });
  await audit(store, actor, type.scope_id, input.replaces ? 'cred.reissue_prepared' : 'cred.prepared', input.correlation, id);
  return { scopeId: type.scope_id, credentialId: id, number };
}

// Published template of a type in a language.
export async function templateFor(store: Queryable, typeId: string, lang: string) {
  const { rows: [template] } = await store.query<{ id: string; title: string; body: string; version: number }>(
    "SELECT id, title, body, version FROM unoa.document_template WHERE type_id = $1 AND language = $2 AND state = 'published'", [typeId, lang]);
  ensure(template, 422, 'Aucun modèle approuvé dans cette langue');
  return template;
}

async function sign(store: Queryable, actor: string, input: Input, correlation: string) {
  const { rows: [credential] } = await store.query<{ id: string; sha256: string; state: string; scope_id: string; required: number; label: string; number: string; account_id: string }>(`
    SELECT credential.id, credential.sha256, credential.state, kind.scope_id, kind.required_signatures AS required, kind.label, credential.number, credential.holder_id AS account_id
    FROM unoa.credential JOIN unoa.credential_type AS kind ON kind.id = credential.type_id WHERE credential.id = $1 FOR UPDATE OF credential`,
    [uuid(input.credentialId)]);
  ensure(credential, 404, 'Document introuvable');
  await require(store, actor, credential.scope_id, 'sign');
  ensure(credential.state === 'pending_signature', 409, 'Document déjà délivré ou révoqué');
  await store.query('INSERT INTO unoa.credential_signature(credential_id, signer_id, sha256) VALUES ($1, $2, $3)', [credential.id, actor, credential.sha256]).catch(error => {
    if (error?.code === '23505') throw new Problem(409, 'Vous avez déjà signé ce document');
    throw error;
  });
  const { rows: [count] } = await store.query<{ total: number }>('SELECT count(*)::int AS total FROM unoa.credential_signature WHERE credential_id = $1', [credential.id]);
  await audit(store, actor, credential.scope_id, 'cred.signed', correlation, credential.id);
  if (count.total >= credential.required) {
    await store.query("UPDATE unoa.credential SET state = 'issued', issued_at = now() WHERE id = $1", [credential.id]);
    await audit(store, actor, credential.scope_id, 'cred.issued', correlation, credential.id);
    await dispatch(store, { event: 'cred.issued', scopeId: credential.scope_id, recipients: [credential.account_id], correlation, values: { type: credential.label, number: credential.number }, link: '/documents' });
  }
  return { scopeId: credential.scope_id, credentialId: credential.id, issued: count.total >= credential.required };
}

async function revoke(store: Queryable, actor: string, input: Input, correlation: string, reissue: boolean) {
  const { rows: [credential] } = await store.query<{ id: string; state: string; scope_id: string; type_id: string; student_id: string | null; label: string; number: string; account_id: string; language: string }>(`
    SELECT credential.id, credential.state, kind.scope_id, credential.type_id, credential.student_id, kind.label, credential.number, credential.holder_id AS account_id, template.language
    FROM unoa.credential JOIN unoa.credential_type AS kind ON kind.id = credential.type_id
    JOIN unoa.document_template AS template ON template.id = credential.template_id WHERE credential.id = $1 FOR UPDATE OF credential`, [uuid(input.credentialId)]);
  ensure(credential, 404, 'Document introuvable');
  await require(store, actor, credential.scope_id, 'revoke');
  ensure(credential.state !== 'revoked', 409, 'Déjà révoqué');
  await store.query('INSERT INTO unoa.credential_revocation(credential_id, reason, revoked_by) VALUES ($1, $2, $3)', [credential.id, boundedText(input.reason, 1000, 'Motif de révocation'), actor]);
  await store.query("UPDATE unoa.credential SET state = 'revoked' WHERE id = $1", [credential.id]);
  await audit(store, actor, credential.scope_id, 'cred.revoked', correlation, credential.id);
  await dispatch(store, { event: 'cred.revoked', scopeId: credential.scope_id, recipients: [credential.account_id], correlation, values: { type: credential.label, number: credential.number }, link: '/documents' });
  if (!reissue) return { scopeId: credential.scope_id, credentialId: credential.id };
  // A document issued from a training module is reissued there, from its completed source.
  ensure(credential.student_id, 422, 'Réémettre ce document depuis la formation courte concernée');
  // Reissue: a new number, new signatures, linked to the revoked document (CRED-009).
  return prepare(store, actor, { typeId: credential.type_id, studentId: credential.student_id, language: credential.language }, correlation, credential.id);
}

export async function credAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.cred.' + action, async store => {
    if (['types', 'templates', 'publish-type', 'retire-type', 'publish-template'].includes(action)) {
      const result = await designAction(store, actor, action, input);
      await audit(store, actor, result.scopeId, 'cred.' + action.replace(/-/g, '_'), correlation, result.subject);
      return result;
    }
    if (action === 'prepare') return prepare(store, actor, input, correlation);
    if (action === 'sign') return sign(store, actor, input, correlation);
    if (action === 'revoke' || action === 'reissue') return revoke(store, actor, input, correlation, action === 'reissue');
    throw new Problem(404, 'Opération inconnue');
  });
}

// --------------------------------------------------------------------- views

export async function credContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`SELECT scope.id, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature = 'institution' AND unoa.has_scope_permission($1, 'cred.read', scope.id) ORDER BY scope.label LIMIT 200`, [actor]);
  return rows;
}

export async function credOverview(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  const granted = await require(store, actor, scopeId, 'read');
  const [label, types, templates, credentials, programs, students] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]),
    store.query<TypeRow & { program: string | null }>(`SELECT kind.*, program.title AS program FROM unoa.credential_type AS kind LEFT JOIN unoa.program ON program.id = kind.program_id
      WHERE kind.scope_id = $1 ORDER BY kind.created_at`, [scopeId]),
    store.query<{ id: string; type_id: string; language: string; version: number; title: string; body: string; state: string; author_id: string }>(`SELECT template.id, template.type_id, template.language,
      template.version, template.title, template.body, template.state, template.author_id FROM unoa.document_template AS template JOIN unoa.credential_type AS kind ON kind.id = template.type_id
      WHERE kind.scope_id = $1 ORDER BY template.type_id, template.language, template.version DESC`, [scopeId]),
    store.query<{ id: string; number: string; state: string; type: string; name: string | null; matricule: string; created_at: Date; issued_at: Date | null; requested_by: string;
      signatures: { signer: string | null; signer_id: string; at: string }[]; required: number; replaces: string | null; reason: string | null }>(`
      SELECT credential.id, credential.number, credential.state, kind.label AS type, account.display_name AS name, coalesce(student.matricule, 'apprenant externe') AS matricule, credential.created_at, credential.issued_at,
        credential.requested_by, kind.required_signatures AS required, credential.replaces, revocation.reason,
        coalesce((SELECT jsonb_agg(jsonb_build_object('signer', signer.display_name, 'signer_id', signature.signer_id, 'at', signature.signed_at) ORDER BY signature.signed_at)
          FROM unoa.credential_signature AS signature JOIN unoa.account AS signer ON signer.id = signature.signer_id WHERE signature.credential_id = credential.id), '[]') AS signatures
      FROM unoa.credential JOIN unoa.credential_type AS kind ON kind.id = credential.type_id LEFT JOIN unoa.student ON student.id = credential.student_id
      JOIN unoa.account ON account.id = credential.holder_id LEFT JOIN unoa.credential_revocation AS revocation ON revocation.credential_id = credential.id
      WHERE kind.scope_id = $1 ORDER BY credential.created_at DESC LIMIT 300`, [scopeId]),
    store.query<{ id: string; title: string; authorised: boolean }>(`SELECT program.id, program.title, EXISTS (SELECT 1 FROM unoa.program_authorization AS row WHERE row.program_id = program.id
        AND row.status = 'authorized' AND row.verified_by IS NOT NULL AND row.valid_from <= now() AND (row.valid_until IS NULL OR row.valid_until > now())) AS authorised
      FROM unoa.program WHERE program.institution_id = $1 ORDER BY program.title LIMIT 200`, [scopeId]),
    store.query<{ id: string; name: string | null; matricule: string; status: string }>(`SELECT student.id, account.display_name AS name, student.matricule, student.status FROM unoa.student
      JOIN unoa.account ON account.id = student.account_id WHERE student.institution_id = $1 ORDER BY account.display_name LIMIT 500`, [scopeId]),
  ]);
  ensure(label.rows[0], 404, 'Établissement introuvable');
  return { scope: { id: scopeId, label: label.rows[0].label }, rights: granted, types: types.rows, templates: templates.rows, credentials: credentials.rows,
    programs: programs.rows, students: students.rows };
}

// A document's printable view: its holder or the register's readers; only an
// issued document is printable (CRED-013), with its QR verification code.
export async function credentialView(settings: IamSettings, actor: string, id: string, origin: string) {
  const store = database(settings);
  const { rows: [credential] } = await store.query<{ id: string; number: string; state: string; rendered: string; sha256: string; verification_code: string; issued_at: Date | null;
    type: string; category: string; scope_id: string; account_id: string; institution: string; content: Record<string, unknown>;
    signatures: { signer: string | null; at: string }[] }>(`SELECT credential.id, credential.number, credential.state, credential.rendered, credential.sha256, credential.verification_code,
      credential.issued_at, kind.label AS type, kind.category, kind.scope_id, credential.holder_id AS account_id, scope.label AS institution, credential.content,
      coalesce((SELECT jsonb_agg(jsonb_build_object('signer', signer.display_name, 'at', signature.signed_at) ORDER BY signature.signed_at) FROM unoa.credential_signature AS signature
        JOIN unoa.account AS signer ON signer.id = signature.signer_id WHERE signature.credential_id = credential.id), '[]') AS signatures
    FROM unoa.credential JOIN unoa.credential_type AS kind ON kind.id = credential.type_id
    JOIN unoa.scope ON scope.id = kind.scope_id WHERE credential.id = $1`, [uuid(id)]);
  ensure(credential, 404, 'Document introuvable');
  const own = credential.account_id === actor;
  ensure(own || (await rights(store, actor, credential.scope_id))?.read, 403, 'Document réservé');
  ensure(credential.state === 'issued' || !own, 423, 'Document non délivré ou révoqué : impression impossible');
  const url = `${origin}/verifier/${credential.verification_code}`;
  const qr = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  return { ...credential, own, url, qr };
}

export async function myDocuments(settings: IamSettings, actor: string) {
  const store = database(settings);
  const [credentials, external] = await Promise.all([
    store.query<{ id: string; number: string; state: string; type: string; category: string; issued_at: Date | null; institution: string }>(`SELECT credential.id, credential.number, credential.state,
      kind.label AS type, kind.category, credential.issued_at, scope.label AS institution FROM unoa.credential JOIN unoa.credential_type AS kind ON kind.id = credential.type_id
      JOIN unoa.scope ON scope.id = kind.scope_id WHERE credential.holder_id = $1 AND credential.state <> 'pending_signature' ORDER BY credential.created_at DESC`, [actor]),
    // External diplomas keep their own status (CRED-010): issued by an authority, verified, never re-issued here.
    store.query<{ id: string; kind: string; issuing_authority: string; state: string; exam: string }>(`SELECT evidence.id, evidence.kind, evidence.issuing_authority, evidence.state, exam.title AS exam
      FROM unoa.external_evidence AS evidence JOIN unoa.external_participation AS participation ON participation.id = evidence.participation_id
      JOIN unoa.external_exam AS exam ON exam.id = participation.exam_id WHERE participation.account_id = $1 ORDER BY evidence.deposited_at DESC`, [actor]),
  ]);
  return { credentials: credentials.rows, external: external.rows };
}

// Open Badges 3.0 achievement credential (CRED-011), for a badge the holder owns.
// It carries the hosted verification link; no cryptographic proof is attached
// until the establishment provides a signing key.
export async function badgeExport(settings: IamSettings, actor: string, id: string, origin: string) {
  const view = await credentialView(settings, actor, id, origin);
  ensure(view.own, 403, 'Export réservé au titulaire');
  ensure(view.category === 'badge', 422, 'Seuls les badges s’exportent dans ce format');
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json'],
    id: view.url, type: ['VerifiableCredential', 'OpenBadgeCredential'],
    issuer: { id: `${origin}/verifier`, type: ['Profile'], name: view.institution },
    validFrom: view.issued_at, name: view.type,
    credentialSubject: { type: ['AchievementSubject'], achievement: { id: `${origin}/verifier/${view.verification_code}#achievement`, type: ['Achievement'], name: view.type,
      description: view.rendered.split('\n').slice(2).join(' ').slice(0, 500), criteria: { narrative: 'Conditions de délivrance fixées par l’établissement.' } } },
    evidence: [{ id: view.url, type: ['Evidence'], name: 'Vérification hébergée par l’établissement', description: `Empreinte SHA-256 : ${view.sha256}` }],
  };
}

export async function verify(settings: IamSettings, code: string) {
  const { rows } = await database(settings).query<{ state: string; type_label: string; category: string; issuing_authority: string; institution: string; number: string;
    issued_at: Date | null; revoked_at: Date | null; holder_initials: string | null; replaced_by_number: string | null }>('SELECT * FROM unoa.verify_credential($1)', [code.toUpperCase()]);
  return rows[0] ?? null;
}
