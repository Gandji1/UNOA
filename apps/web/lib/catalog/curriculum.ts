import 'server-only';
// Versioned curricula: draft edition, consistency check, review, immutable
// publication, derived versions, equivalences and study-plan simulation.
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { checkCurriculum, simulatePlan, type CurriculumModel } from '@unoa/domain/curriculum';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { amount, boundedText, businessCode, choice, ensure, flag, integer, list, optional, optionalText, Problem, text, utcTime, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { context, program, requireContext, zones } from './access';
import { insertVersion, versionFields } from './programs';

export const requirementKinds = ['internship', 'thesis', 'defense', 'project', 'other'] as const;

interface VersionRow {
  id: string; program_id: string; number: number; state: string; title: string; organisation: string;
  duration: string; delivery_mode: string; credit_unit: string; expected_credits: string | null;
  languages: string[]; capacity: number | null; objectives: string | null; admission: string | null;
  author_id: string; reviewer_id: string | null; review_note: string | null; published_at: Date | null;
  admission_open: boolean; row_version: number; based_on: string | null;
}

async function lockVersion(store: PoolClient, actor: string, versionId: string) {
  const { rows } = await store.query<VersionRow>('SELECT * FROM unoa.program_version WHERE id = $1 FOR UPDATE', [versionId]);
  ensure(rows[0], 404, 'Version introuvable');
  const found = await program(store, actor, rows[0].program_id);
  ensure(found, 403, 'Programme inaccessible');
  return { version: rows[0], program: found };
}

async function curriculum(store: Queryable, versionId: string, expected: string | null): Promise<CurriculumModel> {
  const [periods, groups, units, prerequisites] = await Promise.all([
    store.query<{ ordinal: number; label: string }>(
      'SELECT ordinal, label FROM unoa.program_period WHERE version_id = $1 ORDER BY ordinal', [versionId],
    ),
    store.query<{ id: string; label: string; ordinal: number; min_choices: number; max_choices: number }>(`
      SELECT grp.id, grp.label, period.ordinal, grp.min_choices, grp.max_choices
      FROM unoa.option_group AS grp JOIN unoa.program_period AS period ON period.id = grp.period_id
      WHERE grp.version_id = $1 ORDER BY period.ordinal, grp.label
    `, [versionId]),
    store.query<{ id: string; code: string; title: string; ordinal: number; credits: string; option_group_id: string | null }>(`
      SELECT unit.id, unit.code, unit.title, period.ordinal, unit.credits, unit.option_group_id
      FROM unoa.teaching_unit AS unit JOIN unoa.program_period AS period ON period.id = unit.period_id
      WHERE unit.version_id = $1 ORDER BY period.ordinal, unit.code
    `, [versionId]),
    store.query<{ unit_id: string; required_unit_id: string }>(
      'SELECT unit_id, required_unit_id FROM unoa.unit_prerequisite WHERE version_id = $1', [versionId],
    ),
  ]);
  return {
    periods: periods.rows,
    groups: groups.rows.map(row => ({ id: row.id, label: row.label, periodOrdinal: row.ordinal, min: row.min_choices, max: row.max_choices })),
    units: units.rows.map(row => ({
      id: row.id, code: row.code, title: row.title, periodOrdinal: row.ordinal, credits: Number(row.credits), groupId: row.option_group_id,
    })),
    prerequisites: prerequisites.rows.map(row => ({ unitId: row.unit_id, requiredUnitId: row.required_unit_id })),
    expectedCredits: expected === null ? null : Number(expected),
  };
}

export async function versionDetails(settings: IamSettings, actor: string, versionId: string) {
  const store = database(settings);
  const { rows } = await store.query<VersionRow>('SELECT * FROM unoa.program_version WHERE id = $1', [uuid(versionId)]);
  ensure(rows[0], 404, 'Version introuvable');
  const version = rows[0];
  const item = await program(store, actor, version.program_id);
  ensure(item, 403, 'Programme inaccessible');
  const scope = await context(store, actor, item.owner_scope_id);
  const model = await curriculum(store, version.id, version.expected_credits);
  const [periods, groups, units, requirements, competencies, territories, equivalences, courses, available, sources] = await Promise.all([
    store.query<{ id: string; ordinal: number; label: string }>(
      'SELECT id, ordinal, label FROM unoa.program_period WHERE version_id = $1 ORDER BY ordinal', [version.id],
    ),
    store.query<{ id: string; period_id: string; label: string; min_choices: number; max_choices: number }>(
      'SELECT id, period_id, label, min_choices, max_choices FROM unoa.option_group WHERE version_id = $1 ORDER BY label', [version.id],
    ),
    store.query<{
      id: string; period_id: string; code: string; title: string; credits: string; coefficient: string;
      option_group_id: string | null; description: string | null;
      volumes: { activity: string; hours: string }[]; courses: { id: string; code: string; title: string; coefficient: string }[];
      requires: string[]; competencies: { id: string; code: string; level: string }[];
    }>(`
      SELECT unit.id, unit.period_id, unit.code, unit.title, unit.credits, unit.coefficient, unit.option_group_id, unit.description,
        coalesce((SELECT jsonb_agg(jsonb_build_object('activity', activity, 'hours', hours) ORDER BY activity)
          FROM unoa.unit_volume WHERE unit_id = unit.id), '[]') AS volumes,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id', course.id, 'code', course.code, 'title', course.title,
          'coefficient', link.coefficient) ORDER BY course.code)
          FROM unoa.unit_course AS link JOIN unoa.course ON course.id = link.course_id WHERE link.unit_id = unit.id), '[]') AS courses,
        coalesce((SELECT jsonb_agg(required_unit_id) FROM unoa.unit_prerequisite WHERE unit_id = unit.id), '[]') AS requires,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id', competency.id, 'code', competency.code, 'level', link.level))
          FROM unoa.unit_competency AS link JOIN unoa.competency ON competency.id = link.competency_id
          WHERE link.unit_id = unit.id), '[]') AS competencies
      FROM unoa.teaching_unit AS unit WHERE unit.version_id = $1 ORDER BY unit.code
    `, [version.id]),
    store.query<{ id: string; kind: string; label: string; credits: string | null; mandatory: boolean; conditions: string | null; period_id: string | null }>(
      'SELECT id, kind, label, credits, mandatory, conditions, period_id FROM unoa.version_requirement WHERE version_id = $1 ORDER BY label',
      [version.id],
    ),
    store.query<{ id: string; code: string; label: string }>(`
      SELECT competency.id, competency.code, competency.label FROM unoa.version_competency AS link
      JOIN unoa.competency ON competency.id = link.competency_id WHERE link.version_id = $1 ORDER BY competency.code
    `, [version.id]),
    store.query<{ id: string; label: string }>(`
      SELECT scope.id, scope.label FROM unoa.version_territory AS link JOIN unoa.scope ON scope.id = link.territory_id
      WHERE link.version_id = $1 ORDER BY scope.label
    `, [version.id]),
    store.query<{ id: string; target_code: string; source_code: string; source_number: number; source_program: string; note: string | null }>(`
      SELECT equivalence.id, target.code AS target_code, source.code AS source_code, source_version.number AS source_number,
             source_program.code AS source_program, equivalence.note
      FROM unoa.unit_equivalence AS equivalence
      JOIN unoa.teaching_unit AS target ON target.id = equivalence.target_unit_id
      JOIN unoa.teaching_unit AS source ON source.id = equivalence.source_unit_id
      JOIN unoa.program_version AS source_version ON source_version.id = equivalence.source_version_id
      JOIN unoa.program AS source_program ON source_program.id = source_version.program_id
      WHERE equivalence.version_id = $1 ORDER BY target.code
    `, [version.id]),
    store.query<{ id: string; code: string; title: string }>(
      'SELECT id, code, title FROM unoa.course WHERE institution_id = $1 ORDER BY code LIMIT 1000', [item.institution_id],
    ),
    store.query<{ id: string; code: string; label: string }>(`
      SELECT id, code, label FROM unoa.competency
      WHERE owner_scope_id IN ($1, $2) ORDER BY code LIMIT 1000
    `, [item.owner_scope_id, item.institution_id]),
    store.query<{ unit_id: string; version_id: string; label: string }>(`
      SELECT unit.id AS unit_id, version.id AS version_id,
             program.code || ' v' || version.number || ' · ' || unit.code || ' ' || unit.title AS label
      FROM unoa.teaching_unit AS unit
      JOIN unoa.program_version AS version ON version.id = unit.version_id
      JOIN unoa.program ON program.id = version.program_id
      WHERE program.institution_id = $1 AND version.state IN ('published', 'retired') AND version.id <> $2
      ORDER BY program.code, version.number DESC, unit.code LIMIT 1000
    `, [item.institution_id, version.id]),
  ]);
  return {
    version, program: item, scope, model, issues: checkCurriculum(model),
    periods: periods.rows, groups: groups.rows, units: units.rows, requirements: requirements.rows,
    competencies: competencies.rows, territories: territories.rows, equivalences: equivalences.rows,
    courses: courses.rows, availableCompetencies: available.rows, equivalenceSources: sources.rows,
    zones: await zones(store, item.institution_id, ['territory']),
  };
}

async function draft(store: PoolClient, actor: string, versionId: string) {
  const found = await lockVersion(store, actor, versionId);
  await requireContext(store, actor, found.program.owner_scope_id, 'write');
  ensure(found.version.state === 'draft', 409, 'Seul un brouillon est modifiable');
  return found;
}

type Editor = (store: PoolClient, version: VersionRow, input: Input) => Promise<string | null>;

const editors: Record<string, Editor> = {
  async update(store, version, input) {
    const item = versionFields(input);
    await store.query(`
      UPDATE unoa.program_version SET title = $2, organisation = $3, duration = $4, delivery_mode = $5, credit_unit = $6,
        expected_credits = $7, languages = $8, capacity = $9, objectives = $10, admission = $11 WHERE id = $1
    `, [version.id, item.title, item.organisation, item.duration, item.deliveryMode, item.creditUnit,
      item.expectedCredits, item.languages, item.capacity, item.objectives, item.admission]);
    return version.id;
  },
  async periods(store, version, input) {
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.program_period(version_id, ordinal, label) VALUES ($1, $2, $3) RETURNING id
    `, [version.id, integer(input.ordinal, 'Rang', 1, 100), boundedText(input.label, 120, 'Libellé')]);
    return rows[0].id;
  },
  async groups(store, version, input) {
    const min = integer(input.minChoices, 'Minimum', 0, 100);
    const max = integer(input.maxChoices, 'Maximum', 1, 100);
    ensure(max >= min, 400, 'Bornes incohérentes');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.option_group(version_id, period_id, label, min_choices, max_choices) VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [version.id, uuid(input.periodId), boundedText(input.label, 160, 'Libellé'), min, max]);
    return rows[0].id;
  },
  async units(store, version, input) {
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.teaching_unit(version_id, period_id, code, title, credits, coefficient, option_group_id, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `, [version.id, uuid(input.periodId), businessCode(input.code), boundedText(input.title, 200, 'Intitulé'),
      amount(input.credits, 'Crédits'), optional(input.coefficient, value => amount(value, 'Coefficient', true)) ?? 1,
      optional(input.optionGroupId, uuid), optional(input.description, text(2000, 'Description'))]);
    return rows[0].id;
  },
  async volumes(store, version, input) {
    const unitId = uuid(input.unitId);
    await store.query(`
      INSERT INTO unoa.unit_volume(unit_id, version_id, activity, hours) VALUES ($1, $2, $3, $4)
      ON CONFLICT (unit_id, activity) DO UPDATE SET hours = excluded.hours
    `, [unitId, version.id, boundedText(input.activity, 60, 'Activité'), amount(input.hours, 'Volume horaire', true)]);
    return unitId;
  },
  async courses(store, version, input) {
    const unitId = uuid(input.unitId);
    await store.query(`
      INSERT INTO unoa.unit_course(unit_id, version_id, course_id, coefficient, credits) VALUES ($1, $2, $3, $4, $5)
    `, [unitId, version.id, uuid(input.courseId), optional(input.coefficient, value => amount(value, 'Coefficient', true)) ?? 1,
      optional(input.credits, value => amount(value, 'Crédits'))]);
    return unitId;
  },
  async prerequisites(store, version, input) {
    const unitId = uuid(input.unitId);
    await store.query(`
      INSERT INTO unoa.unit_prerequisite(unit_id, required_unit_id, version_id) VALUES ($1, $2, $3)
    `, [unitId, uuid(input.requiredUnitId), version.id]);
    return unitId;
  },
  async competencies(store, version, input) {
    const competencyId = uuid(input.competencyId);
    await store.query(`
      INSERT INTO unoa.version_competency(version_id, competency_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
    `, [version.id, competencyId]);
    if (optionalText(input.unitId) !== null) {
      await store.query(`
        INSERT INTO unoa.unit_competency(unit_id, version_id, competency_id, level) VALUES ($1, $2, $3, $4)
      `, [uuid(input.unitId), version.id, competencyId, boundedText(input.level, 60, 'Niveau')]);
    }
    return competencyId;
  },
  async requirements(store, version, input) {
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.version_requirement(version_id, kind, label, period_id, credits, mandatory, conditions)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [version.id, choice(input.kind, requirementKinds, 'Nature'), boundedText(input.label, 200, 'Libellé'),
      optional(input.periodId, uuid), optional(input.credits, value => amount(value, 'Crédits')),
      input.mandatory === undefined ? true : flag(input.mandatory), optional(input.conditions, text(2000, 'Conditions'))]);
    return rows[0].id;
  },
  async territories(store, version, input) {
    const territoryId = uuid(input.territoryId);
    await store.query('INSERT INTO unoa.version_territory(version_id, territory_id) VALUES ($1, $2)', [version.id, territoryId]);
    return territoryId;
  },
  async equivalences(store, version, input) {
    const source = typeof input.source === 'string' ? input.source.split(':') : [input.sourceVersionId, input.sourceUnitId];
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.unit_equivalence(version_id, target_unit_id, source_version_id, source_unit_id, note, created_by)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [version.id, uuid(input.targetUnitId), uuid(source[0]), uuid(source[1]), optional(input.note, text(1000, 'Note')),
      (input as { actor: string }).actor]);
    return rows[0].id;
  },
};

