-- Governance and councils (module GOV): councils configured per scope, dated
-- mandates, meetings convened with a versioned agenda, attendance and quorum,
-- declared conflicts of interest, votes, decisions with effect dates, minutes
-- signed by the chair or a delegate, appeals, documents and partial publication.

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('gov.read', 'GOV', 'Consulter les conseils et leurs décisions', false),
    ('gov.manage', 'GOV', 'Créer les conseils et nommer leurs membres', true),
    ('gov.secretary', 'GOV', 'Convoquer, tenir la séance et rédiger le procès-verbal', false),
    ('gov.publish', 'GOV', 'Publier les décisions et statuer sur les recours', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;

INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES
    ('institution_admin', 'gov.read'), ('institution_admin', 'gov.manage'), ('institution_admin', 'gov.secretary'), ('institution_admin', 'gov.publish'),
    ('country_admin', 'gov.read'), ('country_admin', 'gov.manage'), ('country_admin', 'gov.secretary'), ('country_admin', 'gov.publish'),
    ('dean', 'gov.read'), ('dean', 'gov.manage'), ('dean', 'gov.secretary'), ('dean', 'gov.publish'),
    ('department_head', 'gov.read'), ('department_head', 'gov.manage'), ('department_head', 'gov.secretary'),
    ('auditor', 'gov.read')
) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.access_role WHERE code = item.role)
ON CONFLICT DO NOTHING;

INSERT INTO unoa.access_role(code, label, description, level, ordinal) VALUES
    ('council_secretary', 'Secrétaire de conseil', 'Convoque les séances, tient les présences et rédige les procès-verbaux des conseils de son périmètre.', 'institution', 155)
ON CONFLICT (code) DO NOTHING;
INSERT INTO unoa.role_permission VALUES ('council_secretary', 'gov.read'), ('council_secretary', 'gov.secretary') ON CONFLICT DO NOTHING;

INSERT INTO unoa.notification_event(code, module, variables, sensitive) VALUES
    ('gov.convened', 'GOV', '{council,title,start}', false),
    ('gov.agenda_changed', 'GOV', '{council,title,version}', false),
    ('gov.minutes_signed', 'GOV', '{council,title}', false)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE unoa.council (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    kind text NOT NULL CHECK (length(btrim(kind)) BETWEEN 1 AND 120),
    quorum_percent integer NOT NULL CHECK (quorum_percent BETWEEN 1 AND 100),
    majority text NOT NULL CHECK (majority IN ('simple', 'absolute', 'two_thirds')),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);
CREATE INDEX council_scope ON unoa.council(scope_id);

CREATE TABLE unoa.council_member (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    council_id uuid NOT NULL REFERENCES unoa.council(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    office text NOT NULL CHECK (office IN ('chair', 'secretary', 'member', 'guest')),
    voting boolean NOT NULL,
    starts_on date NOT NULL,
    ends_on date,
    appointed_by uuid NOT NULL REFERENCES unoa.account(id),
    appointed_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_on IS NULL OR ends_on > starts_on),
    CHECK (office <> 'guest' OR NOT voting)
);
CREATE INDEX council_member_council ON unoa.council_member(council_id);
CREATE INDEX council_member_account ON unoa.council_member(account_id);

CREATE TABLE unoa.meeting (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    council_id uuid NOT NULL REFERENCES unoa.council(id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    scheduled_at timestamptz NOT NULL,
    place text NOT NULL CHECK (length(btrim(place)) BETWEEN 1 AND 500),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'convened', 'opened', 'closed', 'archived')),
    agenda_version integer NOT NULL DEFAULT 1 CHECK (agenda_version > 0),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    convened_at timestamptz,
    opened_at timestamptz,
    closed_at timestamptz
);
CREATE INDEX meeting_council ON unoa.meeting(council_id, scheduled_at DESC);

