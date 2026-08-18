import type { AssetRepository } from '../../db/repositories/assets.js';
import type { AssetInput, AssetWriteBack } from '../../../shared/index.js';

export interface AssetServiceDeps {
  repo: AssetRepository;
}

/** 资产服务：CRUD + 版本化写回（§9.2）的高层封装 */
export function createAssetService(deps: AssetServiceDeps) {
  const { repo } = deps;

  return {
    list(novelId: string, type?: string) {
      return repo.list(novelId, type as never);
    },
    get(id: string) {
      return repo.get(id);
    },
    create(novelId: string, input: AssetInput) {
      return repo.create({ novel_id: novelId, ...input });
    },
    update(id: string, patch: Partial<AssetInput>) {
      return repo.update(id, patch);
    },
    /** 写回：版本 +1 + 快照（§9.2），可选同步更新 core/extended */
    writeBack(id: string, writeBack: AssetWriteBack) {
      const asset = repo.get(id);
      if (!asset) return null;
      if (writeBack.patch) repo.update(id, writeBack.patch);
      return repo.writeBack(id, writeBack.state, writeBack.source_scene_id ?? null);
    },
    getStateHistory(id: string) {
      return repo.getStateHistory(id);
    },
    getStateAtVersion(id: string, version: number) {
      return repo.getStateAtVersion(id, version);
    },
    remove(id: string) {
      return repo.remove(id);
    },
    relations(novelId: string) {
      return repo.listRelations(novelId);
    },
    addRelation(input: { novel_id: string; from_asset: string; to_asset: string; relation_type: string; description?: string | null }) {
      return repo.addRelation(input);
    },
  };
}

export type AssetService = ReturnType<typeof createAssetService>;
