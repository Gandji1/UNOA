import 'server-only';
import { createHash } from 'node:crypto';
import { matchesFormat } from '@unoa/domain/forms';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, day, ensure, flag, https, optional, Problem, text, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';

// Partner companies (module ENT). Staff of an establishment verify and decide;
// the company's members act only on their company. Public profile and private
// information are separate; an approved company never sees student records.

export const companyStates: Record<string, string> = { pending: 'En vérification', approved: 'Approuvée', suspended: 'Suspendue', rejected: 'Refusée', closed: 'Close' };
export const memberRoles: Record<string, string> = { owner: 'Responsable', recruiter: 'Recruteur', tutor: 'Maître de stage' };
export const documentKinds: Record<string, string> = { registration: 'Immatriculation (registre du commerce)', mandate: 'Mandat du représentant', identity: 'Pièce d’identité du représentant', other: 'Autre justificatif' };

type Right = 'read' | 'verify' | 'manage';
export async function companyRights(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`SELECT unoa.has_scope_permission($1, 'ent.read', $2) AS read,
    unoa.has_scope_permission($1, 'ent.verify', $2) AS verify, unoa.has_scope_permission($1, 'ent.manage', $2) AS manage`, [actor, scopeId]);
  return rows[0];
}
async function requireRight(store: Queryable, actor: string, scopeId: string, right: Right) {
  const granted = await companyRights(store, actor, scopeId);
  ensure(granted?.[right], 403, 'Action réservée aux responsables des entreprises partenaires');
  return granted;
}

export interface CompanyRow { id: string; scope_id: string; parent_id: string | null; name: string; state: string; created_by: string }
export async function companyOf(store: Queryable, id: unknown, lock = false) {
  const { rows } = await store.query<CompanyRow>(`SELECT id, scope_id, parent_id, name, state, created_by FROM unoa.company WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [uuid(id)]);
  ensure(rows[0], 404, 'Entreprise introuvable');
  return rows[0];
}
export async function memberRole(store: Queryable, actor: string, companyId: string) {
  const { rows } = await store.query<{ role: string }>('SELECT role FROM unoa.company_member WHERE company_id = $1 AND account_id = $2 AND removed_at IS NULL', [companyId, actor]);
  return rows[0]?.role ?? null;
}
async function requireOwner(store: Queryable, actor: string, company: CompanyRow) {
  ensure(await memberRole(store, actor, company.id) === 'owner', 403, 'Action réservée au responsable de l’entreprise');
}
async function trace(store: Queryable, companyId: string, actor: string, action: string, detail: string | null = null) {
  await store.query('INSERT INTO unoa.company_activity(company_id, actor_id, action, detail) VALUES ($1, $2, $3, $4)', [companyId, actor, action, detail]);
}
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const optionalLine = (limit: number, label: string) => (value: unknown) => boundedText(value, limit, label).trim();

function profile(input: Input) {
  return {
    name: boundedText(input.name, 200, 'Raison sociale').trim(),
    legalForm: optional(input.legalForm, optionalLine(100, 'Forme juridique')),
    sector: optional(input.sector, optionalLine(200, 'Secteur')),
    city: optional(input.city, optionalLine(200, 'Ville')),
    website: optional(input.website, value => https(value, 'Site web')),
    description: optional(input.description, text(4000, 'Présentation')),
    address: optional(input.address, text(1000, 'Adresse')),
    representativeName: boundedText(input.representativeName, 200, 'Nom du représentant').trim(),
    representativeTitle: boundedText(input.representativeTitle, 200, 'Fonction du représentant').trim(),
    contactEmail: optional(input.contactEmail, value => {
      const email = boundedText(value, 254, 'Courriel').trim().toLowerCase();
      ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, 'Courriel invalide');
      return email;
    }),
    contactPhone: optional(input.contactPhone, optionalLine(40, 'Téléphone')),
  };
}

// --------------------------------------------------------------- registration

export async function registerCompany(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const scopeId = uuid(input.scopeId);
  const item = profile(input);
  const registration = boundedText(input.registrationNumber, 80, 'Numéro d’immatriculation').trim();
  ensure(registration.length >= 3, 400, 'Numéro d’immatriculation invalide');
  const country = boundedText(input.country, 100, 'Pays d’immatriculation').trim();
  return transaction(settings, 'unoa.company.register', async store => {
    const { rows: [scope] } = await store.query<{ level: string | null }>('SELECT unoa.cascade_level($1) AS level', [scopeId]);
    ensure(scope && ['institution', 'centre'].includes(scope.level ?? ''), 422, 'Choisissez un établissement');
    const parentId = optional(input.parentId, uuid);
    if (parentId) {
      const parent = await companyOf(store, parentId);
      await requireOwner(store, actor, parent);
      ensure(parent.state === 'approved' && parent.scope_id === scopeId, 422, 'Une antenne dépend d’une entreprise approuvée du même établissement');
    }
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.company(scope_id, parent_id, name, legal_form, registration_number, country, sector, city, website, description,
      address, representative_name, representative_title, contact_email, contact_phone, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [scopeId, parentId, item.name, item.legalForm, registration, country, item.sector, item.city, item.website, item.description, item.address, item.representativeName,
        item.representativeTitle, item.contactEmail, item.contactPhone, actor]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Cette entreprise est déjà inscrite auprès de l’établissement');
      throw error;
    });
    await store.query("INSERT INTO unoa.company_member(company_id, account_id, role, job_title, added_by) VALUES ($1, $2, 'owner', $3, $2)", [rows[0].id, actor, item.representativeTitle]);
    await trace(store, rows[0].id, actor, 'company.registered');
    await audit(store, actor, scopeId, 'ent.company_registered', correlation, rows[0].id);
    return { companyId: rows[0].id };
  });
}

export async function uploadCompanyDocument(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const file = input.file;
  ensure(file instanceof File, 400, 'Fichier requis');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  const format = extension === 'jpeg' ? 'jpg' : extension;
  ensure(['pdf', 'png', 'jpg'].includes(format) && matchesFormat(bytes, format as 'pdf' | 'png' | 'jpg'), 400, 'Formats acceptés : PDF, PNG, JPG');
  ensure(bytes.byteLength > 0 && bytes.byteLength <= 10 * 1024 * 1024, 413, 'Fichier de 10 Mo au plus');
  const kind = choice(input.kind, ['registration', 'mandate', 'identity', 'other'] as const, 'Nature de la pièce');
  return transaction(settings, 'unoa.company.document', async store => {
    const company = await companyOf(store, input.companyId, true);
    await requireOwner(store, actor, company);
    ensure(['pending', 'approved', 'suspended'].includes(company.state), 409, 'Entreprise close ou refusée');
    await store.query(`INSERT INTO unoa.company_document(company_id, kind, filename, format, size_bytes, sha256, content, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [company.id, kind, file.name.slice(0, 200), format, bytes.byteLength, sha(bytes), Buffer.from(bytes), actor]);
    await trace(store, company.id, actor, 'company.document_added', documentKinds[kind]);
    await audit(store, actor, company.scope_id, 'ent.document_added', correlation, company.id);
    return { companyId: company.id };
  });
}

