-- Skills, portfolio and career profile (module CAR) and opportunities with
-- applications (module JOB), lot 028. Profiles are shared with a company only
-- after explicit, revocable consent, and every recruiter reading is logged.
-- Skill levels are computed from evidence: declared < taught < assessed <
-- validated < certified; a declared skill never passes for a diploma.

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('car.verify', 'CAR', 'Vérifier les expériences et pièces d’un portfolio', false)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;
INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES ('internship_officer', 'car.verify'), ('registrar', 'car.verify'), ('institution_admin', 'car.verify')) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.access_role WHERE code = item.role)
ON CONFLICT DO NOTHING;

INSERT INTO unoa.notification_event(code, module, variables, sensitive) VALUES
    ('job.alert', 'JOB', '{title,company}', false),
    ('job.status', 'JOB', '{title,status}', false),
    ('job.interview', 'JOB', '{title,date}', false),
    ('job.application', 'JOB', '{title}', false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------- skills (CAR)

CREATE TABLE unoa.competency_label (
    competency_id uuid NOT NULL REFERENCES unoa.competency(id),
    language text NOT NULL CHECK (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
    updated_by uuid NOT NULL REFERENCES unoa.account(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (competency_id, language)
);

CREATE TABLE unoa.course_competency (
    course_id uuid NOT NULL REFERENCES unoa.course(id),
    competency_id uuid NOT NULL REFERENCES unoa.competency(id),
    linked_by uuid NOT NULL REFERENCES unoa.account(id),
    linked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (course_id, competency_id)
);

CREATE TABLE unoa.assessment_competency (
    assessment_id uuid NOT NULL REFERENCES unoa.assessment(id),
    competency_id uuid NOT NULL REFERENCES unoa.competency(id),
    linked_by uuid NOT NULL REFERENCES unoa.account(id),
    linked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (assessment_id, competency_id)
);

CREATE TABLE unoa.career_profile (
    account_id uuid PRIMARY KEY REFERENCES unoa.account(id),
    headline text CHECK (headline IS NULL OR length(btrim(headline)) BETWEEN 2 AND 200),
    summary text CHECK (summary IS NULL OR length(summary) <= 4000),
    country text CHECK (country IS NULL OR length(btrim(country)) BETWEEN 2 AND 100),
    languages text[] NOT NULL DEFAULT '{}' CHECK (cardinality(languages) <= 12),
    availability text CHECK (availability IS NULL OR length(availability) <= 300),
    open_to_offers boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unoa.declared_skill (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    competency_id uuid REFERENCES unoa.competency(id),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 200),
    level text NOT NULL CHECK (level IN ('beginner', 'intermediate', 'advanced', 'expert')),
    created_at timestamptz NOT NULL DEFAULT now(),
    removed_at timestamptz
);

CREATE TABLE unoa.portfolio_item (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    kind text NOT NULL CHECK (kind IN ('project', 'experience', 'education', 'certificate', 'volunteering')),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 300),
    organisation text CHECK (organisation IS NULL OR length(btrim(organisation)) BETWEEN 1 AND 300),
    description text CHECK (description IS NULL OR length(description) <= 4000),
    starts_on date,
    ends_on date,
    url text CHECK (url IS NULL OR url ~ '^https://'),
    shared boolean NOT NULL DEFAULT false,
    verified_by uuid REFERENCES unoa.account(id),
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    removed_at timestamptz,
    CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
    CHECK ((verified_by IS NULL) = (verified_at IS NULL)),
    CHECK (verified_by IS NULL OR verified_by <> account_id)
);

CREATE TABLE unoa.cv_version (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    version integer NOT NULL CHECK (version >= 1),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
    content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
    pdf bytea NOT NULL,
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (account_id, version)
);
CREATE TRIGGER cv_version_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.cv_version FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.career_consent (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    company_id uuid NOT NULL REFERENCES unoa.company(id),
    statement text NOT NULL CHECK (length(btrim(statement)) BETWEEN 10 AND 1000),
    granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    revoked_at timestamptz
);
CREATE UNIQUE INDEX career_consent_active ON unoa.career_consent(account_id, company_id) WHERE revoked_at IS NULL;

CREATE TABLE unoa.recruiter_access (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    company_id uuid NOT NULL REFERENCES unoa.company(id),
    recruiter_id uuid NOT NULL REFERENCES unoa.account(id),
    resource text NOT NULL CHECK (resource IN ('profile', 'application', 'document', 'cv')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER recruiter_access_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.recruiter_access FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- ---------------------------------------------------------- opportunities (JOB)

CREATE TABLE unoa.opportunity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES unoa.company(id),
    kind text NOT NULL CHECK (kind IN ('internship', 'job', 'apprenticeship', 'mission', 'project')),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 300),
    description text NOT NULL CHECK (length(btrim(description)) BETWEEN 20 AND 10000),
    criteria text CHECK (criteria IS NULL OR length(criteria) <= 4000),
    country text NOT NULL CHECK (length(btrim(country)) BETWEEN 2 AND 100),
    city text CHECK (city IS NULL OR length(btrim(city)) BETWEEN 1 AND 200),
    remote boolean NOT NULL DEFAULT false,
    languages text[] NOT NULL DEFAULT '{}' CHECK (cardinality(languages) <= 12),
    competencies uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(competencies) <= 30),
    required_documents text[] NOT NULL DEFAULT '{cv}' CHECK (required_documents <@ ARRAY['cv', 'letter', 'transcript', 'other']),
    starts_on date,
    opens_at timestamptz NOT NULL,
    closes_at timestamptz NOT NULL CHECK (closes_at > opens_at),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'review', 'published', 'suspended', 'closed')),
    risk_flags text[] NOT NULL DEFAULT '{}',
    moderated_by uuid REFERENCES unoa.account(id),
    moderation_note text CHECK (moderation_note IS NULL OR length(moderation_note) <= 2000),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (moderated_by IS NULL OR moderated_by <> created_by)
);
CREATE INDEX opportunity_state ON unoa.opportunity(state, closes_at);

