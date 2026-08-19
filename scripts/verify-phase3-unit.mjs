// 单元验证：compact 物化 + 自动触发逻辑（直接调用模块，不经 HTTP/SSE）
import { openDatabase } from '../dist/server/server/db/connection.js';
import { migrate } from '../dist/server/server/db/schema.js';
import { createNovelRepository } from '../dist/server/server/db/repositories/novels.js';
import { createSceneRepository } from '../dist/server/server/db/repositories/scenes.js';
import { createSummaryRepository } from '../dist/server/server/db/repositories/summaries.js';
import { createOutlineRepository } from '../dist/server/server/db/repositories/outline.js';
import { createFactCardRepository } from '../dist/server/server/db/repositories/facts.js';
import { createPlotDeviceRepository } from '../dist/server/server/db/repositories/plotdevices.js';
import { createAssetRepository } from '../dist/server/server/db/repositories/assets.js';
import { createChunkRepository } from '../dist/server/server/db/repositories/chunks.js';
import { createKnowledgeService } from '../dist/server/server/modules/knowledge/index.js';
import { createMemoryService, L1_BUDGET_TOKENS, L1_COMPACT_THRESHOLD } from '../dist/server/server/modules/memory/index.js';
import { createMockGateway } from '../dist/server/server/llm/provider/mock.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const { db, vecLoaded } = openDatabase({ dataDir: './data' });
migrate(db);
const gateway = createMockGateway({ provider: 'mock', model: 'mock' });
const novels = createNovelRepository(db);
const scenes = createSceneRepository(db);
const summaries = createSummaryRepository(db);
const outline = createOutlineRepository(db);
const facts = createFactCardRepository(db);
const plotDevices = createPlotDeviceRepository(db);
const assets = createAssetRepository(db);
const chunks = createChunkRepository(db);
const knowledge = createKnowledgeService({ chunks, scenes, outline, assets, facts, gateway });
const memory = createMemoryService({ summaries, scenes, outline, facts, plotDevices, assets, knowledge, gateway });

const novel = novels.create({ title: '单元测试' });
const vol = outline.create({ novel_id: novel.id, level: 'volume', title: '第一卷' });
const ch = outline.create({ novel_id: novel.id, level: 'chapter', title: '第一章', parent_id: vol.id });
const nid = novel.id;

// 预置人物
assets.create({ novel_id: nid, type: 'character', name: '林晚', core: { identity: '实习生' } });
assets.create({ novel_id: nid, type: 'character', name: '沈砚', core: { identity: '馆长' } });

// 长正文（每场景 ~2000 字，5 个场景 = ~10K token，未超阈值）
const longBody = '林晚推开厚重的古籍书架，灰尘在昏光中飞舞。'.repeat(120);

console.log('== 1. 工作记忆估算 ==');
check('空库 workingTokens=0', memory.workingMemoryTokens(nid) === 0);
check('阈值常量合理', L1_COMPACT_THRESHOLD === 0.85 && L1_BUDGET_TOKENS === 16000);

console.log('== 2. 生成 5 个未 compact 场景 ==');
const sceneIds = [];
for (let i = 0; i < 5; i++) {
  const sc = scenes.create({ novel_id: nid, outline_node_id: ch.id, content: longBody });
  sceneIds.push(sc.id);
  await memory.summarizeScene(sc.id);
}
const used = memory.workingMemoryTokens(nid);
console.log(`  5 场景工作记忆 ≈ ${used} token（预算 ${L1_BUDGET_TOKENS}，阈值 ${L1_COMPACT_THRESHOLD * 100}%）`);
check('工作记忆>0', used > 0);

console.log('== 3. needsCompact 判断 ==');
const underThreshold = used / L1_BUDGET_TOKENS < L1_COMPACT_THRESHOLD;
check('5 场景未超阈值 → needsCompact=false', memory.needsCompact(nid) === false, `ratio=${(used / L1_BUDGET_TOKENS).toFixed(3)}`);

console.log('== 4. 手动 compact 2 个 ==');
const c1 = await memory.compact(nid, 2);
check('compact 返回 2 个 id', c1.compacted.length === 2, `ids=${c1.compacted.length}`);
const afterCompact = memory.workingMemoryTokens(nid);
check('compact 后工作记忆减少', afterCompact < used, `${used} → ${afterCompact}`);
const compactedIds = new Set(scenes.listForNovel(nid).filter((s) => s.compacted).map((s) => s.id));
check('compact 的 2 个场景均已 marked', c1.compacted.every((id) => compactedIds.has(id)));
check('marked 总数 = compacted 返回数', compactedIds.size === c1.compacted.length, `marked=${compactedIds.size}`);
check('其余场景未裁剪', scenes.listForNovel(nid).filter((s) => !s.compacted).length === sceneIds.length - c1.compacted.length);

console.log('== 5. 物化产物（L3） ==');
check('事实卡片已物化', facts.listActive(nid).length > 0, `facts=${facts.listActive(nid).length}`);
const linWan = assets.list(nid).find((a) => a.name === '林晚');
check('资产已写回（版本>1）', linWan.current_version > 1, `v=${linWan.current_version}`);
check('伏笔已登记', plotDevices.list(nid).length > 0, `devices=${plotDevices.list(nid).length}`);

console.log('== 6. 自动触发路径（直接调用 maybeAutoCompact） ==');
// 人为把预算调小场景不可行（常量），改用塞满场景逼近阈值
// 生成更多场景直到超阈值
let guard = 0;
while (!memory.needsCompact(nid) && guard < 100) {
  const sc = scenes.create({ novel_id: nid, outline_node_id: ch.id, content: longBody });
  await memory.summarizeScene(sc.id);
  guard++;
}
check('塞满后 needsCompact=true', memory.needsCompact(nid), `ratio=${(memory.workingMemoryTokens(nid) / L1_BUDGET_TOKENS).toFixed(3)}`);
const auto = await memory.maybeAutoCompact(nid, 3);
check('maybeAutoCompact 触发并裁剪', auto.did === true && auto.compacted.length > 0, `did=${auto.did}, count=${auto.compacted.length}`);
check('触发后工作记忆回落', memory.workingMemoryTokens(nid) < L1_BUDGET_TOKENS * L1_COMPACT_THRESHOLD);

console.log('== 7. L2 摘要树 ==');
check('场景摘要存在', summaries.listForNovel(nid).filter((s) => s.level === 'scene').length > 0);

console.log(`\n结果: ${failures === 0 ? '全部通过 🎉' : `${failures} 项失败 ❌`}`);
db.close();
process.exit(failures === 0 ? 0 : 1);
