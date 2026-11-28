-- Theses and defences (module MEM, shared with PHD): topics, projects with a
-- validated protocol, supervision by qualified people, milestones, successive
-- drafts with supervisors' comments, proportionate integrity checks, rules by
-- scope and level, jury and notices according to the rules, physical or
-- online defence, signed minutes, corrected final deposit with embargo, and the
-- defence mark sent to the grades module for the unit's credits.

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('thesis.read', 'MEM', 'Consulter les mémoires et soutenances', false),
    ('thesis.manage', 'MEM', 'Gérer sujets, règles, encadrements et jurys', false),
    ('thesis.validate', 'MEM', 'Valider sujets et protocoles', false),
    ('thesis.supervise', 'MEM', 'Encadrer des mémoires (qualification)', false),
    ('thesis.integrity', 'MEM', 'Contrôler l’intégrité des travaux', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;

INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES
    ('institution_admin', 'thesis.read'), ('institution_admin', 'thesis.manage'), ('institution_admin', 'thesis.validate'),
    ('dean', 'thesis.read'), ('dean', 'thesis.validate'), ('department_head', 'thesis.read'), ('department_head', 'thesis.manage'), ('department_head', 'thesis.validate'),
    ('teacher', 'thesis.read'), ('teacher', 'thesis.supervise'), ('academic_manager', 'thesis.read'), ('academic_manager', 'thesis.manage'), ('auditor', 'thesis.read')
) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.access_role WHERE code = item.role)
ON CONFLICT DO NOTHING;

INSERT INTO unoa.notification_event(code, module, variables, sensitive) VALUES
    ('thesis.validated', 'MEM', '{title,decision}', false),
    ('thesis.comment', 'MEM', '{title}', false),
    ('thesis.convocation', 'MEM', '{title,date,mode}', false),
    ('thesis.outcome', 'MEM', '{title}', true)
ON CONFLICT (code) DO NOTHING;

-- Regulation by scope and level (no value in code): jury size, rapporteurs, external member, embargo.
CREATE TABLE unoa.thesis_rule (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    level text NOT NULL CHECK (level IN ('licence', 'master', 'doctorat')),
    min_jury integer NOT NULL CHECK (min_jury BETWEEN 1 AND 12),
    rapporteurs integer NOT NULL CHECK (rapporteurs BETWEEN 0 AND 4),
    external_member boolean NOT NULL,
    similarity_threshold integer NOT NULL CHECK (similarity_threshold BETWEEN 1 AND 100),
    max_embargo_years integer NOT NULL CHECK (max_embargo_years BETWEEN 0 AND 10),
    notice_days integer NOT NULL CHECK (notice_days BETWEEN 0 AND 120),
    max_years integer CHECK (max_years IS NULL OR max_years BETWEEN 1 AND 12),
    training_hours integer CHECK (training_hours IS NULL OR training_hours BETWEEN 0 AND 1000),
    ethics_required boolean NOT NULL DEFAULT false,
    effective_from date NOT NULL,
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (scope_id, level, effective_from)
);
CREATE TRIGGER thesis_rule_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.thesis_rule FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE FUNCTION unoa.thesis_rule_for(target uuid, wanted text, at date) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, unoa, pg_temp
AS $$
    WITH RECURSIVE up AS (SELECT id, parent_id, 0 AS depth FROM unoa.scope WHERE id = target
        UNION ALL SELECT scope.id, scope.parent_id, up.depth + 1 FROM unoa.scope JOIN up ON scope.id = up.parent_id)
    SELECT rule.id FROM unoa.thesis_rule AS rule JOIN up ON up.id = rule.scope_id
    WHERE rule.level = wanted AND rule.effective_from <= at ORDER BY up.depth, rule.effective_from DESC LIMIT 1;
$$;

CREATE TABLE unoa.thesis_topic (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    level text NOT NULL CHECK (level IN ('licence', 'master', 'doctorat')),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
    summary text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 6000),
    proposed_by uuid NOT NULL REFERENCES unoa.account(id),
    state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'open', 'taken', 'closed')),
    validated_by uuid REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (validated_by IS NULL OR validated_by <> proposed_by),
    CHECK (state = 'proposed' OR validated_by IS NOT NULL)
);

