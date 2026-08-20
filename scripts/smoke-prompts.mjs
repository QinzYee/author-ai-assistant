// 冒烟测试：提示词管理（默认读取 / 覆盖保存 / 恢复默认 / 模块引用）
import Database from 'better-sqlite3';
import { createSettingsRepository } from '../dist/server/server/db/repositories/settings.js';
import { createPromptsService } from '../dist/server/server/modules/prompts/index.js';

const db = new Database(':memory:');
db.exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')));`);
const repo = createSettingsRepository(db);
const prompts = createPromptsService({ repo });

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

// 1) 默认值
console.log('\n[1] 默认值读取');
const all = prompts.all();
check('共 19 条提示词', all.length === 19, `实际=${all.length}`);
check('正文生成基础含「快餐爽文」', prompts.get('PROMPT_WRITING_BASE').includes('快餐爽文'));
check('爽点指南含「人前显圣」', prompts.get('PROMPT_WRITING_RULES').includes('人前显圣'));
check('默认 source=default', all[0].source === 'default');
check('全部 key 都有默认值（非空）', all.every((p) => p.value.trim().length > 0));

// 2) 覆盖保存
console.log('\n[2] 覆盖保存');
const updated = prompts.save({ PROMPT_WRITING_RULES: '【自定义爽点】只写人前显圣。', PROMPT_OUTLINE_IDEA: '自定义创意提示词' });
check('保存后返回更新列表', updated.length === 19);
check('DB 已持久化', repo.get('PROMPT_WRITING_RULES') === '【自定义爽点】只写人前显圣。');
check('get 返回覆盖值', prompts.get('PROMPT_WRITING_RULES') === '【自定义爽点】只写人前显圣。');
check('source 变 db', prompts.all().find((p) => p.key === 'PROMPT_WRITING_RULES')?.source === 'db');

// 3) 恢复默认（空字符串）
console.log('\n[3] 恢复默认');
prompts.save({ PROMPT_WRITING_RULES: '' });
check('清空后恢复默认', prompts.get('PROMPT_WRITING_RULES').includes('爽点指南'));
check('DB 中已删除', repo.get('PROMPT_WRITING_RULES') === null);

// 4) 摘要占位符 {kind}
console.log('\n[4] 摘要 {kind} 占位');
const sum = prompts.get('PROMPT_MEMORY_SUMMARY', { kind: '场景正文' });
check('占位符被替换', sum.includes('场景正文') && !sum.includes('{kind}'), `实际=${sum.slice(0, 40)}`);

// 5) 未知 key 被拒绝
console.log('\n[5] 未知 key 拒绝');
const before = prompts.all().length;
prompts.save({ PROMPT_UNKNOWN_X: 'hack', 'PROMPT_WRITING_BASE': '' });
check('未知 key 不入库', repo.get('PROMPT_UNKNOWN_X') === null);
check('空串恢复默认后总数不变', prompts.all().length === before);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
