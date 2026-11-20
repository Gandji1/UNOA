-- Learning: pedagogical versions of catalogue courses, offerings for a cohort,
-- learner progress distinct from official grades, moderated forums and live
-- sessions through an external videoconference provider.

CREATE TABLE unoa.course_version (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id uuid NOT NULL REFERENCES unoa.course(id),
    number integer NOT NULL CHECK (number > 0),
    language text NOT NULL CHECK (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
    variant_of uuid REFERENCES unoa.course_version(id),
    variant_note text CHECK (variant_note IS NULL OR length(btrim(variant_note)) BETWEEN 1 AND 500),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'review', 'published', 'retired')),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    objectives text NOT NULL CHECK (length(btrim(objectives)) BETWEEN 1 AND 4000),
    prerequisites text CHECK (prerequisites IS NULL OR length(btrim(prerequisites)) BETWEEN 1 AND 2000),
    methods text CHECK (methods IS NULL OR length(btrim(methods)) BETWEEN 1 AND 2000),
    bibliography text CHECK (bibliography IS NULL OR length(btrim(bibliography)) BETWEEN 1 AND 4000),
    expected_hours numeric(7, 2) CHECK (expected_hours IS NULL OR expected_hours > 0),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    submitted_at timestamptz,
    reviewer_id uuid REFERENCES unoa.account(id),
    discipline_checked boolean NOT NULL DEFAULT false,
    pedagogy_checked boolean NOT NULL DEFAULT false,
    rights_checked boolean NOT NULL DEFAULT false,
    review_note text CHECK (review_note IS NULL OR length(btrim(review_note)) BETWEEN 1 AND 1000),
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    row_version integer NOT NULL DEFAULT 1,
    UNIQUE (course_id, number),
    CHECK (reviewer_id IS NULL OR reviewer_id <> author_id),
    CHECK (state NOT IN ('published', 'retired') OR (discipline_checked AND pedagogy_checked AND rights_checked AND reviewer_id IS NOT NULL))
);

CREATE UNIQUE INDEX course_version_working ON unoa.course_version(course_id, language) WHERE state IN ('draft', 'review');
CREATE UNIQUE INDEX course_version_current ON unoa.course_version(course_id, language) WHERE state = 'published';

CREATE FUNCTION unoa.validate_course_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.state <> 'draft' THEN
            RAISE EXCEPTION 'A course version starts as a draft' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF ROW(NEW.id, NEW.course_id, NEW.number, NEW.language, NEW.variant_of, NEW.author_id, NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.course_id, OLD.number, OLD.language, OLD.variant_of, OLD.author_id, OLD.created_at) THEN
        RAISE EXCEPTION 'The identity of a course version is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.state <> 'draft' AND ROW(NEW.title, NEW.objectives, NEW.prerequisites, NEW.methods, NEW.bibliography,
        NEW.expected_hours, NEW.variant_note)
        IS DISTINCT FROM ROW(OLD.title, OLD.objectives, OLD.prerequisites, OLD.methods, OLD.bibliography,
        OLD.expected_hours, OLD.variant_note) THEN
        RAISE EXCEPTION 'Only a draft version is edited' USING ERRCODE = '23514';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
        (OLD.state = 'draft' AND NEW.state = 'review')
        OR (OLD.state = 'review' AND NEW.state IN ('draft', 'published'))
        OR (OLD.state = 'published' AND NEW.state = 'retired')
    ) THEN
        RAISE EXCEPTION 'Course version transition refused' USING ERRCODE = '23514';
    END IF;
    NEW.row_version := OLD.row_version + 1;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_course_version
BEFORE INSERT OR UPDATE ON unoa.course_version
FOR EACH ROW EXECUTE FUNCTION unoa.validate_course_version();

CREATE TRIGGER course_version_kept
BEFORE DELETE OR TRUNCATE ON unoa.course_version
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE FUNCTION unoa.guard_course_content() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
DECLARE
    target uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN target := OLD.version_id; ELSE target := NEW.version_id; END IF;
    IF TG_OP = 'UPDATE' AND NEW.version_id IS DISTINCT FROM OLD.version_id THEN
        RAISE EXCEPTION 'Content does not move between versions' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unoa.course_version WHERE id = target AND state = 'draft' FOR SHARE) THEN
        RAISE EXCEPTION 'Only a draft version is edited' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE TABLE unoa.course_module (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id uuid NOT NULL REFERENCES unoa.course_version(id),
    ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 1000),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    summary text CHECK (summary IS NULL OR length(btrim(summary)) BETWEEN 1 AND 2000),
    access_mode text NOT NULL DEFAULT 'free' CHECK (access_mode IN ('free', 'sequential')),
    UNIQUE (version_id, ordinal),
    UNIQUE (id, version_id)
);

