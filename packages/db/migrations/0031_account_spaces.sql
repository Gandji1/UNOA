-- Personal spaces shown to an account (owner's request: a clean menu). Only
-- the spaces that concern the account are listed; the pages themselves keep
-- their own server-side checks.
CREATE FUNCTION unoa.account_spaces(actor uuid) RETURNS text[]
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
        CASE WHEN EXISTS (SELECT 1 FROM unoa.council_member WHERE account_id = actor) THEN 'councils' END
    ], NULL);
$$;
REVOKE EXECUTE ON FUNCTION unoa.account_spaces(uuid) FROM PUBLIC;
