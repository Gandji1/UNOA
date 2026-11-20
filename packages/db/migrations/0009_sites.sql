-- Multi-establishment public sites. The brand, texts and legal pages of every
-- public site are data, versioned per language and published by a second
-- person. Each site serves one scope (platform, territory or establishment),
-- is reached through its declared host names, and only exposes public data
-- from inside that scope.

-- Audit review fixes on earlier lots.
ALTER TABLE unoa.scope_type ALTER COLUMN nature DROP DEFAULT;
CREATE INDEX audit_event_actor_time ON unoa.audit_event(actor_id, occurred_at DESC);

CREATE FUNCTION unoa.scope_within(target uuid, ancestor uuid) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    WITH RECURSIVE ancestry AS (
        SELECT id, parent_id FROM unoa.scope WHERE id = target
        UNION ALL
        SELECT scope.id, scope.parent_id FROM unoa.scope JOIN ancestry ON scope.id = ancestry.parent_id
    )
    SELECT EXISTS (SELECT 1 FROM ancestry WHERE id = ancestor);
$$;

CREATE TABLE unoa.site (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL UNIQUE REFERENCES unoa.scope(id),
    default_language text NOT NULL CHECK (default_language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
    online boolean NOT NULL DEFAULT false,
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    changed_by uuid REFERENCES unoa.account(id),
    changed_at timestamptz,
    row_version integer NOT NULL DEFAULT 1
);

CREATE TABLE unoa.site_host (
    host text PRIMARY KEY CHECK (host ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:[0-9]{1,5})?$'),
    site_id uuid NOT NULL REFERENCES unoa.site(id),
    created_by uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX site_host_site ON unoa.site_host(site_id);

-- Each save creates a new version; publication archives the previous one, so
-- every publication keeps its author, its publisher and its date.
CREATE TABLE unoa.site_text (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id uuid NOT NULL REFERENCES unoa.site(id),
    language text NOT NULL CHECK (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'archived')),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
    short_name text NOT NULL CHECK (length(btrim(short_name)) BETWEEN 1 AND 24),
    tagline text CHECK (tagline IS NULL OR length(btrim(tagline)) BETWEEN 1 AND 200),
    hero_title text CHECK (hero_title IS NULL OR length(btrim(hero_title)) BETWEEN 1 AND 160),
    hero_text text CHECK (hero_text IS NULL OR length(btrim(hero_text)) BETWEEN 1 AND 1000),
    hero_image_url text CHECK (hero_image_url IS NULL OR (hero_image_url ~ '^https://[^\s]+$' AND length(hero_image_url) <= 2000)),
    about text CHECK (about IS NULL OR length(btrim(about)) BETWEEN 1 AND 20000),
    contact text CHECK (contact IS NULL OR length(btrim(contact)) BETWEEN 1 AND 2000),
    legal_notice text CHECK (legal_notice IS NULL OR length(btrim(legal_notice)) BETWEEN 1 AND 40000),
    privacy_notice text CHECK (privacy_notice IS NULL OR length(btrim(privacy_notice)) BETWEEN 1 AND 40000),
    footer text CHECK (footer IS NULL OR length(btrim(footer)) BETWEEN 1 AND 500),
    author_id uuid NOT NULL REFERENCES unoa.account(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    published_by uuid REFERENCES unoa.account(id),
    published_at timestamptz,
    CHECK (published_by IS NULL OR published_by <> author_id),
    CHECK ((published_by IS NULL) = (published_at IS NULL)),
    CHECK (state <> 'published' OR published_by IS NOT NULL)
);

CREATE UNIQUE INDEX site_text_published ON unoa.site_text(site_id, language) WHERE state = 'published';
CREATE INDEX site_text_history ON unoa.site_text(site_id, language, created_at DESC);

CREATE FUNCTION unoa.validate_site() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.online OR NOT EXISTS (
            SELECT 1 FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
            WHERE scope.id = NEW.scope_id AND kind.nature IN ('platform', 'territory', 'institution')
        ) THEN
            RAISE EXCEPTION 'A site serves a platform, a territory or an establishment and starts offline' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF ROW(NEW.id, NEW.scope_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM ROW(OLD.id, OLD.scope_id, OLD.created_by, OLD.created_at) THEN
        RAISE EXCEPTION 'The identity of a site is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.online AND NOT EXISTS (
        SELECT 1 FROM unoa.site_text WHERE site_id = NEW.id AND language = NEW.default_language AND state = 'published'
    ) THEN
        RAISE EXCEPTION 'A site goes online with published texts in its default language' USING ERRCODE = '23514';
    END IF;
    NEW.row_version := OLD.row_version + 1;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_site
BEFORE INSERT OR UPDATE ON unoa.site
FOR EACH ROW EXECUTE FUNCTION unoa.validate_site();

CREATE TRIGGER site_kept
BEFORE DELETE OR TRUNCATE ON unoa.site
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

CREATE FUNCTION unoa.validate_site_text() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, unoa, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.state <> 'draft' THEN
            RAISE EXCEPTION 'A text version starts as a draft' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF ROW(NEW.id, NEW.site_id, NEW.language, NEW.name, NEW.short_name, NEW.tagline, NEW.hero_title, NEW.hero_text,
           NEW.hero_image_url, NEW.about, NEW.contact, NEW.legal_notice, NEW.privacy_notice, NEW.footer, NEW.author_id, NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.site_id, OLD.language, OLD.name, OLD.short_name, OLD.tagline, OLD.hero_title, OLD.hero_text,
           OLD.hero_image_url, OLD.about, OLD.contact, OLD.legal_notice, OLD.privacy_notice, OLD.footer, OLD.author_id, OLD.created_at) THEN
        RAISE EXCEPTION 'A text version is immutable; save a new version' USING ERRCODE = '23514';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
        (OLD.state = 'draft' AND NEW.state IN ('published', 'archived')) OR (OLD.state = 'published' AND NEW.state = 'archived')
    ) THEN
        RAISE EXCEPTION 'Text version transition refused' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_site_text
BEFORE INSERT OR UPDATE ON unoa.site_text
FOR EACH ROW EXECUTE FUNCTION unoa.validate_site_text();

CREATE TRIGGER site_text_kept
BEFORE DELETE OR TRUNCATE ON unoa.site_text
FOR EACH STATEMENT EXECUTE FUNCTION unoa.reject_history_mutation();

-- Site resolved from the request host, with its published texts in the wanted
-- language or else in its default language.
CREATE FUNCTION unoa.public_site(requested_host text, wanted_language text)
RETURNS TABLE (site_id uuid, scope_id uuid, language text, default_language text, languages text[],
               name text, short_name text, tagline text, hero_title text, hero_text text, hero_image_url text,
               about text, contact text, legal_notice text, privacy_notice text, footer text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT site.id, site.scope_id, content.language, site.default_language,
           (SELECT array_agg(language ORDER BY language) FROM unoa.site_text WHERE site_id = site.id AND state = 'published'),
           content.name, content.short_name, content.tagline, content.hero_title, content.hero_text, content.hero_image_url,
           content.about, content.contact, content.legal_notice, content.privacy_notice, content.footer
    FROM unoa.site_host AS host
    JOIN unoa.site ON site.id = host.site_id AND site.online
    JOIN LATERAL (
        SELECT * FROM unoa.site_text AS candidate
        WHERE candidate.site_id = site.id AND candidate.state = 'published'
          AND candidate.language IN (wanted_language, split_part(wanted_language, '-', 1), site.default_language)
        ORDER BY candidate.language = wanted_language DESC, candidate.language = split_part(wanted_language, '-', 1) DESC
        LIMIT 1
    ) AS content ON true
    WHERE host.host = lower(requested_host);
$$;

DROP FUNCTION unoa.public_programs();
DROP FUNCTION unoa.public_program_sheet(uuid);
DROP FUNCTION unoa.public_org_units();
DROP FUNCTION unoa.public_org_positions();

CREATE FUNCTION unoa.site_scope(target_site uuid) RETURNS uuid
LANGUAGE sql STABLE
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT scope_id FROM unoa.site WHERE id = target_site AND online;
$$;

CREATE FUNCTION unoa.public_programs(target_site uuid)
RETURNS TABLE (program_id uuid, version_id uuid, version_number integer, code text, title text,
               kind_label text, degree_awarding boolean, field_label text, institution_label text,
               owner_label text, delivery_mode text, duration text, languages text[],
               territories text[], regulatory_status text, admission_open boolean, published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT program.id, version.id, version.number, program.code, version.title,
           kind.label, kind.degree_awarding, field.label, institution.label, owner.label,
           version.delivery_mode, version.duration, version.languages,
           coalesce((SELECT array_agg(zone.label ORDER BY zone.label)
                     FROM unoa.version_territory AS eligible
                     JOIN unoa.scope AS zone ON zone.id = eligible.territory_id
                     WHERE eligible.version_id = version.id), '{}'),
           unoa.program_regulatory_status(program.id),
           version.admission_open AND unoa.program_admission_allowed(program.id),
           version.published_at
    FROM unoa.program_version AS version
    JOIN unoa.program ON program.id = version.program_id
    JOIN unoa.program_kind AS kind ON kind.code = program.kind_code
    JOIN unoa.scope AS institution ON institution.id = program.institution_id
    JOIN unoa.scope AS owner ON owner.id = program.owner_scope_id
    LEFT JOIN unoa.academic_field AS field ON field.id = program.field_id
    WHERE version.state = 'published'
      AND unoa.scope_within(program.institution_id, unoa.site_scope(target_site))
    ORDER BY version.title, program.code
    LIMIT 2000;
$$;

CREATE FUNCTION unoa.public_program_sheet(target_site uuid, target uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT jsonb_build_object(
        'program', jsonb_build_object(
            'id', program.id, 'code', program.code, 'kind', kind.label, 'degreeAwarding', kind.degree_awarding,
            'field', field.label, 'institution', institution.label, 'owner', owner.label,
            'regulatoryStatus', unoa.program_regulatory_status(program.id),
            'admissionOpen', version.admission_open AND unoa.program_admission_allowed(program.id),
            'labels', coalesce((SELECT jsonb_agg(jsonb_build_object('language', label.language, 'title', label.title,
                'summary', label.summary) ORDER BY label.language) FROM unoa.program_label AS label
                WHERE label.program_id = program.id), '[]'::jsonb)),
        'version', jsonb_build_object(
            'id', version.id, 'number', version.number, 'title', version.title, 'organisation', version.organisation,
            'duration', version.duration, 'deliveryMode', version.delivery_mode, 'creditUnit', version.credit_unit,
            'expectedCredits', version.expected_credits, 'languages', version.languages, 'capacity', version.capacity,
            'objectives', version.objectives, 'admission', version.admission, 'publishedAt', version.published_at),
        'territories', coalesce((SELECT jsonb_agg(zone.label ORDER BY zone.label) FROM unoa.version_territory AS eligible
            JOIN unoa.scope AS zone ON zone.id = eligible.territory_id WHERE eligible.version_id = version.id), '[]'::jsonb),
        'competencies', coalesce((SELECT jsonb_agg(jsonb_build_object('code', competency.code, 'label', competency.label)
            ORDER BY competency.code) FROM unoa.version_competency AS link
            JOIN unoa.competency ON competency.id = link.competency_id WHERE link.version_id = version.id), '[]'::jsonb),
        'requirements', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', requirement.kind, 'label', requirement.label,
            'credits', requirement.credits, 'mandatory', requirement.mandatory) ORDER BY requirement.label)
            FROM unoa.version_requirement AS requirement WHERE requirement.version_id = version.id), '[]'::jsonb),
        'periods', coalesce((SELECT jsonb_agg(jsonb_build_object('ordinal', period.ordinal, 'label', period.label,
            'groups', coalesce((SELECT jsonb_agg(jsonb_build_object('id', grp.id, 'label', grp.label,
                'min', grp.min_choices, 'max', grp.max_choices) ORDER BY grp.label)
                FROM unoa.option_group AS grp WHERE grp.period_id = period.id), '[]'::jsonb),
            'units', coalesce((SELECT jsonb_agg(jsonb_build_object('id', unit.id, 'code', unit.code, 'title', unit.title,
                'credits', unit.credits, 'coefficient', unit.coefficient, 'groupId', unit.option_group_id,
                'volumes', coalesce((SELECT jsonb_agg(jsonb_build_object('activity', volume.activity, 'hours', volume.hours)
                    ORDER BY volume.activity) FROM unoa.unit_volume AS volume WHERE volume.unit_id = unit.id), '[]'::jsonb),
                'courses', coalesce((SELECT jsonb_agg(jsonb_build_object('code', course.code, 'title', course.title)
                    ORDER BY course.code) FROM unoa.unit_course AS link JOIN unoa.course ON course.id = link.course_id
                    WHERE link.unit_id = unit.id), '[]'::jsonb),
                'requires', coalesce((SELECT jsonb_agg(link.required_unit_id) FROM unoa.unit_prerequisite AS link
                    WHERE link.unit_id = unit.id), '[]'::jsonb))
                ORDER BY unit.code) FROM unoa.teaching_unit AS unit WHERE unit.period_id = period.id), '[]'::jsonb))
            ORDER BY period.ordinal) FROM unoa.program_period AS period WHERE period.version_id = version.id), '[]'::jsonb))
    FROM unoa.program_version AS version
    JOIN unoa.program ON program.id = version.program_id
    JOIN unoa.program_kind AS kind ON kind.code = program.kind_code
    JOIN unoa.scope AS institution ON institution.id = program.institution_id
    JOIN unoa.scope AS owner ON owner.id = program.owner_scope_id
    LEFT JOIN unoa.academic_field AS field ON field.id = program.field_id
    WHERE program.id = target AND version.state = 'published'
      AND unoa.scope_within(program.institution_id, unoa.site_scope(target_site));
