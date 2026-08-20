// 冒烟测试：验证“设置保存 / 测试连接”修复（不依赖运行中的服务器）
// 用法：node scripts/smoke-settings.mjs
import Database from 'better-sqlite3';
import { createSettingsRepository } from '../dist/server/server/db/repositories/settings.js';
import { createSettingsService } from '../dist/server/server/modules/settings/index.js';

// 1) 内存 DB + 建表
const db = new Database(':memory:');
db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now'))
);`);

const repo = createSettingsRepository(db);
const env = { DEEPSEEK_API_KEY: 'sk-env-deepseek' };
const svc = createSettingsService({ repo, env });

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

// 2) 前端确实发送 DB key（模拟 SettingsPage 的 draft）
console.log('\n[1] 保存：前端发送 DB key（旧代码会静默丢弃）');
const saved = svc.save({
  CHAT_PROVIDER: 'minimax',
  MINIMAX_API_KEY: 'sk-minimax-abc123',
  MINIMAX_MODEL: 'MiniMax-Text-01',
  EMBED_PROVIDER: 'siliconflow',
});
check('DB 中 CHAT_PROVIDER = minimax', repo.get('CHAT_PROVIDER') === 'minimax');
check('DB 中 MINIMAX_API_KEY 已持久化', repo.get('MINIMAX_API_KEY') === 'sk-minimax-abc123');
check('DB 中 MINIMAX_MODEL 已持久化', repo.get('MINIMAX_MODEL') === 'MiniMax-Text-01');
check('DB 中 EMBED_PROVIDER = siliconflow', repo.get('EMBED_PROVIDER') === 'siliconflow');
check('保存后返回的 values 脱敏', saved.values['MINIMAX_API_KEY'] === 'sk-***c123', `实际=${saved.values['MINIMAX_API_KEY']}`);

// 3) 保存后 getConfig 应该用 minimax
const cfg = svc.getConfig();
check('生效 provider = minimax', cfg.generate.provider === 'minimax', `实际=${cfg.generate.provider}`);
check('生效 apiKey = minimax key', cfg.generate.apiKey === 'sk-minimax-abc123', `实际=${cfg.generate.apiKey}`);
check('生效 model = MiniMax-Text-01', cfg.generate.model === 'MiniMax-Text-01', `实际=${cfg.generate.model}`);

// 4) camelCase 字段名（文档约定）也兼容
console.log('\n[2] 兼容 camelCase 字段名（文档约定）');
svc.save({ chatProvider: 'deepseek', deepseekApiKey: 'sk-ds-999' });
check('camelCase chatProvider 生效', repo.get('CHAT_PROVIDER') === 'deepseek');
check('camelCase deepseekApiKey 生效', repo.get('DEEPSEEK_API_KEY') === 'sk-ds-999');

// 5) 空字符串清除（回退 env）
console.log('\n[3] 空字符串清除项（回退 env）');
svc.save({ deepseekApiKey: '' });
check('清空后 DB 中 DEEPSEEK_API_KEY 为 null', repo.get('DEEPSEEK_API_KEY') === null);
check('清空后回退 env 值', svc.getConfig().generate.apiKey === 'sk-env-deepseek', `实际=${svc.getConfig().generate.apiKey}`);

// 6) testConnection 接受前端草稿（未保存的当前屏幕配置），不落库
console.log('\n[4] 测试连接：接受前端草稿 payload，仅本次生效、不落库');
const draft = { CHAT_PROVIDER: 'minimax', MINIMAX_API_KEY: 'sk-minimax-abc123' };
// 用不存在的 baseUrl 快速验证它“真会按 minimax 去测”，而不是回退 deepseek
const results = await svc.testConnection({ ...draft, MINIMAX_BASE_URL: 'http://127.0.0.1:9' });
const gen = results.find((r) => r.tier === 'generate');
check('测试 generate provider = minimax', gen?.provider === 'minimax', `实际=${gen?.provider}`);
check('测试未写库（DB CHAT_PROVIDER 仍是 deepseek）', repo.get('CHAT_PROVIDER') === 'deepseek');

// 7) 无 payload 时测当前已生效配置
console.log('\n[5] 无 payload：测当前已生效配置');
const cfg2 = svc.getConfig();
check('无 payload 时 provider = deepseek', cfg2.generate.provider === 'deepseek', `实际=${cfg2.generate.provider}`);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