CREATE TABLE unoa.lesson (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id uuid NOT NULL,
    module_id uuid NOT NULL,
    ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 1000),
    kind text NOT NULL CHECK (kind IN ('page', 'video', 'audio', 'document', 'link', 'activity')),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    body text CHECK (body IS NULL OR length(body) BETWEEN 1 AND 60000),
    media_url text CHECK (media_url IS NULL OR (media_url ~ '^https://[^\s]+$' AND length(media_url) <= 2000)),
    captions_url text CHECK (captions_url IS NULL OR (captions_url ~ '^https://[^\s]+$' AND length(captions_url) <= 2000)),
    captions_language text CHECK (captions_language IS NULL OR captions_language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
    transcript text CHECK (transcript IS NULL OR length(transcript) BETWEEN 1 AND 60000),
    chapters jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(chapters) = 'array' AND jsonb_array_length(chapters) <= 200),
    expected_minutes integer CHECK (expected_minutes IS NULL OR expected_minutes BETWEEN 1 AND 6000),
    requires_lesson_id uuid,
    downloadable boolean NOT NULL DEFAULT false,
    rights text NOT NULL CHECK (length(btrim(rights)) BETWEEN 1 AND 500),
    UNIQUE (module_id, ordinal),
    UNIQUE (id, version_id),
    CHECK (requires_lesson_id IS NULL OR requires_lesson_id <> id),
    CHECK (kind NOT IN ('video', 'audio', 'document', 'link') OR media_url IS NOT NULL),
    CHECK (kind NOT IN ('page', 'activity') OR body IS NOT NULL),
    FOREIGN KEY (module_id, version_id) REFERENCES unoa.course_module(id, version_id),
    FOREIGN KEY (requires_lesson_id, version_id) REFERENCES unoa.lesson(id, version_id)
);

CREATE TRIGGER guard_course_module BEFORE INSERT OR UPDATE OR DELETE ON unoa.course_module
FOR EACH ROW EXECUTE FUNCTION unoa.guard_course_content();
CREATE TRIGGER guard_lesson BEFORE INSERT OR UPDATE OR DELETE ON unoa.lesson
FOR EACH ROW EXECUTE FUNCTION unoa.guard_course_content();
CREATE TRIGGER course_module_kept BEFORE TRUNCATE ON unoa.course_module
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();
CREATE TRIGGER lesson_kept BEFORE TRUNCATE ON unoa.lesson
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- An offering delivers one published version to one cohort, in its own time zone.
CREATE TABLE unoa.course_offering (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_version_id uuid NOT NULL REFERENCES unoa.course_version(id),
    owner_scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
    time_zone text NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_on >= starts_on)
);

CREATE FUNCTION unoa.validate_course_offering() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.time_zone) THEN
        RAISE EXCEPTION 'Unknown IANA time zone' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (SELECT 1 FROM unoa.course_version WHERE id = NEW.course_version_id AND state = 'published') THEN
            RAISE EXCEPTION 'An offering delivers a published version' USING ERRCODE = '23514';
        END IF;
        PERFORM unoa.academic_owner(NEW.owner_scope_id);
    ELSIF ROW(NEW.id, NEW.course_version_id, NEW.owner_scope_id, NEW.created_by, NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.course_version_id, OLD.owner_scope_id, OLD.created_by, OLD.created_at)
        OR (OLD.state = 'closed' AND NEW.state = 'open') THEN
        RAISE EXCEPTION 'An offering keeps its version and stays closed once closed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_course_offering
BEFORE INSERT OR UPDATE ON unoa.course_offering
FOR EACH ROW EXECUTE FUNCTION unoa.validate_course_offering();

CREATE TABLE unoa.offering_member (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    offering_id uuid NOT NULL REFERENCES unoa.course_offering(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    role text NOT NULL CHECK (role IN ('learner', 'teacher', 'tutor')),
    display_name text CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 160),
    added_by uuid NOT NULL REFERENCES unoa.account(id),
    added_at timestamptz NOT NULL DEFAULT now(),
    removed_at timestamptz,
    removed_by uuid REFERENCES unoa.account(id),
    CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);

