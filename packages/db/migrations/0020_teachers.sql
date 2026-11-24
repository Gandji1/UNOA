-- Teachers and academic staffing (module TEA): profile, calls for applications,
-- spontaneous applications with a course proposal, documents checked by a
-- controller, independent scientific and pedagogical reviews, interview,
-- collegial decision, contract signed by both parties, assignments to course
-- offerings by function, obligations, remuneration, renewal, suspension, and
-- revocation of access at the end of the mission.

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('tea.read', 'TEA', 'Consulter le recrutement et les missions des enseignants', false),
    ('tea.manage', 'TEA', 'Publier les appels, contractualiser et affecter les enseignants', true),
    ('tea.verify', 'TEA', 'Contrôler les pièces et qualifications', true),
    ('tea.review', 'TEA', 'Expertiser une candidature enseignante', false),
    ('tea.decide', 'TEA', 'Décider des recrutements et signer les contrats', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;

INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES
    ('institution_admin', 'tea.read'), ('institution_admin', 'tea.manage'), ('institution_admin', 'tea.verify'), ('institution_admin', 'tea.review'), ('institution_admin', 'tea.decide'),
    ('country_admin', 'tea.read'), ('country_admin', 'tea.manage'), ('country_admin', 'tea.verify'), ('country_admin', 'tea.review'), ('country_admin', 'tea.decide'),
    ('dean', 'tea.read'), ('dean', 'tea.manage'), ('dean', 'tea.review'), ('dean', 'tea.decide'),
    ('department_head', 'tea.read'), ('department_head', 'tea.manage'), ('department_head', 'tea.review'),
    ('pedagogical_reviewer', 'tea.read'), ('pedagogical_reviewer', 'tea.review'), ('auditor', 'tea.read')
) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.access_role WHERE code = item.role)
ON CONFLICT DO NOTHING;

INSERT INTO unoa.access_role(code, label, description, level, ordinal) VALUES
    ('hr_officer', 'Gestionnaire RH enseignants', 'Publie les appels, contrôle les pièces, prépare contrats, affectations et rémunérations.', 'institution', 125)
ON CONFLICT (code) DO NOTHING;
INSERT INTO unoa.role_permission VALUES ('hr_officer', 'tea.read'), ('hr_officer', 'tea.manage'), ('hr_officer', 'tea.verify') ON CONFLICT DO NOTHING;

INSERT INTO unoa.notification_event(code, module, variables, sensitive) VALUES
    ('tea.application_decided', 'TEA', '{title}', true),
    ('tea.contract_ready', 'TEA', '{scope,function}', false),
    ('tea.assigned', 'TEA', '{course,function}', false)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE unoa.teacher_profile (
    account_id uuid PRIMARY KEY REFERENCES unoa.account(id),
    title text CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 120),
    discipline text NOT NULL CHECK (length(btrim(discipline)) BETWEEN 1 AND 200),
    biography text CHECK (biography IS NULL OR length(biography) <= 4000),
    publications text CHECK (publications IS NULL OR length(publications) <= 8000),
    availability text CHECK (availability IS NULL OR length(availability) <= 1000),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unoa.job_opening (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    discipline text NOT NULL CHECK (length(btrim(discipline)) BETWEEN 1 AND 200),
    level text NOT NULL CHECK (length(btrim(level)) BETWEEN 1 AND 120),
    region text CHECK (region IS NULL OR length(btrim(region)) BETWEEN 1 AND 120),
    description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 6000),
    closes_at timestamptz NOT NULL,
    state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unoa.teacher_application (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    opening_id uuid REFERENCES unoa.job_opening(id),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    applicant_id uuid NOT NULL REFERENCES unoa.account(id),
    course_title text NOT NULL CHECK (length(btrim(course_title)) BETWEEN 1 AND 200),
    syllabus text CHECK (syllabus IS NULL OR length(syllabus) <= 12000),
    pedagogy text CHECK (pedagogy IS NULL OR length(pedagogy) <= 6000),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted', 'review', 'decided', 'withdrawn')),
    decision text CHECK (decision IS NULL OR decision IN ('accepted', 'rejected')),
    decision_reason text CHECK (decision_reason IS NULL OR length(btrim(decision_reason)) BETWEEN 1 AND 2000),
    decided_by uuid REFERENCES unoa.account(id),
    submitted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'decided') = (decision IS NOT NULL)),
    CHECK (decided_by IS NULL OR decided_by <> applicant_id),
    CHECK (state IN ('draft', 'withdrawn') OR (syllabus IS NOT NULL AND pedagogy IS NOT NULL))
);
CREATE UNIQUE INDEX teacher_application_once ON unoa.teacher_application(opening_id, applicant_id) WHERE opening_id IS NOT NULL AND state <> 'withdrawn';