// Removal targets draft content only; each table is listed explicitly.
const removals: Record<string, (store: PoolClient, version: VersionRow, input: Input) => Promise<number>> = {
  async unit(store, version, input) {
    const unitId = uuid(input.itemId);
    for (const table of ['unit_volume', 'unit_course', 'unit_competency']) {
      await store.query(`DELETE FROM unoa.${table} WHERE unit_id = $1 AND version_id = $2`, [unitId, version.id]);
    }
    await store.query('DELETE FROM unoa.unit_prerequisite WHERE (unit_id = $1 OR required_unit_id = $1) AND version_id = $2', [unitId, version.id]);
    await store.query('DELETE FROM unoa.unit_equivalence WHERE target_unit_id = $1 AND version_id = $2', [unitId, version.id]);
    return (await store.query('DELETE FROM unoa.teaching_unit WHERE id = $1 AND version_id = $2', [unitId, version.id])).rowCount ?? 0;
  },
  async prerequisite(store, version, input) {
    return (await store.query('DELETE FROM unoa.unit_prerequisite WHERE unit_id = $1 AND required_unit_id = $2 AND version_id = $3',
      [uuid(input.itemId), uuid(input.requiredUnitId), version.id])).rowCount ?? 0;
  },
  async requirement(store, version, input) {
    return (await store.query('DELETE FROM unoa.version_requirement WHERE id = $1 AND version_id = $2', [uuid(input.itemId), version.id])).rowCount ?? 0;
  },
  async territory(store, version, input) {
    return (await store.query('DELETE FROM unoa.version_territory WHERE territory_id = $1 AND version_id = $2', [uuid(input.itemId), version.id])).rowCount ?? 0;
  },
  async equivalence(store, version, input) {
    return (await store.query('DELETE FROM unoa.unit_equivalence WHERE id = $1 AND version_id = $2', [uuid(input.itemId), version.id])).rowCount ?? 0;
  },
  async group(store, version, input) {
    return (await store.query('DELETE FROM unoa.option_group WHERE id = $1 AND version_id = $2', [uuid(input.itemId), version.id])).rowCount ?? 0;
  },
  async period(store, version, input) {
    return (await store.query('DELETE FROM unoa.program_period WHERE id = $1 AND version_id = $2', [uuid(input.itemId), version.id])).rowCount ?? 0;
  },
};