CREATE TABLE unoa.thesis_project (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    level text NOT NULL CHECK (level IN ('licence', 'master', 'doctorat')),
    topic_id uuid REFERENCES unoa.thesis_topic(id),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    registration_id uuid REFERENCES unoa.registration(id),
    unit_id uuid REFERENCES unoa.teaching_unit(id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
    abstract text CHECK (abstract IS NULL OR length(btrim(abstract)) BETWEEN 1 AND 6000),
    protocol text CHECK (protocol IS NULL OR length(btrim(protocol)) BETWEEN 1 AND 20000),
    confidential boolean NOT NULL DEFAULT false,
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted', 'validated', 'rejected', 'defended', 'archived')),
    validated_by uuid REFERENCES unoa.account(id),
    validation_note text CHECK (validation_note IS NULL OR length(btrim(validation_note)) BETWEEN 1 AND 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (validated_by IS NULL OR validated_by <> author_id),
    CHECK ((unit_id IS NULL) OR (registration_id IS NOT NULL))
);
CREATE INDEX thesis_project_author ON unoa.thesis_project(author_id);

CREATE TABLE unoa.supervision (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES unoa.thesis_project(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    role text NOT NULL CHECK (role IN ('director', 'co_director')),
    qualification text NOT NULL CHECK (length(btrim(qualification)) BETWEEN 1 AND 300),
    assigned_by uuid NOT NULL REFERENCES unoa.account(id),
    assigned_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    end_reason text CHECK (end_reason IS NULL OR length(btrim(end_reason)) BETWEEN 1 AND 500),
    CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
CREATE UNIQUE INDEX supervision_one_director ON unoa.supervision(project_id) WHERE role = 'director' AND ended_at IS NULL;
CREATE UNIQUE INDEX supervision_once ON unoa.supervision(project_id, account_id) WHERE ended_at IS NULL;
CREATE FUNCTION unoa.check_supervision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM unoa.thesis_project WHERE id = NEW.project_id AND author_id = NEW.account_id) THEN
        RAISE EXCEPTION 'An author does not supervise their own work' USING ERRCODE = 'U0403';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER check_supervision BEFORE INSERT ON unoa.supervision FOR EACH ROW EXECUTE FUNCTION unoa.check_supervision();

CREATE TABLE unoa.thesis_milestone (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES unoa.thesis_project(id),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
    due_on date NOT NULL,
    done_at timestamptz,
    created_by uuid NOT NULL REFERENCES unoa.account(id)
);

CREATE TABLE unoa.thesis_draft (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES unoa.thesis_project(id),
    version integer NOT NULL CHECK (version > 0),
    kind text NOT NULL CHECK (kind IN ('draft', 'final', 'corrected')),
    filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
    format text NOT NULL CHECK (format IN ('pdf')),
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    content bytea NOT NULL,
    submitted_by uuid NOT NULL REFERENCES unoa.account(id),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, version)
);
CREATE TRIGGER thesis_draft_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.thesis_draft FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.draft_comment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id uuid NOT NULL REFERENCES unoa.thesis_draft(id),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 8000),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER draft_comment_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.draft_comment FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Proportionate integrity check (MEM-006): a similarity report or a human review, never by the author.
CREATE TABLE unoa.integrity_check (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id uuid NOT NULL REFERENCES unoa.thesis_draft(id),
    method text NOT NULL CHECK (method IN ('similarity_report', 'manual_review')),
    similarity integer CHECK (similarity IS NULL OR similarity BETWEEN 0 AND 100),
    result text NOT NULL CHECK (result IN ('clear', 'suspected')),
    note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 4000),
    checked_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (method <> 'similarity_report' OR similarity IS NOT NULL)
);
CREATE TRIGGER integrity_check_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.integrity_check FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
CREATE FUNCTION unoa.check_integrity_reviewer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM unoa.thesis_draft AS draft JOIN unoa.thesis_project AS project ON project.id = draft.project_id
        WHERE draft.id = NEW.draft_id AND project.author_id = NEW.checked_by) THEN
        RAISE EXCEPTION 'An author does not check their own work' USING ERRCODE = 'U0403';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER check_integrity_reviewer BEFORE INSERT ON unoa.integrity_check FOR EACH ROW EXECUTE FUNCTION unoa.check_integrity_reviewer();

CREATE TABLE unoa.defense (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES unoa.thesis_project(id),
    rule_id uuid NOT NULL REFERENCES unoa.thesis_rule(id),
    mode text NOT NULL CHECK (mode IN ('onsite', 'online', 'hybrid')),
    starts_at timestamptz NOT NULL,
    place text CHECK (place IS NULL OR length(btrim(place)) BETWEEN 1 AND 300),
    meeting_url text CHECK (meeting_url IS NULL OR (meeting_url ~ '^https://[^\s]+$' AND length(meeting_url) <= 2000)),
    state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'convened', 'held', 'cancelled')),
    outcome text CHECK (outcome IS NULL OR outcome IN ('admitted', 'admitted_with_corrections', 'adjourned', 'rejected')),
    mark numeric(7, 2) CHECK (mark IS NULL OR mark >= 0),
    minutes text CHECK (minutes IS NULL OR length(btrim(minutes)) BETWEEN 1 AND 20000),
    minutes_sha256 text CHECK (minutes_sha256 IS NULL OR minutes_sha256 ~ '^[0-9a-f]{64}$'),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    held_at timestamptz,
    CHECK (mode = 'online' OR place IS NOT NULL),
    CHECK (mode = 'onsite' OR meeting_url IS NOT NULL),
    CHECK ((state = 'held') = (outcome IS NOT NULL AND minutes_sha256 IS NOT NULL AND held_at IS NOT NULL))
);
CREATE UNIQUE INDEX defense_active ON unoa.defense(project_id) WHERE state IN ('planned', 'convened');
CREATE FUNCTION unoa.validate_defense() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' OR (OLD.state = 'held' AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*)) THEN
        RAISE EXCEPTION 'A held defence and its minutes are kept' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_defense BEFORE UPDATE OR DELETE ON unoa.defense FOR EACH ROW EXECUTE FUNCTION unoa.validate_defense();

