import { childLogger } from '../logger.js';
import { query, tx } from './index.js';

const log = childLogger('seed');

export async function runSeedIfEmpty(): Promise<void> {
  const r = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM rooms`);
  if (r.rows[0].n > 0) return;
  log.info('Empty database — running demo seed');

  await tx(async (client) => {
    const roomRes = await client.query(
      `INSERT INTO rooms (name, description, icon, color, display_order)
       VALUES ('Sál A', 'Demo lecture hall', 'building', '#3B82F6', 0) RETURNING *`
    );
    const room = roomRes.rows[0];

    const connRes = await client.query(
      `INSERT INTO connections (name, driver_id, host, port, protocol, config, enabled)
       VALUES ('Demo TCP', 'tcp-generic', '127.0.0.1', 9999, 'tcp', '{"lineTerminator":"\\n"}'::jsonb, TRUE)
       RETURNING *`
    );
    const conn = connRes.rows[0];

    const deviceRes = await client.query(
      `INSERT INTO devices (connection_id, room_id, name, type, subtype, address, capabilities, icon)
       VALUES ($1, $2, 'Demo Light', 'lighting', 'tcp-generic.endpoint',
               '{"sendString":"DIM {level}","onString":"ON","offString":"OFF"}'::jsonb,
               '["setLevel","on","off"]'::jsonb, 'bulb')
       RETURNING *`,
      [conn.id, room.id]
    );
    const device = deviceRes.rows[0];

    const sceneRes = await client.query(
      `INSERT INTO scenes (room_id, name, description, icon, color, is_favorite, tags)
       VALUES ($1, 'Demo Scéna', 'Sample two-step scene', 'sparkles', '#10B981', TRUE, '{"demo"}')
       RETURNING *`,
      [room.id]
    );
    const scene = sceneRes.rows[0];

    await client.query(
      `INSERT INTO scene_actions (scene_id, device_id, step_order, parallel_group, delay_ms, command, params, on_failure)
       VALUES ($1, $2, 0, 0, 0, 'on', '{}'::jsonb, 'continue'),
              ($1, $2, 1, 1, 500, 'setLevel', '{"level":0.6}'::jsonb, 'continue')`,
      [scene.id, device.id]
    );

    await client.query(
      `INSERT INTO ui_layouts (name, is_default, config)
       VALUES ('Default', TRUE, $1::jsonb)`,
      [
        JSON.stringify({
          pages: [
            {
              id: 'home',
              name: 'Sál A',
              icon: 'building',
              widgets: [
                { type: 'room_header', label: 'Sál A' },
                { type: 'scene_button', scene_id: scene.id, size: 'large' },
                { type: 'device_slider', device_id: device.id },
                { type: 'device_status', device_id: device.id },
                { type: 'favorites_row' },
              ],
            },
          ],
        }),
      ]
    );
  });

  log.info('Seed complete');
}