CREATE TABLE unoa.opportunity_report (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id uuid NOT NULL REFERENCES unoa.opportunity(id),
    reporter_id uuid NOT NULL REFERENCES unoa.account(id),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 2000),
    state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
    outcome text CHECK (outcome IS NULL OR length(outcome) <= 2000),
    handled_by uuid REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'closed') = (outcome IS NOT NULL AND handled_by IS NOT NULL))
);

CREATE TABLE unoa.job_favorite (
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    opportunity_id uuid NOT NULL REFERENCES unoa.opportunity(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, opportunity_id)
);

CREATE TABLE unoa.job_alert (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 200),
    kind text CHECK (kind IS NULL OR kind IN ('internship', 'job', 'apprenticeship', 'mission', 'project')),
    country text CHECK (country IS NULL OR length(btrim(country)) BETWEEN 2 AND 100),
    language text CHECK (language IS NULL OR language ~ '^[a-z]{2,3}$'),
    keywords text CHECK (keywords IS NULL OR length(keywords) <= 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    removed_at timestamptz
);

CREATE TABLE unoa.job_application (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id uuid NOT NULL REFERENCES unoa.opportunity(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    state text NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted', 'shortlisted', 'interview', 'offer', 'rejected', 'withdrawn')),
    consent_statement text NOT NULL CHECK (length(btrim(consent_statement)) BETWEEN 10 AND 1000),
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
    cv_version_id uuid REFERENCES unoa.cv_version(id),
    letter text CHECK (letter IS NULL OR length(letter) <= 8000),
    submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    withdrawn_at timestamptz,
    CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL))
);
CREATE UNIQUE INDEX job_application_once ON unoa.job_application(opportunity_id, account_id);

CREATE TABLE unoa.job_application_document (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES unoa.job_application(id),
    kind text NOT NULL CHECK (kind IN ('cv', 'letter', 'transcript', 'other')),
    filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    content bytea,
    created_at timestamptz NOT NULL DEFAULT now(),
    purged_at timestamptz,
    CHECK ((content IS NULL) = (purged_at IS NOT NULL))
);

CREATE TABLE unoa.job_application_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES unoa.job_application(id),
    state text NOT NULL CHECK (state IN ('submitted', 'shortlisted', 'interview', 'offer', 'rejected', 'withdrawn')),
    note text CHECK (note IS NULL OR length(note) <= 2000),
    actor_id uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER job_application_event_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.job_application_event FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.interview (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES unoa.job_application(id),
    starts_at timestamptz NOT NULL,
    duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 10 AND 480),
    mode text NOT NULL CHECK (mode IN ('onsite', 'online', 'phone')),
    place text CHECK (place IS NULL OR length(place) <= 500),
    state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'confirmed', 'cancelled')),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    cancel_reason text CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 1000)
);