CREATE TABLE unoa.agenda_item (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id uuid NOT NULL REFERENCES unoa.meeting(id),
    ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 500),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
    description text CHECK (description IS NULL OR length(description) <= 4000),
    kind text NOT NULL CHECK (kind IN ('information', 'vote')),
    added_in_version integer NOT NULL,
    withdrawn_in_version integer,
    vote_state text NOT NULL DEFAULT 'pending' CHECK (vote_state IN ('pending', 'open', 'closed'))
);
CREATE INDEX agenda_item_meeting ON unoa.agenda_item(meeting_id, ordinal);

CREATE TABLE unoa.meeting_attendance (
    meeting_id uuid NOT NULL REFERENCES unoa.meeting(id),
    member_id uuid NOT NULL REFERENCES unoa.council_member(id),
    present boolean NOT NULL,
    recorded_by uuid NOT NULL REFERENCES unoa.account(id),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (meeting_id, member_id)
);

CREATE TABLE unoa.conflict_declaration (
    item_id uuid NOT NULL REFERENCES unoa.agenda_item(id),
    member_id uuid NOT NULL REFERENCES unoa.council_member(id),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    declared_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (item_id, member_id)
);

CREATE TABLE unoa.council_vote (
    item_id uuid NOT NULL REFERENCES unoa.agenda_item(id),
    member_id uuid NOT NULL REFERENCES unoa.council_member(id),
    choice text NOT NULL CHECK (choice IN ('for', 'against', 'abstain')),
    cast_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (item_id, member_id)
);

CREATE TABLE unoa.council_decision (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id uuid NOT NULL UNIQUE REFERENCES unoa.agenda_item(id),
    outcome text NOT NULL CHECK (outcome IN ('adopted', 'rejected', 'noted')),
    votes_for integer NOT NULL DEFAULT 0, votes_against integer NOT NULL DEFAULT 0, votes_abstain integer NOT NULL DEFAULT 0,
    present integer NOT NULL,
    text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 4000),
    effective_on date,
    recorded_by uuid NOT NULL REFERENCES unoa.account(id),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    public_summary text CHECK (public_summary IS NULL OR length(btrim(public_summary)) BETWEEN 1 AND 2000),
    published_by uuid REFERENCES unoa.account(id),
    published_at timestamptz,
    CHECK ((published_at IS NULL) = (published_by IS NULL)),
    CHECK (published_at IS NULL OR public_summary IS NOT NULL)
);

CREATE TABLE unoa.meeting_minutes (
    meeting_id uuid PRIMARY KEY REFERENCES unoa.meeting(id),
    body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 60000),
    drafted_by uuid NOT NULL REFERENCES unoa.account(id),
    drafted_at timestamptz NOT NULL DEFAULT now(),
    signed_by uuid REFERENCES unoa.account(id),
    signed_at timestamptz,
    sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
    CHECK ((signed_by IS NULL) = (signed_at IS NULL) AND (signed_by IS NULL) = (sha256 IS NULL)),
    CHECK (signed_by IS NULL OR signed_by <> drafted_by)
);

CREATE TABLE unoa.signature_delegation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    council_id uuid NOT NULL REFERENCES unoa.council(id),
    delegate_member uuid NOT NULL REFERENCES unoa.council_member(id),
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    granted_by uuid NOT NULL REFERENCES unoa.account(id),
    granted_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_on >= starts_on AND ends_on <= starts_on + 366)
);

