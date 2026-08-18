// Mock provider —— 仅开发/演示用：无 API Key 时返回确定性结果，便于全链路验证。
// 通过 GATEWAY_MODE=mock 启用（不推荐生产使用）。
import type {
  GenerateRequest,
  ExtractRequest,
  StructuredResult,
  Chunk,
  ProviderConfig,
} from '../types.js';

export interface MockGateway {
  generate(req: GenerateRequest): AsyncIterable<Chunk>;
  extract(req: ExtractRequest): Promise<StructuredResult>;
  embed(texts: string[], model?: string): Promise<number[][]>;
}

function mockExtractResult(req: ExtractRequest): unknown {
  const text = `${req.system ?? ''}\n${req.user}`;
  // 顺序重要：先匹配唯一角色标记（更具体），再匹配内容特征。
  if (/题材分析师/.test(text) || /调研|热度榜单/.test(text)) {
    return {
      heat_ranking: [
        { genre: '都市仙侠', trend: '上升（系统流+中式克苏鲁）' },
        { genre: '克苏鲁+修仙', trend: '蓝海（融合热度）' },
        { genre: '都市职场+奇幻', trend: '稳定' },
      ],
      reader_profiles: ['男频 18-30 岁，追求升级感与世界观新奇度'],
      core_pleasure_points: ['升级感', '悬念', '世界观新奇度'],
      blue_ocean_ideas: ['中式克苏鲁 + 都市职场：旧神苏醒，社畜觉醒'],
      golden_three_chapters: ['第一章亮出金手指+威胁', '第二章卷入冲突', '第三章抛出长线悬念'],
      recommendation: '推荐「中式克苏鲁 + 都市职场」差异化组合，前 3 章即亮出世界观奇观。',
    };
  }
  if (/世界观架构师/.test(text)) {
    return [
      { name: '借名之力', rule: '凡知晓真名者，可借用其部分权柄，代价是承担其注视', extended: '真名不可轻传，知晓真名者互为猎手' },
      { name: '旧神复苏', rule: '封印于 2024 年冬至出现裂缝，旧神逐步苏醒', extended: '复苏按：梦→影→名→形 四阶段' },
      { name: '城市结界', rule: '闹市区存在微弱结界，压制神性显现', extended: '工业区与旧城区结界薄弱' },
    ];
  }
  if (/人物设定师/.test(text)) {
    return [
      { name: '林晚', role: '主角', identity: '广告公司实习生', personality: '外冷内热，善于伪装', goal: '查明身世与残卷真相', motivation: '母亲的失踪与旧神有关', arc: '从普通人成长为旧神时代的关键平衡者', state: '左臂旧伤未愈（第2章划伤）', location: '市立图书馆' },
      { name: '沈砚', role: '反派', identity: '图书馆馆长/旧神信徒', personality: '温和外表下的偏执', goal: '促成旧神完全复苏', motivation: '相信旧神能修复世界', arc: '从伪装者到被旧神反噬', location: '市立图书馆' },
    ];
  }
  if (/长篇小说结构师/.test(text)) {
    return [
      { title: '第一卷：借名者', goal: '林晚获得借名之力并卷入旧神事件', turning_point: '发现沈砚的真实身份', suspense: '残卷来源', ending_hook: '旧神在冬至夜向城市投下注视' },
    ];
  }
  if (/章回体作者/.test(text)) {
    return [
      { title: '第一章 会上的符号', pov: '林晚', goal: '引入主角与金手指', conflict: '年会偶遇符号与旧神低语', ending_hook: '发现自己能听见「真名」' },
      { title: '第二章 图书馆之夜', pov: '林晚', goal: '初探旧神线索', conflict: '图书馆闭馆后的诡异动静', ending_hook: '左臂受伤，发现半页残卷' },
      { title: '第三章 沈砚的邀请', pov: '林晚', goal: '接近真相', conflict: '沈砚的试探与威胁', ending_hook: '残卷符号与林晚身世有关' },
    ];
  }
  if (/场景分镜师/.test(text)) {
    return [
      {
        scene: '场景1：年会散场后的走廊',
        time: '主线第1天 22:10',
        location: '公司宴会厅走廊',
        characters: ['林晚(主角)'],
        goal: '林晚偶然发现墙上的神秘符号并听到低语',
        conflict: '低语中夹杂自己的名字，恐惧与好奇交织',
        result: '林晚离开时藏起一张画着符号的纸巾（伏笔：符号）',
        info_revealed: ['符号与「借名」有关', '林晚能听懂别人听不懂的低语'],
        foreshadowing: ['埋设：符号是旧神印记'],
        continuity_notes: '',
      },
      {
        scene: '场景2：旧城区书店',
        time: '主线第2天 19:30',
        location: '旧城区·无名书店',
        characters: ['林晚(主角)', '神秘店主(配角)'],
        goal: '林晚借书溯源符号，结识神秘店主',
        conflict: '店主似乎知道太多，又不肯明说',
        result: '林晚获得一本夹着残页的旧书（伏笔：残页）',
        info_revealed: ['旧书店与旧神有千丝万缕的联系'],
        foreshadowing: ['发展：残页上的符号与年会符号一致'],
        continuity_notes: '林晚左臂尚未受伤',
      },
    ];
  }
  if (/资深网文结构师/.test(text)) {
    return {
      title: '旧神之城的借名者',
      three_acts: ['第一幕：普通社畜卷入旧神事件，获得借名之力', '第二幕：追查身世与残卷，与沈砚正面交锋', '第三幕：旧神冬至复苏，林晚抉择平衡'],
      theme: '在神性与人性之间，普通人如何守住自我',
    };
  }
  if (/生成「核心创意」/.test(text)) {
    return {
      high_concept: '旧神苏醒的城市里，一个普通社畜获得「借名」之力，在职场与神话之间周旋。',
      target_reader: '18-30 岁网文读者，偏好都市+克苏鲁+职场题材',
      selling_points: ['世界观新奇（克苏鲁+职场）', '主角身份反转', '爽点与恐怖交织'],
      logline: '当公司年会上的神秘符号对应上古旧神，实习生林晚发现自己竟能「借名」于神。',
    };
  }
  // 通用兜底
  return { ok: true, result: 'mock' };
}

export function createMockGateway(_cfg: ProviderConfig): MockGateway {
  return {
    async *generate(req: GenerateRequest) {
      const last = req.messages[req.messages.length - 1];
      const text = typeof last?.content === 'string' ? last.content : '';
      for (const chunk of text.match(/.{1,8}/g) ?? []) {
        yield { type: 'text', text: chunk };
      }
      yield { type: 'done' };
    },
    async extract(req: ExtractRequest): Promise<StructuredResult> {
      return { json: mockExtractResult(req) };
    },
    async embed(texts: string[]): Promise<number[][]> {
      // 确定性伪向量（hash 到 [-1,1]），仅用于演示 RAG 流程
      return texts.map((t) => {
        let seed = 0;
        for (let i = 0; i < t.length; i++) seed = (seed * 31 + t.charCodeAt(i)) >>> 0;
        const arr: number[] = [];
        for (let i = 0; i < 1024; i++) {
          seed = (seed * 1103515245 + 12345) >>> 0;
          arr.push(((seed / 0xffffffff) * 2 - 1) * 0.5);
        }
        return arr;
      });
    },
  };
}