CREATE TABLE unoa.defense_member (
    defense_id uuid NOT NULL REFERENCES unoa.defense(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    role text NOT NULL CHECK (role IN ('president', 'rapporteur', 'examiner', 'supervisor')),
    external boolean NOT NULL DEFAULT false,
    present boolean,
    convened_at timestamptz,
    PRIMARY KEY (defense_id, account_id)
);
CREATE UNIQUE INDEX defense_one_president ON unoa.defense_member(defense_id) WHERE role = 'president';
CREATE FUNCTION unoa.check_defense_member() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM unoa.defense JOIN unoa.thesis_project AS project ON project.id = defense.project_id
        WHERE defense.id = NEW.defense_id AND project.author_id = NEW.account_id) THEN
        RAISE EXCEPTION 'An author does not sit on their own jury' USING ERRCODE = 'U0403';
    END IF;
    IF NEW.role = 'president' AND EXISTS (SELECT 1 FROM unoa.defense JOIN unoa.supervision ON supervision.project_id = defense.project_id
        WHERE defense.id = NEW.defense_id AND supervision.account_id = NEW.account_id AND supervision.ended_at IS NULL) THEN
        RAISE EXCEPTION 'A supervisor does not preside the jury' USING ERRCODE = 'U0403';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER check_defense_member BEFORE INSERT ON unoa.defense_member FOR EACH ROW EXECUTE FUNCTION unoa.check_defense_member();

-- Rapporteurs' reports before the defence (authorisation to defend).
CREATE TABLE unoa.defense_report (
    defense_id uuid NOT NULL REFERENCES unoa.defense(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    opinion text NOT NULL CHECK (opinion IN ('favourable', 'unfavourable')),
    report text NOT NULL CHECK (length(btrim(report)) BETWEEN 1 AND 20000),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (defense_id, account_id)
);
CREATE TRIGGER defense_report_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.defense_report FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.defense_signature (
    defense_id uuid NOT NULL REFERENCES unoa.defense(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    signed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (defense_id, account_id)
);
CREATE TRIGGER defense_signature_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.defense_signature FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Final deposit (MEM-010, PHD-012): the corrected version accepted by the director, with an embargo within the rule.
CREATE TABLE unoa.thesis_deposit (
    project_id uuid PRIMARY KEY REFERENCES unoa.thesis_project(id),
    draft_id uuid NOT NULL REFERENCES unoa.thesis_draft(id),
    accepted_by uuid NOT NULL REFERENCES unoa.account(id),
    embargo_until date,
    embargo_reason text CHECK (embargo_reason IS NULL OR length(btrim(embargo_reason)) BETWEEN 1 AND 1000),
    deposited_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((embargo_until IS NULL) = (embargo_reason IS NULL))
);
CREATE TRIGGER thesis_deposit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.thesis_deposit FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Authorisation to defend (used by the doctorate, PHD-010): granted once every condition is met.
CREATE TABLE unoa.defense_authorization (
    project_id uuid PRIMARY KEY REFERENCES unoa.thesis_project(id),
    authorized_by uuid NOT NULL REFERENCES unoa.account(id),
    conditions text NOT NULL CHECK (length(btrim(conditions)) BETWEEN 1 AND 4000),
    authorized_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER defense_authorization_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.defense_authorization FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- People who can be chosen (supervisors, jury, directors) without exposing the
-- grant table to the web role: active, enabled accounts with a grant in or
-- above the given scope (any scope when null), optionally holding a permission.
CREATE FUNCTION unoa.scope_people(target uuid, permission text) RETURNS TABLE (id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT DISTINCT account.id, account.display_name FROM unoa.account
    JOIN unoa.role_grant AS grant_row ON grant_row.account_id = account.id
    WHERE grant_row.revoked_at IS NULL AND account.disabled_at IS NULL
      AND grant_row.effective_from <= statement_timestamp() AND (grant_row.effective_until IS NULL OR grant_row.effective_until > statement_timestamp())
      AND (target IS NULL OR unoa.scope_within(grant_row.scope_id, target) OR unoa.scope_within(target, grant_row.scope_id))
      AND (permission IS NULL OR unoa.has_scope_permission(account.id, permission, grant_row.scope_id));
$$;
REVOKE EXECUTE ON FUNCTION unoa.scope_people(uuid, text) FROM PUBLIC;
