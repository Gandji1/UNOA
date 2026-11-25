-- Finance (module FIN): approved price rules by scope, programme, period and
-- profile; numbered invoices and credit notes that are never rewritten;
-- instalment plans; allowances (discounts, scholarships, employer funding)
-- approved by another person; payments confirmed only by a signed provider
-- event, processed once; an append-only ledger from which every balance is
-- computed; receipts; refunds and chargebacks; bank reconciliation; holds
-- limited to legally admitted effects.

INSERT INTO unoa.permission(code, module, label, sensitive) VALUES
    ('fin.read', 'FIN', 'Consulter les données financières', true),
    ('fin.tariff', 'FIN', 'Rédiger les tarifs et règles de retenue', true),
    ('fin.approve', 'FIN', 'Approuver tarifs, remises, bourses et remboursements', true),
    ('fin.invoice', 'FIN', 'Émettre factures et avoirs, proposer remises et remboursements', true),
    ('fin.reconcile', 'FIN', 'Rapprocher les relevés bancaires', true),
    ('fin.export', 'FIN', 'Exporter journaux et états comptables', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label, sensitive = EXCLUDED.sensitive;

INSERT INTO unoa.access_role(code, label, description, level, ordinal) VALUES
    ('finance_officer', 'Gestionnaire financier', 'Rédige les tarifs, émet factures et avoirs, propose remises et remboursements, rapproche les relevés.', 'institution', 128),
    ('finance_controller', 'Contrôleur financier', 'Approuve tarifs, remises, bourses et remboursements rédigés par d’autres ; exporte les états.', 'institution', 129)
ON CONFLICT (code) DO NOTHING;

INSERT INTO unoa.role_permission(role_code, permission_code)
SELECT role, permission FROM (VALUES
    ('finance_officer', 'fin.read'), ('finance_officer', 'fin.tariff'), ('finance_officer', 'fin.invoice'), ('finance_officer', 'fin.reconcile'), ('finance_officer', 'fin.export'),
    ('finance_controller', 'fin.read'), ('finance_controller', 'fin.approve'), ('finance_controller', 'fin.export'),
    ('institution_admin', 'fin.read'), ('auditor', 'fin.read')
) AS item(role, permission)
WHERE EXISTS (SELECT 1 FROM unoa.access_role WHERE code = item.role)
ON CONFLICT DO NOTHING;

INSERT INTO unoa.notification_event(code, module, variables, sensitive) VALUES
    ('fin.invoice_issued', 'FIN', '{number,amount}', true),
    ('fin.payment_confirmed', 'FIN', '{receipt,amount}', true),
    ('fin.payment_failed', 'FIN', '{amount}', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE unoa.price_rule (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    program_version_id uuid REFERENCES unoa.program_version(id),
    academic_year text CHECK (academic_year IS NULL OR academic_year ~ '^[0-9]{4}-[0-9]{4}$'),
    profile text CHECK (profile IS NULL OR length(btrim(profile)) BETWEEN 1 AND 60),
    kind text NOT NULL CHECK (kind IN ('application_fee', 'tuition', 'recurring', 'service')),
    recurrence text NOT NULL CHECK (recurrence IN ('once', 'per_period', 'monthly')),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    instalments integer NOT NULL DEFAULT 1 CHECK (instalments BETWEEN 1 AND 24),
    interval_days integer NOT NULL DEFAULT 30 CHECK (interval_days BETWEEN 1 AND 366),
    effective_from date NOT NULL,
    effective_until date,
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'retired')),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    publisher_id uuid REFERENCES unoa.account(id),
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (effective_until IS NULL OR effective_until > effective_from),
    CHECK ((state = 'draft') = (publisher_id IS NULL)),
    CHECK (publisher_id IS NULL OR publisher_id <> author_id)
);
CREATE FUNCTION unoa.validate_price_rule() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A price rule is kept' USING ERRCODE = '23514'; END IF;
    IF OLD.state <> 'draft' AND (ROW(NEW.scope_id, NEW.program_version_id, NEW.academic_year, NEW.profile, NEW.kind, NEW.recurrence, NEW.label, NEW.amount_minor,
        NEW.currency, NEW.instalments, NEW.interval_days, NEW.effective_from, NEW.effective_until, NEW.author_id, NEW.publisher_id)
        IS DISTINCT FROM ROW(OLD.scope_id, OLD.program_version_id, OLD.academic_year, OLD.profile, OLD.kind, OLD.recurrence, OLD.label, OLD.amount_minor,
        OLD.currency, OLD.instalments, OLD.interval_days, OLD.effective_from, OLD.effective_until, OLD.author_id, OLD.publisher_id)
        OR (OLD.state = 'retired' AND NEW.state <> 'retired')) THEN
        RAISE EXCEPTION 'A published price rule is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_price_rule BEFORE UPDATE OR DELETE ON unoa.price_rule FOR EACH ROW EXECUTE FUNCTION unoa.validate_price_rule();