export async function editVersion(settings: IamSettings, actor: string, id: string, part: string, input: Input, correlation: string) {
  const versionId = uuid(id);
  const editor = editors[part];
  ensure(editor, 404, 'Opération inconnue');
  return transaction(settings, 'unoa.catalog.version.' + versionId, async store => {
    const { version, program: item } = await draft(store, actor, versionId);
    const target = await editor(store, version, { ...input, actor });
    await audit(store, actor, item.owner_scope_id, 'catalog.version_edited', correlation, target);
    return { scopeId: item.owner_scope_id, id: versionId };
  });
}

export async function removeFromVersion(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const versionId = uuid(id);
  const remove = removals[String(input.kind)];
  ensure(remove, 400, 'Élément inconnu');
  return transaction(settings, 'unoa.catalog.version.' + versionId, async store => {
    const { version, program: item } = await draft(store, actor, versionId);
    ensure(await remove(store, version, input) === 1, 404, 'Élément introuvable dans ce brouillon');
    await audit(store, actor, item.owner_scope_id, 'catalog.version_edited', correlation, versionId);
    return { scopeId: item.owner_scope_id, id: versionId };
  });
}

export async function transitionVersion(settings: IamSettings, actor: string, id: string, action: string, input: Input, correlation: string) {
  const versionId = uuid(id);
  return transaction(settings, 'unoa.catalog.version.' + versionId, async store => {
    const { version, program: item } = await lockVersion(store, actor, versionId);
    const owner = item.owner_scope_id;
    let event: string;
    if (action === 'submit') {
      await requireContext(store, actor, owner, 'write');
      ensure(version.state === 'draft', 409, 'Seul un brouillon est soumis');
      const issues = checkCurriculum(await curriculum(store, version.id, version.expected_credits));
      ensure(issues.length === 0, 422, 'La maquette présente des incohérences');
      await store.query("UPDATE unoa.program_version SET state = 'review', submitted_at = now(), review_note = NULL WHERE id = $1", [version.id]);
      event = 'catalog.version_submitted';
    } else if (action === 'review') {
      await requireContext(store, actor, owner, 'review');
      ensure(version.state === 'review', 409, 'Cette version n’est pas en revue');
      ensure(version.author_id !== actor, 403, 'La revue revient à une autre personne que l’auteur');
      const decision = choice(input.decision, ['approve', 'reject'] as const, 'Décision');
      const note = optional(input.note, text(1000, 'Observation'));
      ensure(decision === 'approve' || note, 400, 'Motiver le renvoi en brouillon');
      await store.query(`
        UPDATE unoa.program_version SET state = $2, reviewer_id = $3, reviewed_at = now(), review_note = $4 WHERE id = $1
      `, [version.id, decision === 'approve' ? 'approved' : 'draft', actor, note]);
      event = 'catalog.version_reviewed';
    } else if (action === 'publish') {
      await requireContext(store, actor, owner, 'publish');
      ensure(version.state === 'approved', 409, 'Seule une version approuvée est publiée');
      await store.query("UPDATE unoa.program_version SET state = 'retired' WHERE program_id = $1 AND state = 'published'", [item.id]);
      await store.query(`
        UPDATE unoa.program_version SET state = 'published', publisher_id = $2, published_at = now() WHERE id = $1
      `, [version.id, actor]);
      event = 'catalog.version_published';
    } else if (action === 'admission') {
      await requireContext(store, actor, owner, 'publish');
      ensure(version.state === 'published', 409, 'Seule la version publiée ouvre aux candidatures');
      const open = flag(input.open);
      ensure(!open || item.admission_allowed, 422, 'Aucune autorisation vérifiée ne permet d’ouvrir les candidatures');
      await store.query(`
        UPDATE unoa.program_version SET admission_open = $2, admission_changed_by = $3, admission_changed_at = now() WHERE id = $1
      `, [version.id, open, actor]);
      event = 'catalog.admission_changed';
    } else if (action === 'derive') {
      await requireContext(store, actor, owner, 'write');
      ensure(version.state === 'published' || version.state === 'retired', 409, 'Une nouvelle version part d’une version publiée');
      const { rows } = await store.query<{ next: number }>(
        'SELECT max(number) + 1 AS next FROM unoa.program_version WHERE program_id = $1', [item.id],
      );
      const created = await insertVersion(store, item.id, rows[0].next, version.id, {
        title: version.title, organisation: version.organisation, duration: version.duration,
        deliveryMode: version.delivery_mode, creditUnit: version.credit_unit,
        expectedCredits: version.expected_credits === null ? null : Number(version.expected_credits),
        languages: version.languages, capacity: version.capacity, objectives: version.objectives, admission: version.admission,
      }, actor);
      await copyCurriculum(store, version.id, created);
      await audit(store, actor, owner, 'catalog.version_created', correlation, created);
      return { scopeId: owner, id: created };
    } else {
      throw new Problem(404, 'Opération inconnue');
    }
    await audit(store, actor, owner, event, correlation, version.id);
    return { scopeId: owner, id: version.id };
  });
}

