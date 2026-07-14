-- Data migration for the workflow_targets split: each existing trigger_actions
-- row owned its own target/command/params directly (pre-redesign). Give each
-- one its own new workflow_targets instance (no dedup — two old rows that
-- happened to share a target become two independent instances, matching the
-- new model where instances are independent unless the admin explicitly wires
-- more than one trigger to the same one) and backfill the new FK.
DO $$
DECLARE
  r RECORD;
  new_target_id UUID;
BEGIN
  FOR r IN SELECT * FROM trigger_actions WHERE target_id IS NOT NULL LOOP
    INSERT INTO workflow_targets (target_type, target_id, target_command, params, position)
    VALUES (r.target_type, r.target_id, r.target_command, r.params, '{"x": 0, "y": 0}'::jsonb)
    RETURNING id INTO new_target_id;

    UPDATE trigger_actions SET workflow_target_id = new_target_id WHERE id = r.id;
  END LOOP;
END $$;
--> statement-breakpoint
-- A row with no target_id was already unwired (a legacy state the canvas can
-- no longer produce) and has nothing to migrate into.
DELETE FROM trigger_actions WHERE workflow_target_id IS NULL;