-- Evidence-based level of every skill of an account (CAR-003).
CREATE FUNCTION unoa.career_skills(target uuid)
RETURNS TABLE (competency_id uuid, code text, label text, level text, evidence text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, unoa, pg_temp
AS $$
    WITH evidence AS (
        -- certified: a diploma issued for the programme carrying the competency (attestations and badges do not certify)
        SELECT link.competency_id, 5 AS rank, 'Document délivré : ' || type.label AS evidence
        FROM unoa.credential JOIN unoa.credential_type AS type ON type.id = credential.type_id
        JOIN unoa.student ON student.id = credential.student_id JOIN unoa.registration ON registration.student_id = student.id
        JOIN unoa.cohort ON cohort.id = registration.cohort_id JOIN unoa.program_version AS version ON version.id = cohort.version_id AND version.program_id = type.program_id
        JOIN unoa.version_competency AS link ON link.version_id = cohort.version_id
        WHERE credential.holder_id = target AND credential.state = 'issued' AND type.category = 'institutional_diploma'
        UNION ALL
        -- validated: credits of a unit carrying the competency awarded by the jury
        SELECT link.competency_id, 4, 'Crédits accordés : ' || unit.code || ' — ' || unit.title
        FROM unoa.credit_award AS award JOIN unoa.student ON student.id = award.student_id
        JOIN unoa.unit_competency AS link ON link.unit_id = award.unit_id JOIN unoa.teaching_unit AS unit ON unit.id = award.unit_id
        WHERE student.account_id = target AND award.revoked_at IS NULL
        UNION ALL
        -- assessed: a graded copy of an assessment linked to the competency
        SELECT link.competency_id, 3, 'Évaluation corrigée : ' || assessment.title
        FROM unoa.attempt JOIN unoa.grading ON grading.attempt_id = attempt.id JOIN unoa.assessment ON assessment.id = attempt.assessment_id
        JOIN unoa.assessment_competency AS link ON link.assessment_id = assessment.id
        WHERE attempt.account_id = target
        UNION ALL
        -- taught: a registered unit or a followed course linked to the competency
        SELECT link.competency_id, 2, 'Unité suivie : ' || unit.code || ' — ' || unit.title
        FROM unoa.course_registration AS course JOIN unoa.registration ON registration.id = course.registration_id
        JOIN unoa.student ON student.id = registration.student_id JOIN unoa.unit_competency AS link ON link.unit_id = course.unit_id
        JOIN unoa.teaching_unit AS unit ON unit.id = course.unit_id
        WHERE student.account_id = target AND course.state <> 'withdrawn'
        UNION ALL
        SELECT link.competency_id, 2, 'Cours suivi : ' || course.title
        FROM unoa.offering_member AS member JOIN unoa.course_offering AS offering ON offering.id = member.offering_id
        JOIN unoa.course_version AS version ON version.id = offering.course_version_id JOIN unoa.course ON course.id = version.course_id
        JOIN unoa.course_competency AS link ON link.course_id = course.id
        WHERE member.account_id = target AND member.role = 'learner' AND member.removed_at IS NULL
        UNION ALL
        -- declared by the person
        SELECT declared.competency_id, 1, 'Déclarée par la personne' FROM unoa.declared_skill AS declared
        WHERE declared.account_id = target AND declared.removed_at IS NULL AND declared.competency_id IS NOT NULL
    ), best AS (
        SELECT DISTINCT ON (evidence.competency_id) evidence.competency_id, evidence.rank, evidence.evidence
        FROM evidence ORDER BY evidence.competency_id, evidence.rank DESC, evidence.evidence
    )
    SELECT best.competency_id, competency.code, competency.label,
        (ARRAY['declared', 'taught', 'assessed', 'validated', 'certified'])[best.rank], best.evidence
    FROM best JOIN unoa.competency ON competency.id = best.competency_id
    ORDER BY best.rank DESC, competency.label;
$$;
REVOKE EXECUTE ON FUNCTION unoa.career_skills(uuid) FROM PUBLIC;

-- Personal spaces now include careers (any account may build a profile).
CREATE OR REPLACE FUNCTION unoa.account_spaces(actor uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT array_remove(ARRAY[
        CASE WHEN EXISTS (SELECT 1 FROM unoa.offering_member WHERE account_id = actor AND role = 'learner' AND removed_at IS NULL) THEN 'learning' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.offering_member WHERE account_id = actor AND role IN ('teacher', 'tutor') AND removed_at IS NULL)
               OR EXISTS (SELECT 1 FROM unoa.teacher_profile WHERE account_id = actor)
               OR EXISTS (SELECT 1 FROM unoa.teacher_application WHERE applicant_id = actor) THEN 'teaching' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.application WHERE applicant_id = actor) THEN 'admission' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.student WHERE account_id = actor) THEN 'student' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.invoice WHERE account_id = actor) THEN 'finance' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.credential WHERE holder_id = actor) THEN 'documents' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.short_enrollment WHERE account_id = actor) THEN 'short' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.external_participation WHERE account_id = actor) THEN 'external' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.council_member WHERE account_id = actor) THEN 'councils' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.thesis_project WHERE author_id = actor)
               OR EXISTS (SELECT 1 FROM unoa.supervision WHERE account_id = actor AND ended_at IS NULL)
               OR EXISTS (SELECT 1 FROM unoa.defense_member WHERE account_id = actor) THEN 'thesis' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.doctoral_application WHERE account_id = actor) THEN 'doctorate' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.internship WHERE student_id = actor)
               OR EXISTS (SELECT 1 FROM unoa.internship_supervisor WHERE account_id = actor AND ended_at IS NULL) THEN 'internship' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.company_member WHERE account_id = actor AND removed_at IS NULL)
               OR EXISTS (SELECT 1 FROM unoa.company WHERE created_by = actor AND state <> 'closed') THEN 'company' END,
        CASE WHEN EXISTS (SELECT 1 FROM unoa.career_profile WHERE account_id = actor)
               OR EXISTS (SELECT 1 FROM unoa.job_application WHERE account_id = actor) THEN 'career' END
    ], NULL);
$$;
