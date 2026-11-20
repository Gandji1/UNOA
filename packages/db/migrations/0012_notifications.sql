-- Durable job queue (transactional outbox) and multichannel notifications:
-- event catalogue, templates per scope and language, contact consents,
-- preferences, delivery proof and the sandbox mailbox.

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('not.read', 'NOT', 'Consulter les modèles et le journal des envois', false),
    ('not.manage', 'NOT', 'Rédiger les modèles de notification', false),
    ('not.publish', 'NOT', 'Publier les modèles de notification', true),
    ('ops.jobs', 'OPS', 'Superviser les files de traitement et rejouer', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;

CREATE TABLE unoa.notification_event (
    code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_.]{0,95}$'),
    module text NOT NULL CHECK (module ~ '^[A-Z0-9]{2,8}$'),
    variables text[] NOT NULL DEFAULT '{}',
    sensitive boolean NOT NULL DEFAULT false
);

INSERT INTO unoa.notification_event(code, module, variables, sensitive) VALUES
    ('adm.receipt', 'ADM', '{program,receipt,revision}', false),
    ('adm.complement', 'ADM', '{program,message}', true),
    ('adm.interview', 'ADM', '{program,kind,place}', false),
    ('adm.decision', 'ADM', '{program}', true),
    ('adm.appeal_ruled', 'ADM', '{program,outcome}', true),
    ('live.scheduled', 'LIVE', '{title,start,recording}', false),
    ('live.rescheduled', 'LIVE', '{title,start,reason}', false),
    ('live.cancelled', 'LIVE', '{title,reason}', false),
    ('live.recording', 'LIVE', '{title}', false),
    ('live.replay', 'LIVE', '{title}', false)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, variables = EXCLUDED.variables, sensitive = EXCLUDED.sensitive;

CREATE TABLE unoa.notification_template (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    event_code text NOT NULL REFERENCES unoa.notification_event(code),
    channel text NOT NULL CHECK (channel IN ('internal', 'email', 'sms')),
    language text NOT NULL CHECK (language ~ '^[a-z]{2,3}$'),
    subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 200),
    body text NOT NULL CHECK (length(body) <= 2000),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'retired')),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    published_by uuid REFERENCES unoa.account(id),
    published_at timestamptz,
    CHECK (channel <> 'sms' OR length(body) <= 480),
    CHECK ((state = 'draft') = (published_by IS NULL)),
    CHECK (published_by IS NULL OR published_by <> author_id)
);

CREATE UNIQUE INDEX notification_template_current ON unoa.notification_template(scope_id, event_code, channel, language)
    WHERE state = 'published';

CREATE FUNCTION unoa.validate_notification_template() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'A template is retired, never deleted' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (ROW(NEW.id, NEW.scope_id, NEW.event_code, NEW.channel, NEW.language, NEW.subject, NEW.body,
        NEW.author_id, NEW.created_at) IS DISTINCT FROM ROW(OLD.id, OLD.scope_id, OLD.event_code, OLD.channel, OLD.language,
        OLD.subject, OLD.body, OLD.author_id, OLD.created_at)
        OR NOT ((OLD.state = 'draft' AND NEW.state = 'published') OR (OLD.state = 'published' AND NEW.state = 'retired'))) THEN
        RAISE EXCEPTION 'A template version is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_notification_template BEFORE UPDATE OR DELETE ON unoa.notification_template
FOR EACH ROW EXECUTE FUNCTION unoa.validate_notification_template();

ALTER TABLE unoa.account
    ADD COLUMN language text CHECK (language IS NULL OR language ~ '^[a-z]{2,3}$'),
    ADD COLUMN phone text CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$');

-- Consents are an append-only history; the latest row per channel applies.
CREATE TABLE unoa.contact_consent (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    channel text NOT NULL CHECK (channel IN ('email', 'sms')),
    granted boolean NOT NULL,
    source text NOT NULL CHECK (source IN ('account', 'administration')),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX contact_consent_account ON unoa.contact_consent(account_id, channel, recorded_at DESC);
CREATE TRIGGER contact_consent_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.contact_consent
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.notification_preference (
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    event_code text NOT NULL REFERENCES unoa.notification_event(code),
    channel text NOT NULL CHECK (channel IN ('email', 'sms')),
    enabled boolean NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, event_code, channel)
);

ALTER TABLE unoa.notification
    ADD COLUMN scope_id uuid REFERENCES unoa.scope(id),
    ADD COLUMN template_id uuid REFERENCES unoa.notification_template(id),
    ADD COLUMN language text CHECK (language IS NULL OR language ~ '^[a-z]{2,3}$');

-- Durable queue. Inserted in the same transaction as the business change
-- (outbox); processed by the worker with SKIP LOCKED; capped retries, then dead.
CREATE TABLE unoa.job (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_.]{0,62}$'),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    scope_id uuid REFERENCES unoa.scope(id),
    idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 200),
    state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'failed', 'done', 'dead', 'skipped')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
    run_after timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz,
    last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
    correlation_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    replayed_by uuid REFERENCES unoa.account(id),
    replayed_at timestamptz
);
CREATE INDEX job_ready ON unoa.job(run_after) WHERE state IN ('queued', 'failed');
CREATE INDEX job_state ON unoa.job(state, created_at DESC);

CREATE TABLE unoa.delivery_attempt (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES unoa.job(id),
    notification_id uuid REFERENCES unoa.notification(id),
    channel text NOT NULL CHECK (channel IN ('email', 'sms')),
    adapter text NOT NULL CHECK (adapter ~ '^[a-z][a-z0-9_]{0,30}$'),
    recipient_masked text NOT NULL CHECK (length(recipient_masked) <= 260),
    status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
    provider_ref text CHECK (provider_ref IS NULL OR length(provider_ref) <= 200),
    error text CHECK (error IS NULL OR length(error) <= 500),
    attempted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX delivery_attempt_job ON unoa.delivery_attempt(job_id);
CREATE INDEX delivery_attempt_time ON unoa.delivery_attempt(attempted_at DESC);
CREATE TRIGGER delivery_attempt_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.delivery_attempt
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- What the sandbox adapter "sent": visible to the operators, never delivered.
CREATE TABLE unoa.sandbox_message (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES unoa.job(id),
    channel text NOT NULL CHECK (channel IN ('email', 'sms')),
    recipient text NOT NULL CHECK (length(recipient) <= 254),
    subject text,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sandbox_message_time ON unoa.sandbox_message(created_at DESC);