CREATE UNIQUE INDEX offering_member_active ON unoa.offering_member(offering_id, account_id, role) WHERE removed_at IS NULL;
CREATE INDEX offering_member_account ON unoa.offering_member(account_id) WHERE removed_at IS NULL;

CREATE FUNCTION unoa.offering_role(target uuid, actor uuid) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT CASE WHEN bool_or(role = 'teacher') THEN 'teacher' WHEN bool_or(role = 'tutor') THEN 'tutor'
                WHEN bool_or(role = 'learner') THEN 'learner' END
    FROM unoa.offering_member WHERE offering_id = target AND account_id = actor AND removed_at IS NULL;
$$;

CREATE TABLE unoa.lesson_due (
    offering_id uuid NOT NULL REFERENCES unoa.course_offering(id),
    lesson_id uuid NOT NULL REFERENCES unoa.lesson(id),
    due_at timestamptz NOT NULL,
    set_by uuid NOT NULL REFERENCES unoa.account(id),
    PRIMARY KEY (offering_id, lesson_id)
);

-- Learning progress is informative; it is never an official grade.
CREATE TABLE unoa.lesson_progress (
    offering_id uuid NOT NULL REFERENCES unoa.course_offering(id),
    lesson_id uuid NOT NULL REFERENCES unoa.lesson(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    completed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (offering_id, lesson_id, account_id)
);

CREATE TABLE unoa.learner_note (
    offering_id uuid NOT NULL REFERENCES unoa.course_offering(id),
    lesson_id uuid NOT NULL REFERENCES unoa.lesson(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    body text CHECK (body IS NULL OR length(body) BETWEEN 1 AND 20000),
    bookmarked boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (offering_id, lesson_id, account_id)
);

CREATE TABLE unoa.forum_thread (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    offering_id uuid NOT NULL REFERENCES unoa.course_offering(id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    locked_at timestamptz
);

CREATE TABLE unoa.forum_post (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES unoa.forum_thread(id),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 10000),
    created_at timestamptz NOT NULL DEFAULT now(),
    hidden_at timestamptz,
    hidden_by uuid REFERENCES unoa.account(id),
    hidden_reason text CHECK (hidden_reason IS NULL OR length(btrim(hidden_reason)) BETWEEN 1 AND 500),
    CHECK ((hidden_at IS NULL) = (hidden_by IS NULL) AND (hidden_at IS NULL) = (hidden_reason IS NULL))
);

CREATE INDEX forum_post_thread ON unoa.forum_post(thread_id, created_at);

CREATE FUNCTION unoa.validate_forum_post() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF EXISTS (SELECT 1 FROM unoa.forum_thread WHERE id = NEW.thread_id AND locked_at IS NOT NULL) THEN
            RAISE EXCEPTION 'This discussion is locked' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF ROW(NEW.id, NEW.thread_id, NEW.author_id, NEW.body, NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.thread_id, OLD.author_id, OLD.body, OLD.created_at) OR OLD.hidden_at IS NOT NULL THEN
        RAISE EXCEPTION 'A message is moderated, never rewritten' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_forum_post
BEFORE INSERT OR UPDATE ON unoa.forum_post
FOR EACH ROW EXECUTE FUNCTION unoa.validate_forum_post();

-- Live sessions: the room name is random; the join link is signed per person.
CREATE TABLE unoa.live_session (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    offering_id uuid NOT NULL REFERENCES unoa.course_offering(id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    agenda text CHECK (agenda IS NULL OR length(btrim(agenda)) BETWEEN 1 AND 4000),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    room text NOT NULL UNIQUE CHECK (room ~ '^[a-z0-9]{32,64}$'),
    state text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'cancelled')),
    cancel_reason text CHECK (cancel_reason IS NULL OR length(btrim(cancel_reason)) BETWEEN 1 AND 500),
    recording_planned boolean NOT NULL DEFAULT false,
    replay_url text CHECK (replay_url IS NULL OR (replay_url ~ '^https://[^\s]+$' AND length(replay_url) <= 2000)),
    replay_published_at timestamptz,
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    row_version integer NOT NULL DEFAULT 1,
    CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '12 hours'),
    CHECK ((state = 'cancelled') = (cancel_reason IS NOT NULL)),
    CHECK ((replay_url IS NULL) = (replay_published_at IS NULL))
);

CREATE INDEX live_session_offering ON unoa.live_session(offering_id, starts_at);

