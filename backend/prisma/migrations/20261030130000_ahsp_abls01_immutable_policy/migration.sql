-- ABLS-01: historical approved policy decisions must be append-only.
-- Revocation/correction uses a newer version; no rewrite of historical policy.
CREATE FUNCTION public.abls01_forbid_policy_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ABLS_POLICY_APPEND_ONLY: append a new version instead'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER abls01_policy_append_only
BEFORE UPDATE OR DELETE ON public.auxiliary_equipment_estimate_policies
FOR EACH ROW EXECUTE FUNCTION public.abls01_forbid_policy_mutation();