-- Numbering of invoices, credit notes and receipts: one gapless series per establishment, series and year.
CREATE TABLE unoa.fin_counter (
    institution_id uuid NOT NULL REFERENCES unoa.scope(id),
    series text NOT NULL CHECK (series IN ('FAC', 'AV', 'REC')),
    year integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
    next_value bigint NOT NULL CHECK (next_value > 0),
    PRIMARY KEY (institution_id, series, year)
);

CREATE TABLE unoa.invoice (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id uuid NOT NULL REFERENCES unoa.scope(id),
    number text NOT NULL CHECK (number ~ '^(FAC|AV)-[0-9]{4}-[0-9]{6}$'),
    kind text NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
    credit_of uuid REFERENCES unoa.invoice(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    price_rule_id uuid REFERENCES unoa.price_rule(id),
    billing_period text CHECK (billing_period IS NULL OR length(btrim(billing_period)) BETWEEN 1 AND 40),
    profile text,
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_minor bigint NOT NULL CHECK (total_minor > 0),
    reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 1000),
    issued_by uuid NOT NULL REFERENCES unoa.account(id),
    issued_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (institution_id, number),
    CHECK ((kind = 'credit_note') = (credit_of IS NOT NULL)),
    CHECK (kind = 'invoice' OR reason IS NOT NULL)
);
CREATE UNIQUE INDEX invoice_once_per_period ON unoa.invoice(price_rule_id, account_id, billing_period) WHERE kind = 'invoice' AND billing_period IS NOT NULL;
CREATE INDEX invoice_account ON unoa.invoice(account_id, institution_id);
CREATE TRIGGER invoice_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.invoice FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.invoice_line (
    invoice_id uuid NOT NULL REFERENCES unoa.invoice(id),
    ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
    quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
    unit_minor bigint NOT NULL CHECK (unit_minor > 0),
    amount_minor bigint NOT NULL CHECK (amount_minor = quantity * unit_minor),
    PRIMARY KEY (invoice_id, ordinal)
);
CREATE TRIGGER invoice_line_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.invoice_line FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.instalment (
    invoice_id uuid NOT NULL REFERENCES unoa.invoice(id),
    ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 24),
    due_on date NOT NULL,
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    PRIMARY KEY (invoice_id, ordinal)
);
CREATE TRIGGER instalment_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.instalment FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.allowance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id uuid NOT NULL REFERENCES unoa.invoice(id),
    kind text NOT NULL CHECK (kind IN ('discount', 'scholarship', 'employer')),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
    funder text CHECK (funder IS NULL OR length(btrim(funder)) BETWEEN 1 AND 200),
    basis text NOT NULL CHECK (basis IN ('amount', 'percent')),
    value numeric(14, 2) NOT NULL CHECK (value > 0),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'approved', 'rejected')),
    proposed_by uuid NOT NULL REFERENCES unoa.account(id),
    decided_by uuid REFERENCES unoa.account(id),
    decided_at timestamptz,
    decision_note text CHECK (decision_note IS NULL OR length(btrim(decision_note)) BETWEEN 1 AND 1000),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'proposed') = (decided_by IS NULL)),
    CHECK (decided_by IS NULL OR decided_by <> proposed_by),
    CHECK (kind <> 'employer' OR funder IS NOT NULL)
);

CREATE TABLE unoa.payment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id uuid NOT NULL REFERENCES unoa.scope(id),
    invoice_id uuid NOT NULL REFERENCES unoa.invoice(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
    provider_ref text NOT NULL CHECK (length(provider_ref) BETWEEN 1 AND 120),
    idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 16 AND 120),
    state text NOT NULL DEFAULT 'pending_provider' CHECK (state IN ('pending_provider', 'confirmed', 'failed', 'cancelled', 'refunded', 'chargeback')),
    failure text CHECK (failure IS NULL OR length(failure) <= 200),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    UNIQUE (provider, provider_ref)
);
-- Lifecycle: the browser return never confirms; only a verified provider event moves a payment.
CREATE FUNCTION unoa.validate_payment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' OR ROW(NEW.institution_id, NEW.invoice_id, NEW.account_id, NEW.amount_minor, NEW.currency, NEW.provider, NEW.provider_ref, NEW.idempotency_key, NEW.created_by)
        IS DISTINCT FROM ROW(OLD.institution_id, OLD.invoice_id, OLD.account_id, OLD.amount_minor, OLD.currency, OLD.provider, OLD.provider_ref, OLD.idempotency_key, OLD.created_by) THEN
        RAISE EXCEPTION 'A payment identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.state <> OLD.state AND NOT (
        (OLD.state = 'pending_provider' AND NEW.state IN ('confirmed', 'failed', 'cancelled'))
        OR (OLD.state = 'confirmed' AND NEW.state IN ('refunded', 'chargeback'))) THEN
        RAISE EXCEPTION 'Invalid payment transition' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_payment BEFORE UPDATE OR DELETE ON unoa.payment FOR EACH ROW EXECUTE FUNCTION unoa.validate_payment();