CREATE FUNCTION unoa.validate_live_session() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.starts_at < statement_timestamp() OR NEW.state <> 'scheduled' OR NEW.replay_url IS NOT NULL THEN
            RAISE EXCEPTION 'A session is scheduled in the future' USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM unoa.course_offering WHERE id = NEW.offering_id AND state = 'open') THEN
            RAISE EXCEPTION 'Sessions belong to an open offering' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF ROW(NEW.id, NEW.offering_id, NEW.room, NEW.created_by, NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.offering_id, OLD.room, OLD.created_by, OLD.created_at) THEN
        RAISE EXCEPTION 'The identity of a session is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.state = 'cancelled' AND ROW(NEW.state, NEW.starts_at, NEW.ends_at, NEW.replay_url)
        IS DISTINCT FROM ROW(OLD.state, OLD.starts_at, OLD.ends_at, OLD.replay_url) THEN
        RAISE EXCEPTION 'A cancelled session stays cancelled' USING ERRCODE = '23514';
    END IF;
    IF ROW(NEW.starts_at, NEW.ends_at) IS DISTINCT FROM ROW(OLD.starts_at, OLD.ends_at)
        AND (OLD.starts_at <= statement_timestamp() OR NEW.starts_at < statement_timestamp()) THEN
        RAISE EXCEPTION 'Only a future session is rescheduled into the future' USING ERRCODE = '23514';
    END IF;
    IF NEW.recording_planned AND NOT OLD.recording_planned AND OLD.starts_at <= statement_timestamp() THEN
        RAISE EXCEPTION 'A recording is announced before the session starts' USING ERRCODE = '23514';
    END IF;
    IF NEW.replay_url IS NOT NULL AND OLD.replay_url IS NULL THEN
        IF NOT OLD.recording_planned OR OLD.ends_at > statement_timestamp() THEN
            RAISE EXCEPTION 'A replay requires an announced recording of a finished session' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM unoa.live_consent WHERE session_id = NEW.id AND decision = 'refused') THEN
            RAISE EXCEPTION 'A participant refused the recording' USING ERRCODE = '23514';
        END IF;
    END IF;
    NEW.row_version := OLD.row_version + 1;
    RETURN NEW;
END;
$$;

CREATE TABLE unoa.live_consent (
    session_id uuid NOT NULL REFERENCES unoa.live_session(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    decision text NOT NULL CHECK (decision IN ('granted', 'refused')),
    decided_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, account_id)
);

CREATE TRIGGER validate_live_session
BEFORE INSERT OR UPDATE ON unoa.live_session
FOR EACH ROW EXECUTE FUNCTION unoa.validate_live_session();

CREATE TRIGGER live_session_kept
BEFORE DELETE OR TRUNCATE ON unoa.live_session
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.live_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES unoa.live_session(id),
    kind text NOT NULL CHECK (kind IN ('scheduled', 'rescheduled', 'cancelled', 'recording_announced', 'replay_published')),
    actor_id uuid NOT NULL REFERENCES unoa.account(id),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    starts_at timestamptz,
    ends_at timestamptz,
    detail text CHECK (detail IS NULL OR length(btrim(detail)) BETWEEN 1 AND 500)
);

CREATE TRIGGER live_event_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.live_event
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Attendance keeps the first access and a count, no continuous tracking.
CREATE TABLE unoa.live_attendance (
    session_id uuid NOT NULL REFERENCES unoa.live_session(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    first_joined_at timestamptz,
    joins integer NOT NULL DEFAULT 0 CHECK (joins >= 0),
    status text CHECK (status IS NULL OR status IN ('present', 'absent', 'excused')),
    marked_by uuid REFERENCES unoa.account(id),
    marked_at timestamptz,
    PRIMARY KEY (session_id, account_id)
);

CREATE TABLE unoa.live_resource (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES unoa.live_session(id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    url text NOT NULL CHECK (url ~ '^https://[^\s]+$' AND length(url) <= 2000),
    shared_by uuid NOT NULL REFERENCES unoa.account(id),
    shared_at timestamptz NOT NULL DEFAULT now()
);

-- In-application notifications; external channels belong to the NOT module.
CREATE TABLE unoa.notification (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_.]{0,95}$'),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    body text CHECK (body IS NULL OR length(btrim(body)) BETWEEN 1 AND 2000),
    link text CHECK (link IS NULL OR link ~ '^/[A-Za-z0-9/_?=&.%#-]*$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz
);

CREATE INDEX notification_inbox ON unoa.notification(account_id, created_at DESC);

REVOKE EXECUTE ON FUNCTION unoa.offering_role(uuid, uuid) FROM PUBLIC;