$$;

CREATE FUNCTION unoa.public_org_units(target_site uuid)
RETURNS TABLE (id uuid, parent_id uuid, institution_id uuid, institution_label text,
               label text, type_label text, code text, mission text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT scope.id, scope.parent_id, unit.institution_id, institution.label,
           scope.label, kind.label, unit.code, unit.mission
    FROM unoa.org_unit AS unit
    JOIN unoa.scope AS scope ON scope.id = unit.scope_id
    JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    JOIN unoa.scope AS institution ON institution.id = unit.institution_id
    WHERE unit.status = 'active' AND unit.public
      AND scope.present_from <= statement_timestamp()
      AND (scope.present_until IS NULL OR scope.present_until > statement_timestamp())
      AND unoa.scope_within(unit.institution_id, unoa.site_scope(target_site))
    ORDER BY institution.label, scope.label
    LIMIT 2000;
$$;

CREATE FUNCTION unoa.public_org_positions(target_site uuid)
RETURNS TABLE (unit_id uuid, title text, is_head boolean, holder text, capacity text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT position.unit_id, position.title, position.is_head, appointment.public_name, appointment.capacity
    FROM unoa.org_position AS position
    JOIN unoa.org_unit AS unit ON unit.scope_id = position.unit_id
    JOIN unoa.org_appointment AS appointment ON appointment.position_id = position.id
    WHERE position.public AND unit.public AND unit.status = 'active'
      AND appointment.public_name IS NOT NULL
      AND appointment.effective_from <= statement_timestamp()
      AND (appointment.effective_until IS NULL OR appointment.effective_until > statement_timestamp())
      AND unoa.scope_within(unit.institution_id, unoa.site_scope(target_site))
    ORDER BY position.is_head DESC, position.title, appointment.capacity
    LIMIT 5000;
$$;

REVOKE EXECUTE ON FUNCTION unoa.scope_within(uuid, uuid), unoa.site_scope(uuid), unoa.public_site(text, text),
    unoa.public_programs(uuid), unoa.public_program_sheet(uuid, uuid), unoa.public_org_units(uuid),
    unoa.public_org_positions(uuid) FROM PUBLIC;

-- Navigation: the permission codes an account currently holds in any scope.
-- It only shapes menus; every route still checks the permission in its scope.
CREATE FUNCTION unoa.account_permissions(actor uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, unoa, pg_temp
AS $$
    SELECT coalesce(array_agg(DISTINCT allowed.permission_code ORDER BY allowed.permission_code), '{}')
    FROM unoa.role_grant AS assignment
    JOIN unoa.account ON account.id = assignment.account_id AND account.disabled_at IS NULL
    JOIN unoa.role_permission AS allowed ON allowed.role_code = assignment.role_code
    WHERE assignment.account_id = actor AND assignment.revoked_at IS NULL
      AND assignment.effective_from <= statement_timestamp()
      AND (assignment.effective_until IS NULL OR statement_timestamp() < assignment.effective_until);
$$;

REVOKE EXECUTE ON FUNCTION unoa.account_permissions(uuid) FROM PUBLIC;