export async function companyDocument(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const { rows: [document] } = await store.query<{ company_id: string; filename: string; format: string; content: Buffer | null }>(
    'SELECT company_id, filename, format, content FROM unoa.company_document WHERE id = $1', [uuid(id)]);
  ensure(document, 404, 'Pièce introuvable');
  const company = await companyOf(store, document.company_id);
  ensure(await memberRole(store, actor, company.id) === 'owner' || (await companyRights(store, actor, company.scope_id))?.read, 403, 'Pièce inaccessible');
  ensure(document.content, 410, 'Pièce purgée à la clôture de l’entreprise');
  return document as { company_id: string; filename: string; format: string; content: Buffer };
}

// Closure: members removed, documents purged, history (verifications, activity) kept.
async function close(store: Queryable, actor: string, company: CompanyRow) {
  await store.query("UPDATE unoa.company SET state = 'closed', closed_at = now() WHERE id = $1", [company.id]);
  await store.query('UPDATE unoa.company_member SET removed_at = now(), removed_by = $2 WHERE company_id = $1 AND removed_at IS NULL', [company.id, actor]);
  await store.query('UPDATE unoa.company_document SET content = NULL, purged_at = now() WHERE company_id = $1 AND content IS NOT NULL', [company.id]);
  await store.query("UPDATE unoa.partnership SET state = 'ended' WHERE company_id = $1 AND state = 'active'", [company.id]);
}

const decisions = { approved: 'approuvée', rejected: 'refusée', suspended: 'suspendue', reinstated: 'rétablie', closed: 'close' } as const;
const transitions: Record<string, string[]> = { pending: ['approved', 'rejected'], approved: ['suspended', 'closed'], suspended: ['reinstated', 'closed'] };

