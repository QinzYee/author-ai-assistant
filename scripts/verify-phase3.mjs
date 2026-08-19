// Phase 3 compact 物化验证（mock 网关）
const base = 'http://127.0.0.1:3000';
let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};
async function api(path, init = {}) {
  const hasBody = init.body !== undefined && init.body !== null;
  const res = await fetch(base + path, { headers: hasBody ? { 'Content-Type': 'application/json' } : {}, ...init });
  return { status: res.status, body: await res.json() };
}
async function sseGen(novelId, nodeId) {
  const res = await fetch(`${base}/api/novels/${novelId}/writing/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outline_node_id: nodeId }),
  });
  const text = await res.text();
  const events = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5).trim()));
  const done = events.find((e) => e.type === 'done');
  return done?.scene?.id ?? null;
}

async function main() {
  let r = await api('/api/novels', { method: 'POST', body: JSON.stringify({ title: 'compact 测试' }) });
  const novelId = r.body.data.id;

  // 建 1 卷 1 章 6 个场景
  r = await api(`/api/novels/${novelId}/outline`, { method: 'POST', body: JSON.stringify({ level: 'volume', title: '第一卷' }) });
  const vol = r.body.data;
  r = await api(`/api/novels/${novelId}/outline`, { method: 'POST', body: JSON.stringify({ level: 'chapter', title: '第一章', parent_id: vol.id }) });
  const ch = r.body.data;
  const sceneIds = [];
  for (let i = 1; i <= 6; i++) {
    r = await api(`/api/novels/${novelId}/outline`, {
      method: 'POST',
      body: JSON.stringify({
        level: 'scene', title: `场景${i}`, parent_id: ch.id,
        content: { scene: `场景${i}`, time: `主线第${i}天`, location: '图书馆', characters: ['林晚(主角)', '沈砚(反派)'], goal: `目标${i}`, conflict: `冲突${i}`, result: `结果${i}` },
      }),
    });
    sceneIds.push(r.body.data.id);
  }
  // 预置人物资产
  await api(`/api/novels/${novelId}/assets`, { method: 'POST', body: JSON.stringify({ type: 'character', name: '林晚', core: { identity: '实习生', goal: '查明真相' } }) });
  await api(`/api/novels/${novelId}/assets`, { method: 'POST', body: JSON.stringify({ type: 'character', name: '沈砚', core: { identity: '馆长', goal: '复苏旧神' } }) });

  console.log('== 生成 6 个场景（含自动 compact） ==');
  let sawCompactStage = false;
  for (const id of sceneIds) {
    const res = await fetch(`${base}/api/novels/${novelId}/writing/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outline_node_id: id }),
    });
    const text = await res.text();
    const events = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5).trim()));
    if (events.some((e) => e.type === 'status' && e.stage === 'compact')) sawCompactStage = true;
  }
  // mock 短正文（~340字/场景×6≈12%）低于 85% 阈值 → 不应触发自动 compact（§7.2 设计行为）
  check('短正文(<85%)不触发自动 compact（设计正确）', sawCompactStage === false);

  console.log('== 记忆状态 ==');
  r = await api(`/api/novels/${novelId}/memory`);
  const mem = r.body.data;
  console.log(`  工作记忆: ${mem.workingTokens}/${mem.budget} (${(mem.usageRatio * 100).toFixed(1)}%)`);
  check('记忆状态接口正常', r.status === 200);
  check('低占用时无 compacted 场景', mem.compactedCount === 0, `compacted=${mem.compactedCount}, total=${mem.totalScenes}`);
  check('需求 compact 标志合理', typeof mem.needsCompact === 'boolean');

  r = await api(`/api/novels/${novelId}/scenes`);
  const scenes = r.body.data;
  const compacted = scenes.filter((s) => s.compacted);
  check('场景 compacted 标记正确', compacted.length === mem.compactedCount, `marked=${compacted.length}`);

  console.log('== 物化产物（L3） ==');
  r = await api(`/api/novels/${novelId}/facts`);
  const facts = r.body.data;
  check('事实卡片已物化', facts.length > 0, `count=${facts.length}`);
  r = await api(`/api/novels/${novelId}/assets`);
  const linWan = r.body.data.find((a) => a.name === '林晚');
  r = await api(`/api/novels/${novelId}/assets/${linWan.id}/states`);
  check('资产已写回物化（快照>0）', r.body.data.length > 0, `snapshots=${r.body.data.length}`);
  r = await api(`/api/novels/${novelId}/plotdevices`);
  check('伏笔已物化登记', r.body.data.length > 0, `devices=${r.body.data.length}`);
  r = await api(`/api/novels/${novelId}/chunks`);
  check('原文 chunk 仍在 L3（不删除）', r.body.data.length >= 6, `chunks=${r.body.data.length}`);

  console.log('== 手动 compact ==');
  r = await api(`/api/novels/${novelId}/memory/compact`, { method: 'POST', body: JSON.stringify({ count: 2 }) });
  check('手动 compact 执行', r.status === 200 && r.body.ok, `compacted=${r.body.data?.compacted?.length ?? 0}`);
  r = await api(`/api/novels/${novelId}/memory`);
  check('手动后 compacted 数量增加', r.body.data.compactedCount >= mem.compactedCount + 2, `now=${r.body.data.compactedCount}`);

  console.log(`\n结果: ${failures === 0 ? '全部通过 🎉' : `${failures} 项失败 ❌`}`);
  await new Promise((res) => setTimeout(res, 200));
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('异常:', e); process.exit(1); });