-- Every provider notification, valid or not, processed once per event id (FIN-008).
CREATE TABLE unoa.provider_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    event_id text CHECK (event_id IS NULL OR length(event_id) BETWEEN 1 AND 120),
    type text CHECK (type IS NULL OR length(type) <= 60),
    payload jsonb,
    signature_valid boolean NOT NULL,
    outcome text NOT NULL CHECK (length(outcome) BETWEEN 1 AND 200),
    received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX provider_event_once ON unoa.provider_event(provider, event_id) WHERE signature_valid;
CREATE TRIGGER provider_event_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.provider_event FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.refund (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES unoa.payment(id),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'rejected', 'sent', 'succeeded', 'failed')),
    requested_by uuid NOT NULL REFERENCES unoa.account(id),
    approved_by uuid REFERENCES unoa.account(id),
    provider_ref text UNIQUE CHECK (provider_ref IS NULL OR length(provider_ref) BETWEEN 1 AND 120),
    failure text CHECK (failure IS NULL OR length(failure) <= 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (approved_by IS NULL OR approved_by <> requested_by),
    CHECK (state IN ('requested') OR approved_by IS NOT NULL)
);

CREATE TABLE unoa.ledger_entry (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id uuid NOT NULL REFERENCES unoa.scope(id),
    account_id uuid NOT NULL REFERENCES unoa.account(id),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
    kind text NOT NULL CHECK (kind IN ('invoice', 'credit_note', 'allowance', 'payment', 'refund', 'chargeback')),
    invoice_id uuid REFERENCES unoa.invoice(id),
    payment_id uuid REFERENCES unoa.payment(id),
    allowance_id uuid REFERENCES unoa.allowance(id),
    refund_id uuid REFERENCES unoa.refund(id),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((kind IN ('invoice', 'refund', 'chargeback')) = (amount_minor > 0))
);
CREATE INDEX ledger_entry_account ON unoa.ledger_entry(account_id, institution_id, currency);
CREATE INDEX ledger_entry_institution ON unoa.ledger_entry(institution_id, created_at);
CREATE TRIGGER ledger_entry_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.ledger_entry FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.receipt (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id uuid NOT NULL REFERENCES unoa.scope(id),
    number text NOT NULL CHECK (number ~ '^REC-[0-9]{4}-[0-9]{6}$'),
    payment_id uuid NOT NULL UNIQUE REFERENCES unoa.payment(id),
    sha256 text NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    issued_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (institution_id, number)
);
CREATE TRIGGER receipt_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON unoa.receipt FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE TABLE unoa.bank_line (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id uuid NOT NULL REFERENCES unoa.scope(id),
    statement_label text NOT NULL CHECK (length(btrim(statement_label)) BETWEEN 1 AND 120),
    booked_on date NOT NULL,
    amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 120),
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    imported_by uuid NOT NULL REFERENCES unoa.account(id),
    imported_at timestamptz NOT NULL DEFAULT now(),
    matched_payment_id uuid UNIQUE REFERENCES unoa.payment(id),
    matched_by uuid REFERENCES unoa.account(id),
    matched_at timestamptz,
    note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
    UNIQUE (institution_id, fingerprint),
    CHECK ((matched_payment_id IS NULL) = (matched_at IS NULL))
);
CREATE FUNCTION unoa.validate_bank_line() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' OR OLD.matched_payment_id IS NOT NULL OR ROW(NEW.institution_id, NEW.statement_label, NEW.booked_on, NEW.amount_minor, NEW.currency, NEW.reference, NEW.fingerprint)
        IS DISTINCT FROM ROW(OLD.institution_id, OLD.statement_label, OLD.booked_on, OLD.amount_minor, OLD.currency, OLD.reference, OLD.fingerprint) THEN
        RAISE EXCEPTION 'A bank line is matched once and never rewritten' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_bank_line BEFORE UPDATE OR DELETE ON unoa.bank_line FOR EACH ROW EXECUTE FUNCTION unoa.validate_bank_line();

-- Holds: only reminders or the withholding of internal administrative documents;
-- never access to courses, examinations or one's own data (FIN-013).
CREATE TABLE unoa.hold_rule (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL REFERENCES unoa.scope(id),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
    min_overdue_days integer NOT NULL CHECK (min_overdue_days BETWEEN 0 AND 3650),
    min_amount_minor bigint NOT NULL CHECK (min_amount_minor >= 0),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    effect text NOT NULL CHECK (effect IN ('reminder', 'withhold_internal_documents')),
    legal_basis text NOT NULL CHECK (length(btrim(legal_basis)) BETWEEN 1 AND 1000),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'retired')),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    publisher_id uuid REFERENCES unoa.account(id),
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'draft') = (publisher_id IS NULL)),
    CHECK (publisher_id IS NULL OR publisher_id <> author_id)
);