export async function companyAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.company.' + action, async store => {
    if (action === 'report') {
      const company = await companyOf(store, input.companyId);
      await store.query('INSERT INTO unoa.company_report(company_id, reporter_id, reason) VALUES ($1, $2, $3)', [company.id, actor, boundedText(input.reason, 2000, 'Motif du signalement')]);
      await audit(store, actor, company.scope_id, 'ent.reported', correlation, company.id);
      return { companyId: company.id };
    }
    if (action === 'handle-report') {
      const { rows: [report] } = await store.query<{ id: string; company_id: string; state: string }>('SELECT id, company_id, state FROM unoa.company_report WHERE id = $1 FOR UPDATE', [uuid(input.reportId)]);
      ensure(report, 404, 'Signalement introuvable');
      const company = await companyOf(store, report.company_id);
      await requireRight(store, actor, company.scope_id, 'manage');
      ensure(report.state === 'open', 409, 'Signalement déjà traité');
      await store.query("UPDATE unoa.company_report SET state = 'closed', outcome = $2, handled_by = $3 WHERE id = $1", [report.id, boundedText(input.outcome, 2000, 'Suite donnée'), actor]);
      await audit(store, actor, company.scope_id, 'ent.report_handled', correlation, report.id);
      return { scopeId: company.scope_id };
    }
    if (action === 'partnership-sign') {
      const { rows: [deal] } = await store.query<{ id: string; company_id: string; scope_id: string; state: string; company_signed_at: Date | null; institution_signed_at: Date | null;
        company_signed_by: string | null; institution_signed_by: string | null }>('SELECT * FROM unoa.partnership WHERE id = $1 FOR UPDATE', [uuid(input.partnershipId)]);
      ensure(deal, 404, 'Convention introuvable');
      ensure(deal.state === 'draft', 409, 'Convention déjà signée');
      const company = await companyOf(store, deal.company_id);
      ensure(company.state === 'approved', 422, 'Entreprise non approuvée');
      const party = choice(input.party, ['company', 'institution'] as const, 'Partie');
      if (party === 'company') {
        await requireOwner(store, actor, company);
        ensure(!deal.company_signed_at, 409, 'Déjà signée par l’entreprise');
        ensure(deal.institution_signed_by !== actor, 403, 'Une même personne ne signe pas pour les deux parties');
        await store.query('UPDATE unoa.partnership SET company_signed_by = $2, company_signed_at = now() WHERE id = $1', [deal.id, actor]);
        await trace(store, company.id, actor, 'partnership.signed');
      } else {
        await requireRight(store, actor, deal.scope_id, 'manage');
        ensure(!deal.institution_signed_at, 409, 'Déjà signée par l’établissement');
        ensure(deal.company_signed_by !== actor, 403, 'Une même personne ne signe pas pour les deux parties');
        await store.query('UPDATE unoa.partnership SET institution_signed_by = $2, institution_signed_at = now() WHERE id = $1', [deal.id, actor]);
      }
      await store.query("UPDATE unoa.partnership SET state = 'active' WHERE id = $1 AND company_signed_at IS NOT NULL AND institution_signed_at IS NOT NULL", [deal.id]);
      await audit(store, actor, deal.scope_id, 'ent.partnership_signed', correlation, deal.id);
      return { companyId: company.id, scopeId: deal.scope_id };
    }

    const company = await companyOf(store, input.companyId, true);
    if (action === 'update') {
      await requireOwner(store, actor, company);
      ensure(['pending', 'approved', 'suspended'].includes(company.state), 409, 'Entreprise close ou refusée');
      const item = profile(input);
      await store.query(`UPDATE unoa.company SET name = $2, legal_form = $3, sector = $4, city = $5, website = $6, description = $7, address = $8, representative_name = $9,
        representative_title = $10, contact_email = $11, contact_phone = $12 WHERE id = $1`, [company.id, item.name, item.legalForm, item.sector, item.city, item.website, item.description,
        item.address, item.representativeName, item.representativeTitle, item.contactEmail, item.contactPhone]);
      await trace(store, company.id, actor, 'company.updated');
      return { companyId: company.id };
    }
    if (action === 'verify') {
      await requireRight(store, actor, company.scope_id, 'verify');
      ensure(company.created_by !== actor && !(await memberRole(store, actor, company.id)), 403, 'Un déclarant ou un membre ne vérifie pas sa propre entreprise');
      const decision = choice(input.decision, ['approved', 'rejected', 'suspended', 'reinstated', 'closed'] as const, 'Décision');
      ensure((transitions[company.state] ?? []).includes(decision), 409, 'Décision impossible dans l’état actuel');
      const legal = flag(input.legalExists); const mandate = flag(input.mandateOk);
      const reason = optional(input.reason, text(2000, 'Motif'));
      if (decision === 'approved' || decision === 'reinstated') {
        ensure(legal && mandate, 422, 'Existence légale et mandat du représentant doivent être contrôlés');
        const { rows } = await store.query<{ kind: string }>('SELECT DISTINCT kind FROM unoa.company_document WHERE company_id = $1 AND content IS NOT NULL', [company.id]);
        const kinds = new Set(rows.map(row => row.kind));
        ensure(kinds.has('registration') && kinds.has('mandate'), 422, 'Pièces requises : immatriculation et mandat du représentant');
      } else ensure(reason, 400, 'Motivez la décision');
      await store.query('INSERT INTO unoa.company_verification(company_id, verifier_id, legal_exists, mandate_ok, decision, reason) VALUES ($1, $2, $3, $4, $5, $6)',
        [company.id, actor, legal, mandate, decision, reason]);
      if (decision === 'closed') await close(store, actor, company);
      else await store.query('UPDATE unoa.company SET state = $2, decision_reason = $3, decided_by = $4, decided_at = now() WHERE id = $1',
        [company.id, decision === 'reinstated' ? 'approved' : decision, reason, actor]);
      const { rows: owners } = await store.query<{ account_id: string }>("SELECT account_id FROM unoa.company_member WHERE company_id = $1 AND role = 'owner' AND removed_at IS NULL", [company.id]);
      await dispatch(store, { event: 'ent.decided', scopeId: company.scope_id, recipients: [company.created_by, ...owners.map(row => row.account_id)], correlation,
        values: { company: company.name, decision: decisions[decision] }, link: '/entreprise' });
      await audit(store, actor, company.scope_id, 'ent.company_' + decision, correlation, company.id);
      return { scopeId: company.scope_id };
    }
    if (action === 'close') {
      await requireOwner(store, actor, company);
      ensure(company.state !== 'closed', 409, 'Entreprise déjà close');
      await trace(store, company.id, actor, 'company.closed', optional(input.reason, text(500, 'Motif')));
      await close(store, actor, company);
      await audit(store, actor, company.scope_id, 'ent.company_closed', correlation, company.id);
      return { companyId: company.id };
    }
    if (action === 'members') {
      await requireOwner(store, actor, company);
      ensure(company.state === 'approved', 422, 'Équipe ouverte après approbation de l’entreprise');
      const login = boundedText(input.login, 120, 'Identifiant').trim().toLowerCase();
      const { rows: [person] } = await store.query<{ account_id: string }>(`SELECT credential.account_id FROM unoa.local_credential AS credential
        JOIN unoa.account ON account.id = credential.account_id WHERE credential.login = $1 AND account.disabled_at IS NULL`, [login]);
      ensure(person, 404, 'Aucun compte actif avec cet identifiant');
      const role = choice(input.role, ['owner', 'recruiter', 'tutor'] as const, 'Rôle');
      await store.query('INSERT INTO unoa.company_member(company_id, account_id, role, job_title, added_by) VALUES ($1, $2, $3, $4, $5)',
        [company.id, person.account_id, role, optional(input.jobTitle, optionalLine(200, 'Fonction')), actor]).catch(error => {
        if (error?.code === '23505') throw new Problem(409, 'Cette personne fait déjà partie de l’équipe');
        throw error;
      });
      await trace(store, company.id, actor, 'member.added', memberRoles[role] + ' · ' + login);
      return { companyId: company.id };
    }
    if (action === 'remove-member') {
      await requireOwner(store, actor, company);
      const { rows: [member] } = await store.query<{ id: string; role: string; account_id: string }>('SELECT id, role, account_id FROM unoa.company_member WHERE id = $1 AND company_id = $2 AND removed_at IS NULL',
        [uuid(input.memberId), company.id]);
      ensure(member, 404, 'Membre introuvable');
      if (member.role === 'owner') {
        const { rows: [count] } = await store.query<{ total: number }>("SELECT count(*)::int AS total FROM unoa.company_member WHERE company_id = $1 AND role = 'owner' AND removed_at IS NULL", [company.id]);
        ensure(count.total > 1, 422, 'L’entreprise garde au moins un responsable');
      }
      await store.query('UPDATE unoa.company_member SET removed_at = now(), removed_by = $2 WHERE id = $1', [member.id, actor]);
      // A departing tutor stops supervising: the internship waits for a replacement.
      await store.query(`UPDATE unoa.internship_supervisor SET ended_at = now(), end_reason = 'Départ de l’entreprise' WHERE account_id = $1 AND role = 'company' AND ended_at IS NULL
        AND internship_id IN (SELECT id FROM unoa.internship WHERE company_id = $2)`, [member.account_id, company.id]);
      await trace(store, company.id, actor, 'member.removed');
      return { companyId: company.id };
    }
    if (action === 'partnerships') {
      await requireRight(store, actor, company.scope_id, 'manage');
      ensure(company.state === 'approved', 422, 'Convention avec une entreprise approuvée');
      const terms = boundedText(input.terms, 20000, 'Clauses');
      ensure(terms.trim().length >= 10, 400, 'Clauses trop courtes');
      const startsOn = day(input.startsOn, 'Début'); const endsOn = day(input.endsOn, 'Fin');
      ensure(endsOn > startsOn, 400, 'La fin suit le début');
      const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.partnership(company_id, scope_id, title, terms, terms_sha256, starts_on, ends_on, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [company.id, company.scope_id, boundedText(input.title, 300, 'Intitulé'), terms, sha(terms), startsOn, endsOn, actor]);
      await audit(store, actor, company.scope_id, 'ent.partnership_drafted', correlation, rows[0].id);
      return { partnershipId: rows[0].id, scopeId: company.scope_id };
    }
    throw new Problem(404, 'Opération inconnue');
  });
}