// A new version starts as a faithful draft copy; the published one stays untouched.
async function copyCurriculum(store: PoolClient, from: string, to: string) {
  const map = new Map<string, string>();
  const fresh = (old: string) => {
    if (!map.has(old)) map.set(old, randomUUID());
    return map.get(old)!;
  };
  const periods = await store.query('SELECT id, ordinal, label FROM unoa.program_period WHERE version_id = $1', [from]);
  for (const row of periods.rows) {
    await store.query('INSERT INTO unoa.program_period(id, version_id, ordinal, label) VALUES ($1, $2, $3, $4)',
      [fresh(row.id), to, row.ordinal, row.label]);
  }
  const groups = await store.query('SELECT * FROM unoa.option_group WHERE version_id = $1', [from]);
  for (const row of groups.rows) {
    await store.query(`
      INSERT INTO unoa.option_group(id, version_id, period_id, label, min_choices, max_choices) VALUES ($1, $2, $3, $4, $5, $6)
    `, [fresh(row.id), to, fresh(row.period_id), row.label, row.min_choices, row.max_choices]);
  }
  const units = await store.query('SELECT * FROM unoa.teaching_unit WHERE version_id = $1', [from]);
  for (const row of units.rows) {
    await store.query(`
      INSERT INTO unoa.teaching_unit(id, version_id, period_id, code, title, credits, coefficient, option_group_id, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [fresh(row.id), to, fresh(row.period_id), row.code, row.title, row.credits, row.coefficient,
      row.option_group_id ? fresh(row.option_group_id) : null, row.description]);
  }
  await store.query(`
    INSERT INTO unoa.unit_volume(unit_id, version_id, activity, hours)
    SELECT (mapping.value)::uuid, $2, volume.activity, volume.hours FROM unoa.unit_volume AS volume
    JOIN jsonb_each_text($3::jsonb) AS mapping ON mapping.key = volume.unit_id::text WHERE volume.version_id = $1
  `, [from, to, JSON.stringify(Object.fromEntries(map))]);
  await store.query(`
    INSERT INTO unoa.unit_course(unit_id, version_id, course_id, coefficient, credits)
    SELECT (mapping.value)::uuid, $2, link.course_id, link.coefficient, link.credits FROM unoa.unit_course AS link
    JOIN jsonb_each_text($3::jsonb) AS mapping ON mapping.key = link.unit_id::text WHERE link.version_id = $1
  `, [from, to, JSON.stringify(Object.fromEntries(map))]);
  await store.query(`
    INSERT INTO unoa.unit_prerequisite(unit_id, required_unit_id, version_id)
    SELECT (own.value)::uuid, (required.value)::uuid, $2 FROM unoa.unit_prerequisite AS link
    JOIN jsonb_each_text($3::jsonb) AS own ON own.key = link.unit_id::text
    JOIN jsonb_each_text($3::jsonb) AS required ON required.key = link.required_unit_id::text
    WHERE link.version_id = $1
  `, [from, to, JSON.stringify(Object.fromEntries(map))]);
  await store.query(`
    INSERT INTO unoa.version_competency(version_id, competency_id)
    SELECT $2, competency_id FROM unoa.version_competency WHERE version_id = $1
  `, [from, to]);
  await store.query(`
    INSERT INTO unoa.unit_competency(unit_id, version_id, competency_id, level)
    SELECT (mapping.value)::uuid, $2, link.competency_id, link.level FROM unoa.unit_competency AS link
    JOIN jsonb_each_text($3::jsonb) AS mapping ON mapping.key = link.unit_id::text WHERE link.version_id = $1
  `, [from, to, JSON.stringify(Object.fromEntries(map))]);
  await store.query(`
    INSERT INTO unoa.version_requirement(version_id, kind, label, period_id, credits, mandatory, conditions)
    SELECT $2, kind, label, (SELECT (value)::uuid FROM jsonb_each_text($3::jsonb) WHERE key = period_id::text),
           credits, mandatory, conditions FROM unoa.version_requirement WHERE version_id = $1
  `, [from, to, JSON.stringify(Object.fromEntries(map))]);
  await store.query(`
    INSERT INTO unoa.version_territory(version_id, territory_id) SELECT $2, territory_id FROM unoa.version_territory WHERE version_id = $1
  `, [from, to]);
}

export async function simulateVersion(settings: IamSettings, actor: string, id: string, input: Input) {
  const versionId = uuid(id);
  const store = database(settings);
  const { rows } = await store.query<VersionRow>('SELECT * FROM unoa.program_version WHERE id = $1', [versionId]);
  ensure(rows[0], 404, 'Version introuvable');
  ensure(await program(store, actor, rows[0].program_id), 403, 'Programme inaccessible');
  const chosen = typeof input.choices === 'string' ? [input.choices] : input.choices ?? [];
  ensure(Array.isArray(chosen) && chosen.length <= 200, 400, 'Choix invalides');
  return simulatePlan(await curriculum(store, versionId, rows[0].expected_credits), chosen.map(uuid));
}

