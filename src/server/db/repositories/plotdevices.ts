import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { PlotDevice, PlotDeviceStatus, PlotDeviceType } from '../../../shared/index.js';

export interface NewPlotDevice {
  novel_id: string;
  type: PlotDeviceType;
  description: string;
  status?: PlotDeviceStatus;
  planted_scene_id?: string | null;
  expected_payoff?: string | null;
  related_entities?: string[];
  notes?: string | null;
}

interface PlotRow {
  id: string;
  novel_id: string;
  type: PlotDeviceType;
  description: string;
  status: PlotDeviceStatus;
  planted_scene_id: string | null;
  expected_payoff: string | null;
  related_entities: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toDevice(row: PlotRow): PlotDevice {
  return {
    id: row.id,
    novel_id: row.novel_id,
    type: row.type,
    description: row.description,
    status: row.status,
    planted_scene_id: row.planted_scene_id,
    expected_payoff: row.expected_payoff,
    related_entities: row.related_entities ? JSON.parse(row.related_entities) : [],
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface PlotDeviceRepository {
  create(input: NewPlotDevice): PlotDevice;
  list(novelId: string): PlotDevice[];
  listByStatus(novelId: string, status: PlotDeviceStatus): PlotDevice[];
  listDue(novelId: string): PlotDevice[]; // planted/developing 待处理
  updateStatus(id: string, status: PlotDeviceStatus): PlotDevice | null;
  findSimilar(novelId: string, description: string): PlotDevice | null;
}

export function createPlotDeviceRepository(db: Database.Database): PlotDeviceRepository {
  const stmtInsert = db.prepare(
    `INSERT INTO plot_devices (id, novel_id, type, description, status, planted_scene_id, expected_payoff, related_entities, notes)
     VALUES (@id, @novel_id, @type, @description, @status, @planted_scene_id, @expected_payoff, @related_entities, @notes)`
  );
  const stmtGet = db.prepare('SELECT * FROM plot_devices WHERE id = ?');
  const stmtList = db.prepare('SELECT * FROM plot_devices WHERE novel_id = ? ORDER BY created_at ASC');
  const stmtByStatus = db.prepare('SELECT * FROM plot_devices WHERE novel_id = ? AND status = ? ORDER BY created_at ASC');
  const stmtDue = db.prepare(
    "SELECT * FROM plot_devices WHERE novel_id = ? AND status IN ('planted','developing') ORDER BY created_at ASC"
  );
  const stmtUpdateStatus = db.prepare(
    "UPDATE plot_devices SET status = @status, updated_at = datetime('now') WHERE id = @id"
  );
  const stmtSimilar = db.prepare(
    'SELECT * FROM plot_devices WHERE novel_id = ? AND description = ? LIMIT 1'
  );

  return {
    create(input) {
      const row: PlotRow = {
        id: randomUUID(),
        novel_id: input.novel_id,
        type: input.type,
        description: input.description,
        status: input.status ?? 'planted',
        planted_scene_id: input.planted_scene_id ?? null,
        expected_payoff: input.expected_payoff ?? null,
        related_entities: input.related_entities ? JSON.stringify(input.related_entities) : null,
        notes: input.notes ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      stmtInsert.run(row);
      return toDevice(row);
    },
    list(novelId) {
      return (stmtList.all(novelId) as PlotRow[]).map(toDevice);
    },
    listByStatus(novelId, status) {
      return (stmtByStatus.all(novelId, status) as PlotRow[]).map(toDevice);
    },
    listDue(novelId) {
      return (stmtDue.all(novelId) as PlotRow[]).map(toDevice);
    },
    updateStatus(id, status) {
      const current = stmtGet.get(id) as PlotRow | undefined;
      if (!current) return null;
      stmtUpdateStatus.run({ id, status });
      const row = stmtGet.get(id) as PlotRow;
      return toDevice(row);
    },
    findSimilar(novelId, description) {
      const row = stmtSimilar.get(novelId, description) as PlotRow | undefined;
      return row ? toDevice(row) : null;
    },
  };
}