// --------------------------------------------------------------- read models

export async function establishments(settings: IamSettings) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`SELECT scope.id, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature = 'institution' ORDER BY scope.label LIMIT 500`);
  return rows;
}

export async function companySpace(settings: IamSettings, actor: string) {
  const store = database(settings);
  const { rows: companies } = await store.query<{ id: string; scope_id: string; scope: string; parent_id: string | null; name: string; legal_form: string | null; registration_number: string;
    country: string; sector: string | null; city: string | null; website: string | null; description: string | null; address: string | null; representative_name: string;
    representative_title: string; contact_email: string | null; contact_phone: string | null; state: string; decision_reason: string | null; role: string | null }>(`
    SELECT company.id, company.scope_id, scope.label AS scope, company.parent_id, company.name, company.legal_form, company.registration_number, company.country, company.sector, company.city,
      company.website, company.description, company.address, company.representative_name, company.representative_title, company.contact_email, company.contact_phone, company.state,
      company.decision_reason, member.role
    FROM unoa.company JOIN unoa.scope ON scope.id = company.scope_id
    LEFT JOIN unoa.company_member AS member ON member.company_id = company.id AND member.account_id = $1 AND member.removed_at IS NULL
    WHERE member.id IS NOT NULL OR (company.created_by = $1 AND company.state <> 'closed') ORDER BY company.name`, [actor]);
  const details = [];
  for (const company of companies) {
    const owner = company.role === 'owner';
    const [documents, members, partnerships, internships] = await Promise.all([
      owner ? store.query<{ id: string; kind: string; filename: string; created_at: Date; purged_at: Date | null }>('SELECT id, kind, filename, created_at, purged_at FROM unoa.company_document WHERE company_id = $1 ORDER BY created_at', [company.id]) : { rows: [] },
      store.query<{ id: string; name: string | null; role: string; job_title: string | null }>(`SELECT member.id, account.display_name AS name, member.role, member.job_title FROM unoa.company_member AS member
        JOIN unoa.account ON account.id = member.account_id WHERE member.company_id = $1 AND member.removed_at IS NULL ORDER BY member.role, account.display_name`, [company.id]),
      store.query<{ id: string; title: string; starts_on: string; ends_on: string; state: string; company_signed_at: Date | null; institution_signed_at: Date | null }>(
        'SELECT id, title, starts_on::text, ends_on::text, state, company_signed_at, institution_signed_at FROM unoa.partnership WHERE company_id = $1 ORDER BY created_at DESC', [company.id]),
      // Only what the company needs about its interns: name, title, dates, state (ENT-005).
      store.query<{ id: string; title: string; student: string | null; starts_on: string; ends_on: string; state: string }>(`SELECT internship.id, internship.title, account.display_name AS student,
        internship.starts_on::text, internship.ends_on::text, internship.state FROM unoa.internship JOIN unoa.account ON account.id = internship.student_id
        WHERE internship.company_id = $1 AND internship.state NOT IN ('requested', 'rejected', 'cancelled') ORDER BY internship.starts_on DESC`, [company.id]),
    ]);
    details.push({ ...company, documents: documents.rows, members: members.rows, partnerships: partnerships.rows, internships: internships.rows });
  }
  return { companies: details };
}