CREATE TABLE unoa.teacher_document (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES unoa.teacher_application(id),
    kind text NOT NULL CHECK (kind IN ('diploma', 'cv', 'reference', 'publication')),
    filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
    format text NOT NULL CHECK (format IN ('pdf', 'png', 'jpg')),
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    content bytea NOT NULL,
    state text NOT NULL DEFAULT 'deposited' CHECK (state IN ('deposited', 'verified', 'rejected', 'falsified')),
    note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
    checked_by uuid REFERENCES unoa.account(id),
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    CHECK (state = 'deposited' OR checked_by IS NOT NULL),
    CHECK (state IN ('deposited', 'verified') OR note IS NOT NULL)
);
CREATE TRIGGER teacher_document_kept BEFORE DELETE OR TRUNCATE ON unoa.teacher_document FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.teacher_review (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES unoa.teacher_application(id),
    kind text NOT NULL CHECK (kind IN ('scientific', 'pedagogical', 'interview')),
    reviewer_id uuid NOT NULL REFERENCES unoa.account(id),
    recommendation text NOT NULL CHECK (recommendation IN ('favourable', 'reserved', 'unfavourable')),
    note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 4000),
    scheduled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (application_id, kind, reviewer_id)
);
CREATE TRIGGER teacher_review_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.teacher_review FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Independence: a candidate never reviews their own application, and the
-- scientific and pedagogical reviews come from two different people.
CREATE FUNCTION unoa.validate_teacher_review() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM unoa.teacher_application WHERE id = NEW.application_id AND applicant_id = NEW.reviewer_id) THEN
        RAISE EXCEPTION 'A candidate does not review their own application' USING ERRCODE = 'U0403';
    END IF;
    IF NEW.kind IN ('scientific', 'pedagogical') AND EXISTS (SELECT 1 FROM unoa.teacher_review WHERE application_id = NEW.application_id
        AND kind IN ('scientific', 'pedagogical') AND kind <> NEW.kind AND reviewer_id = NEW.reviewer_id) THEN
        RAISE EXCEPTION 'Scientific and pedagogical reviews are independent' USING ERRCODE = 'U0403';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_teacher_review BEFORE INSERT ON unoa.teacher_review FOR EACH ROW EXECUTE FUNCTION unoa.validate_teacher_review();

CREATE TABLE unoa.teacher_contract (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    application_id uuid REFERENCES unoa.teacher_application(id),
    function text NOT NULL CHECK (function IN ('teacher', 'author', 'tutor', 'grader', 'jury', 'supervisor')),
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    hours numeric(7, 2) NOT NULL CHECK (hours > 0),
    hourly_rate numeric(12, 2) NOT NULL CHECK (hourly_rate >= 0),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    terms text CHECK (terms IS NULL OR length(terms) <= 6000),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'signed', 'suspended', 'ended')),
    teacher_signed_at timestamptz,
    institution_signed_by uuid REFERENCES unoa.account(id),
    institution_signed_at timestamptz,
    renewed_from uuid REFERENCES unoa.teacher_contract(id),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    end_reason text CHECK (end_reason IS NULL OR length(btrim(end_reason)) BETWEEN 1 AND 1000),
    CHECK (ends_on > starts_on),
    CHECK (institution_signed_by IS NULL OR institution_signed_by <> account_id),
    CHECK (state <> 'signed' OR (teacher_signed_at IS NOT NULL AND institution_signed_at IS NOT NULL))
);
CREATE INDEX teacher_contract_account ON unoa.teacher_contract(account_id);
CREATE TRIGGER teacher_contract_kept BEFORE DELETE OR TRUNCATE ON unoa.teacher_contract FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.teaching_assignment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES unoa.teacher_contract(id),
    offering_id uuid NOT NULL REFERENCES unoa.course_offering(id),
    function text NOT NULL CHECK (function IN ('teacher', 'author', 'tutor', 'grader', 'jury', 'supervisor')),
    hours numeric(7, 2) NOT NULL CHECK (hours > 0),
    grading_days integer CHECK (grading_days IS NULL OR grading_days BETWEEN 1 AND 90),
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'ended')),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    UNIQUE (contract_id, offering_id, function)
);

CREATE TABLE unoa.teaching_obligation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id uuid NOT NULL REFERENCES unoa.teaching_assignment(id),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
    due_on date NOT NULL,
    done_at timestamptz,
    created_by uuid NOT NULL REFERENCES unoa.account(id)
);

-- End of mission (TEA-015, IAM-015): every contract past its end date is ended,
-- its assignments closed and the matching course memberships removed.
CREATE FUNCTION unoa.expire_teacher_contracts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    total integer;
BEGIN
    WITH ended AS (
        UPDATE unoa.teacher_contract SET state = 'ended', ended_at = now(), end_reason = coalesce(end_reason, 'Fin de mission')
        WHERE state IN ('signed', 'suspended') AND ends_on < current_date RETURNING id, account_id
    ), closed AS (
        UPDATE unoa.teaching_assignment AS assignment SET state = 'ended', ended_at = now() FROM ended
        WHERE assignment.contract_id = ended.id AND assignment.state = 'active' RETURNING assignment.offering_id, ended.account_id
    )
    UPDATE unoa.offering_member AS member SET removed_at = now(), removed_by = member.added_by FROM closed
    WHERE member.offering_id = closed.offering_id AND member.account_id = closed.account_id AND member.removed_at IS NULL AND member.role <> 'learner';
    GET DIAGNOSTICS total = ROW_COUNT;
    RETURN total;
END;
$$;
REVOKE EXECUTE ON FUNCTION unoa.expire_teacher_contracts() FROM PUBLIC;
