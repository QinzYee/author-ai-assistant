import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Asset, AssetState, AssetType, AssetRelation } from '../../../shared/index.js';

export interface NewAsset {
  novel_id: string;
  type: AssetType;
  name: string;
  core?: Record<string, unknown>;
  extended?: Record<string, unknown> | null;
  summary?: string | null;
  batch_label?: string | null;
}

interface AssetRow {
  id: string;
  novel_id: string;
  type: AssetType;
  name: string;
  core: string;
  extended: string | null;
  summary: string | null;
  batch_label: string | null;
  current_version: number;
  created_at: string;
  updated_at: string;
}

interface AssetStateRow {
  id: string;
  asset_id: string;
  version: number;
  state: string;
  source_scene_id: string | null;
  created_at: string;
}

interface RelationRow {
  id: string;
  novel_id: string;
  from_asset: string;
  to_asset: string;
  relation_type: string;
  description: string | null;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    novel_id: row.novel_id,
    type: row.type,
    name: row.name,
    core: parseJson(row.core, {}),
    extended: row.extended ? parseJson(row.extended, {}) : null,
    summary: row.summary,
    batch_label: row.batch_label ?? null,
    current_version: row.current_version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toState(row: AssetStateRow): AssetState {
  return {
    id: row.id,
    asset_id: row.asset_id,
    version: row.version,
    state: parseJson(row.state, {}),
    source_scene_id: row.source_scene_id,
    created_at: row.created_at,
  };
}

function toRelation(row: RelationRow): AssetRelation {
  return {
    id: row.id,
    novel_id: row.novel_id,
    from_asset: row.from_asset,
    to_asset: row.to_asset,
    relation_type: row.relation_type,
    description: row.description,
  };
}

export interface AssetRepository {
  list(novelId: string, type?: AssetType): Asset[];
  get(id: string): Asset | null;
  create(input: NewAsset): Asset;
  update(id: string, patch: Partial<NewAsset>): Asset | null;
  /** 写回：版本 +1，快照入 asset_states（§9.2） */
  writeBack(id: string, state: Record<string, unknown>, sourceSceneId?: string | null): Asset | null;
  getStateHistory(assetId: string): AssetState[];
  /** 时间旅行：返回 <= version 的最新快照（§9.2） */
  getStateAtVersion(assetId: string, version: number): AssetState | null;
  remove(id: string): boolean;
  listRelations(novelId: string): AssetRelation[];
  addRelation(input: { novel_id: string; from_asset: string; to_asset: string; relation_type: string; description?: string | null }): AssetRelation;
}

export function createAssetRepository(db: Database.Database): AssetRepository {
  const stmtList = db.prepare(
    'SELECT * FROM assets WHERE novel_id = ?' + ' ORDER BY type, name'
  );
  const stmtListByType = db.prepare(
    'SELECT * FROM assets WHERE novel_id = ? AND type = ? ORDER BY name'
  );
  const stmtGet = db.prepare('SELECT * FROM assets WHERE id = ?');
  const stmtInsert = db.prepare(
    `INSERT INTO assets (id, novel_id, type, name, core, extended, summary, batch_label, current_version)
     VALUES (@id, @novel_id, @type, @name, @core, @extended, @summary, @batch_label, 1)`
  );
  const stmtUpdate = db.prepare(
    `UPDATE assets SET type = COALESCE(@type, type), name = COALESCE(@name, name),
       core = COALESCE(@core, core), extended = COALESCE(@extended, extended),
       summary = COALESCE(@summary, summary), batch_label = COALESCE(@batch_label, batch_label),
       updated_at = datetime('now')
     WHERE id = @id`
  );
  const stmtBumpVersion = db.prepare('UPDATE assets SET current_version = ?, updated_at = datetime(\'now\') WHERE id = ?');
  const stmtInsertState = db.prepare(
    `INSERT INTO asset_states (id, asset_id, version, state, source_scene_id)
     VALUES (@id, @asset_id, @version, @state, @source_scene_id)`
  );
  const stmtStates = db.prepare('SELECT * FROM asset_states WHERE asset_id = ? ORDER BY version ASC');
  const stmtStateAt = db.prepare(
    'SELECT * FROM asset_states WHERE asset_id = ? AND version <= ? ORDER BY version DESC LIMIT 1'
  );
  const stmtDelete = db.prepare('DELETE FROM assets WHERE id = ?');
  const stmtRelations = db.prepare('SELECT * FROM asset_relations WHERE novel_id = ?');
  const stmtInsertRelation = db.prepare(
    `INSERT INTO asset_relations (id, novel_id, from_asset, to_asset, relation_type, description)
     VALUES (@id, @novel_id, @from_asset, @to_asset, @relation_type, @description)`
  );

  return {
    list(novelId, type) {
      const rows = type ? (stmtListByType.all(novelId, type) as AssetRow[]) : (stmtList.all(novelId) as AssetRow[]);
      return rows.map(toAsset);
    },
    get(id) {
      const row = stmtGet.get(id) as AssetRow | undefined;
      return row ? toAsset(row) : null;
    },
    create(input) {
      const asset: AssetRow = {
        id: randomUUID(),
        novel_id: input.novel_id,
        type: input.type,
        name: input.name,
        core: JSON.stringify(input.core ?? {}),
        extended: input.extended ? JSON.stringify(input.extended) : null,
        summary: input.summary ?? null,
        batch_label: input.batch_label ?? null,
        current_version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      stmtInsert.run(asset);
      return toAsset(asset);
    },
    update(id, patch) {
      const current = stmtGet.get(id) as AssetRow | undefined;
      if (!current) return null;
      const merged: Record<string, unknown> = {
        id,
        type: patch.type ?? current.type,
        name: patch.name ?? current.name,
        core: patch.core !== undefined ? JSON.stringify(patch.core) : current.core,
        extended: patch.extended !== undefined ? (patch.extended ? JSON.stringify(patch.extended) : null) : current.extended,
        summary: patch.summary !== undefined ? patch.summary : current.summary,
        batch_label: patch.batch_label !== undefined ? patch.batch_label : current.batch_label,
      };
      stmtUpdate.run(merged);
      return this.get(id);
    },
    writeBack(id, state, sourceSceneId = null) {
      const current = stmtGet.get(id) as AssetRow | undefined;
      if (!current) return null;
      const newVersion = current.current_version + 1;
      const run = db.transaction(() => {
        stmtInsertState.run({
          id: randomUUID(),
          asset_id: id,
          version: newVersion,
          state: JSON.stringify(state),
          source_scene_id: sourceSceneId,
        });
        stmtBumpVersion.run(newVersion, id);
      });
      run();
      return this.get(id);
    },
    getStateHistory(assetId) {
      return (stmtStates.all(assetId) as AssetStateRow[]).map(toState);
    },
    getStateAtVersion(assetId, version) {
      const row = stmtStateAt.get(assetId, version) as AssetStateRow | undefined;
      return row ? toState(row) : null;
    },
    remove(id) {
      return stmtDelete.run(id).changes > 0;
    },
    listRelations(novelId) {
      return (stmtRelations.all(novelId) as RelationRow[]).map(toRelation);
    },
    addRelation(input) {
      const row: RelationRow = {
        id: randomUUID(),
        novel_id: input.novel_id,
        from_asset: input.from_asset,
        to_asset: input.to_asset,
        relation_type: input.relation_type,
        description: input.description ?? null,
      };
      stmtInsertRelation.run(row);
      return toRelation(row);
    },
  };
}
