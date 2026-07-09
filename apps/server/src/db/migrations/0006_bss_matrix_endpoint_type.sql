-- Promote the BSS "matrix" hack to a first-class endpoint type.
--
-- Before this change, a matrix crosspoint was just a bss-soundweb.fader device
-- row with type='matrix' as a side-channel marker (see the removed deviceKind()
-- switch in the old apps/ui/src/lib/devices.ts) — the UI had to know that
-- combination meant "invert the mute parameter and label it power". The driver
-- (packages/drivers/driver-bss) now exposes matrix crosspoints as their own
-- bss-soundweb.matrix endpoint type with canonical on/off commands and a
-- `power` state key; BssSoundwebDriver.ts does the on/off<->wire-parameter
-- mapping entirely on its own, so the UI never needs BSS-specific knowledge.
--
-- Idempotent: only rows still on the old convention match, so re-running this
-- migration (or running it against a database seeded after this change) is a
-- no-op.
UPDATE "devices"
SET
	"subtype" = 'bss-soundweb.matrix',
	"capabilities" = '["setLevel","on","off"]'::jsonb,
	"updated_at" = now()
WHERE "subtype" = 'bss-soundweb.fader' AND "type" = 'matrix';
