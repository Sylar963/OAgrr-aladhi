-- Rename regime labels from directional names (bull/neutral/stress) to the
-- vol-level semantics they actually describe (low-vol/mid-vol/high-vol). The
-- HMM clusters states by ATM IV magnitude only — there is no directional
-- signal in the label itself. The new RegimeQueryResult.direction field
-- (derived from 25Δ RR) carries the directional read separately.
--
-- regime_models.state_labels is JSONB and isn't constrained at the DB level;
-- a defensive rewrite still helps the up-to-7-day window between deploy and
-- the next HMM refit when the in-memory state would otherwise hold legacy
-- strings. The application-level normalizeLegacyLabel() handles the same
-- case on load, so this UPDATE is belt-and-braces.

ALTER TABLE regime_observations DROP CONSTRAINT IF EXISTS regime_observations_dominant_check;

UPDATE regime_observations
SET dominant = CASE dominant
  WHEN 'bull' THEN 'low-vol'
  WHEN 'neutral' THEN 'mid-vol'
  WHEN 'stress' THEN 'high-vol'
  ELSE dominant
END
WHERE dominant IN ('bull', 'neutral', 'stress');

ALTER TABLE regime_observations
  ADD CONSTRAINT regime_observations_dominant_check
  CHECK (dominant IN ('low-vol', 'mid-vol', 'high-vol'));

UPDATE regime_models
SET state_labels = (
  SELECT jsonb_agg(
    CASE elem::text
      WHEN '"bull"'    THEN '"low-vol"'::jsonb
      WHEN '"neutral"' THEN '"mid-vol"'::jsonb
      WHEN '"stress"'  THEN '"high-vol"'::jsonb
      ELSE elem
    END
  )
  FROM jsonb_array_elements(state_labels) AS elem
)
WHERE state_labels::text ~ '"(bull|neutral|stress)"';