export async function companyContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`SELECT scope.id, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature IN ('institution', 'centre') AND unoa.has_scope_permission($1, 'ent.read', scope.id) ORDER BY scope.label LIMIT 200`, [actor]);
  return rows;
}

export async function companiesOverview(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  const granted = await requireRight(store, actor, scopeId, 'read');
  const [label, companies, reports, partnerships, activity] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]),
    store.query<{ id: string; name: string; parent: string | null; registration_number: string; country: string; representative_name: string; representative_title: string;
      state: string; decision_reason: string | null; created_at: Date; documents: { id: string; kind: string; filename: string; purged: boolean }[]; verifications: { decision: string; reason: string | null; at: string; verifier: string | null }[] }>(`
      SELECT company.id, company.name, parent.name AS parent, company.registration_number, company.country, company.representative_name, company.representative_title, company.state,
        company.decision_reason, company.created_at,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id', document.id, 'kind', document.kind, 'filename', document.filename, 'purged', document.purged_at IS NOT NULL) ORDER BY document.created_at)
          FROM unoa.company_document AS document WHERE document.company_id = company.id), '[]') AS documents,
        coalesce((SELECT jsonb_agg(jsonb_build_object('decision', check_row.decision, 'reason', check_row.reason, 'at', check_row.created_at, 'verifier', account.display_name) ORDER BY check_row.created_at)
          FROM unoa.company_verification AS check_row JOIN unoa.account ON account.id = check_row.verifier_id WHERE check_row.company_id = company.id), '[]') AS verifications
      FROM unoa.company LEFT JOIN unoa.company AS parent ON parent.id = company.parent_id
      WHERE unoa.scope_within(company.scope_id, $1) ORDER BY company.state = 'pending' DESC, company.name LIMIT 500`, [scopeId]),
    store.query<{ id: string; company: string; reason: string; state: string; outcome: string | null; created_at: Date }>(`SELECT report.id, company.name AS company, report.reason, report.state, report.outcome, report.created_at
      FROM unoa.company_report AS report JOIN unoa.company ON company.id = report.company_id WHERE unoa.scope_within(company.scope_id, $1) ORDER BY report.state, report.created_at DESC LIMIT 200`, [scopeId]),
    store.query<{ id: string; company: string; title: string; starts_on: string; ends_on: string; state: string; company_signed_at: Date | null; institution_signed_at: Date | null }>(`
      SELECT deal.id, company.name AS company, deal.title, deal.starts_on::text, deal.ends_on::text, deal.state, deal.company_signed_at, deal.institution_signed_at
      FROM unoa.partnership AS deal JOIN unoa.company ON company.id = deal.company_id WHERE unoa.scope_within(deal.scope_id, $1) ORDER BY deal.created_at DESC LIMIT 200`, [scopeId]),
    store.query<{ company: string; actor: string | null; action: string; detail: string | null; created_at: Date }>(`SELECT company.name AS company, account.display_name AS actor, activity.action, activity.detail, activity.created_at
      FROM unoa.company_activity AS activity JOIN unoa.company ON company.id = activity.company_id JOIN unoa.account ON account.id = activity.actor_id
      WHERE unoa.scope_within(company.scope_id, $1) ORDER BY activity.created_at DESC LIMIT 100`, [scopeId]),
  ]);
  ensure(label.rows[0], 404, 'Établissement introuvable');
  return { scope: { id: scopeId, label: label.rows[0].label }, rights: granted, companies: companies.rows, reports: reports.rows, partnerships: partnerships.rows, activity: activity.rows };
}

// Public directory: approved companies of the site's establishment, public profile only (ENT-006).
export async function publicCompanies(settings: IamSettings, scopeId: string | null) {
  if (!scopeId) return [];
  const { rows } = await database(settings).query<{ id: string; name: string; sector: string | null; city: string | null; website: string | null; description: string | null }>(`
    SELECT id, name, sector, city, website, description FROM unoa.company WHERE state = 'approved' AND unoa.scope_within(scope_id, $1) ORDER BY name LIMIT 500`, [scopeId]);
  return rows;
}