CREATE TABLE unoa.meeting_document (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id uuid NOT NULL REFERENCES unoa.meeting(id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    url text NOT NULL CHECK (url ~ '^https://[^\s]{3,1990}$'),
    added_by uuid NOT NULL REFERENCES unoa.account(id),
    added_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unoa.decision_appeal (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id uuid NOT NULL REFERENCES unoa.council_decision(id),
    filed_by uuid NOT NULL REFERENCES unoa.account(id),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 4000),
    filed_at timestamptz NOT NULL DEFAULT now(),
    state text NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted', 'upheld', 'granted')),
    ruled_by uuid REFERENCES unoa.account(id),
    ruled_at timestamptz,
    ruling text CHECK (ruling IS NULL OR length(btrim(ruling)) BETWEEN 1 AND 2000),
    CHECK ((state = 'submitted') = (ruled_by IS NULL)),
    CHECK (ruled_by IS NULL OR ruled_by <> filed_by)
);

-- History is kept: votes, decisions and signed minutes are never rewritten.
CREATE TRIGGER council_vote_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.council_vote
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
CREATE TRIGGER conflict_declaration_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.conflict_declaration
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
CREATE TRIGGER council_kept BEFORE DELETE OR TRUNCATE ON unoa.council FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
CREATE TRIGGER meeting_kept BEFORE DELETE OR TRUNCATE ON unoa.meeting FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE FUNCTION unoa.validate_council_decision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' OR ROW(NEW.item_id, NEW.outcome, NEW.votes_for, NEW.votes_against, NEW.votes_abstain, NEW.present, NEW.text,
        NEW.effective_on, NEW.recorded_by, NEW.recorded_at) IS DISTINCT FROM ROW(OLD.item_id, OLD.outcome, OLD.votes_for, OLD.votes_against,
        OLD.votes_abstain, OLD.present, OLD.text, OLD.effective_on, OLD.recorded_by, OLD.recorded_at)
        OR (OLD.published_at IS NOT NULL) THEN
        RAISE EXCEPTION 'A decision is recorded once; only its publication follows' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_council_decision BEFORE UPDATE OR DELETE ON unoa.council_decision
FOR EACH ROW EXECUTE FUNCTION unoa.validate_council_decision();

CREATE FUNCTION unoa.validate_minutes() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' OR OLD.signed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Signed minutes are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_minutes BEFORE UPDATE OR DELETE ON unoa.meeting_minutes
FOR EACH ROW EXECUTE FUNCTION unoa.validate_minutes();

-- A vote: the meeting is opened with quorum, the item's vote is open, the
-- member votes, is in office on the meeting day, present, without conflict.
CREATE FUNCTION unoa.validate_council_vote() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    found_meeting unoa.meeting%ROWTYPE;
BEGIN
    SELECT meeting.* INTO found_meeting FROM unoa.agenda_item AS item JOIN unoa.meeting ON meeting.id = item.meeting_id
    WHERE item.id = NEW.item_id AND item.kind = 'vote' AND item.vote_state = 'open' AND item.withdrawn_in_version IS NULL;
    IF NOT FOUND OR found_meeting.state <> 'opened' THEN
        RAISE EXCEPTION 'The vote is not open' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unoa.council_member AS member JOIN unoa.meeting_attendance AS attendance
        ON attendance.member_id = member.id AND attendance.meeting_id = found_meeting.id AND attendance.present
        WHERE member.id = NEW.member_id AND member.council_id = found_meeting.council_id AND member.voting
          AND member.starts_on <= found_meeting.scheduled_at::date AND (member.ends_on IS NULL OR member.ends_on > found_meeting.scheduled_at::date)) THEN
        RAISE EXCEPTION 'Only a present voting member in office votes' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM unoa.conflict_declaration WHERE item_id = NEW.item_id AND member_id = NEW.member_id) THEN
        RAISE EXCEPTION 'A member with a declared conflict of interest does not vote' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_council_vote BEFORE INSERT ON unoa.council_vote
FOR EACH ROW EXECUTE FUNCTION unoa.validate_council_vote();

-- Published decisions of the councils covered by a public site (GOV-012).
CREATE FUNCTION unoa.public_decisions(target_site uuid)
RETURNS TABLE (council text, meeting_date timestamptz, title text, summary text, outcome text, effective_on date, published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT council.name, meeting.scheduled_at, item.title, decision.public_summary, decision.outcome, decision.effective_on, decision.published_at
    FROM unoa.council_decision AS decision JOIN unoa.agenda_item AS item ON item.id = decision.item_id
    JOIN unoa.meeting ON meeting.id = item.meeting_id JOIN unoa.council ON council.id = meeting.council_id
    WHERE decision.published_at IS NOT NULL AND unoa.scope_within(council.scope_id, unoa.site_scope(target_site))
    ORDER BY decision.published_at DESC LIMIT 100;
$$;
REVOKE EXECUTE ON FUNCTION unoa.public_decisions(uuid) FROM PUBLIC;
