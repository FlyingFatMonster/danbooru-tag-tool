/* 模型提示词配置 —— MODEL_PROFILES
 *
 * 架构（GPT 2026-10-23 建议）：
 *   categoryV2   → 界面分组（本次先不动，仍用 15 字段）
 *   promptRole   → 组装顺序（lib/roles.js 里的 TAG_ROLE）
 *   MODEL_PROFILES → 每个模型的顺序 / 前后缀 / 长度的差异（本文件）
 *
 * 设计原则：
 *   ① 顺序可回退 —— 界面上永远保留「旧版顺序」「保持用户选择顺序」
 *   ② 按模型配置，不全局覆盖
 *   ③ 只有官方有明确建议的才写死（Pony 的 score 前缀、Animagine 的质量词尾置）
 *   ④ Illustrious / NoobAI 系用保守默认，不伪造没有数据支撑的差异
 *
 * role 取值见 lib/roles.js 的 ROLES
 */
(function () {
  // ── 默认顺序（Danbooru 系，适用于 Illustrious / NoobAI / SDXL 通用）──
  //  ★ 2026-10-24 加入 character / copyright：
  //    GPT 的建议是「角色 → 作品」紧跟在人数/身份之后，
  //    因为对动漫模型来说，角色名是主体骨架，应该早于外貌服饰。
  //    Animagine 官方还要求「角色名后紧跟作品名」，所以两个顺序里它们都相邻。
  var DEFAULT_ORDER = [
    'score', 'source', 'rating', 'quality',
    'subject_count', 'character', 'copyright', 'species_job',
    'appearance', 'hair', 'eyes', 'expression',
    'clothing', 'accessory',
    'interaction', 'pose', 'body_state',
    'object', 'environment', 'time_weather',
    'composition', 'lighting', 'style'
  ];

  // ── Animagine 顺序：质量词放尾部（官方指南明确要求）──
  var ANIMAGINE_ORDER = [
    'subject_count', 'character', 'copyright', 'species_job',
    'appearance', 'hair', 'eyes', 'expression',
    'clothing', 'accessory',
    'interaction', 'pose', 'body_state',
    'object', 'environment', 'time_weather',
    'composition', 'lighting', 'style',
    'rating', 'quality', 'score', 'source'
  ];

  // ── 旧版顺序（15 字段原始顺序，用于回退）──
  //   角色/作品是新增分类，旧版顺序里没有对应字段，
  //   所以放在人数角色之后（和真实使用习惯一致）
  var LEGACY_ORDER = [
    'quality', 'composition', 'subject_count', 'character', 'copyright',
    'clothing', 'expression',
    'hair', 'eyes', 'appearance', 'pose', 'interaction', 'body_state',
    'object', 'environment', 'lighting', 'time_weather', 'style'
  ];

  // ── 负向顺序：按「要阻止的问题」的重要性排 ──
  //  ★ 2026-10-24 正式接入：原来这个常量定义了但引擎完全没用（GPT 指出）。
  //    现在 app.js 的 build() 会把负向来源分成 6 层，按 tier 排序后合并：
  //      0 模型固定负向（score_6 / low score / standard …）
  //      1 画质与打码
  //      2 解剖与手脚
  //      3 文字水印
  //      4 用户主动排除（负向勾选）
  //      5 保护开关产生的词（放最后，最可能被用户手动删）
  var NEG_ORDER = [
    'quality', 'body_state', 'object', 'composition', 'clothing',
    'expression', 'eyes', 'hair', 'appearance', 'pose',
    'interaction', 'environment', 'time_weather', 'lighting', 'style'
  ];
  var NEG_TIERS = {
    modelFixed: 0, quality: 1, anatomy: 2, text: 3, userNeg: 4, protection: 5
  };

  var PROFILES = {
    // ══════════════════════════════════════════════════════════
    //  Pony V6 —— score 前缀放最前
    // ══════════════════════════════════════════════════════════
    'Pony V6': {
      group: 'pony',
      order: ['score', 'source', 'rating', 'quality'].concat(DEFAULT_ORDER.slice(4)),
      qualityPlacement: 'head',
      note: 'score 系列放最前。质量词本身来自 models.json 的 pos 字段，这里只控制位置'
    },

    // ══════════════════════════════════════════════════════════
    //  Animagine —— 质量词放尾部（官方指南要求）
    // ══════════════════════════════════════════════════════════
    'Animagine-XL 4.0 Opt': {
      group: 'animagine',
      order: ANIMAGINE_ORDER,
      qualityPlacement: 'tail',
      note: '官方指南：质量词训练时不在前部，放开头会干扰概念/艺术家标签。' +
            '质量词来自 models.json 的 pos，这里只把它挪到尾部'
    },
    'Animagine-XL 3.1': {
      group: 'animagine',
      order: ANIMAGINE_ORDER,
      qualityPlacement: 'tail',
      note: '同 4.0，质量词尾置'
    },

    // ══════════════════════════════════════════════════════════
    //  SD1.5 系 —— 关键是长度预算
    // ══════════════════════════════════════════════════════════
    'Anything V5': {
      group: 'sd15',
      order: DEFAULT_ORDER,
      qualityPlacement: 'head',
      tokenMode: 'sd15', softTokenLimit: 65, warnTokenLimit: 75,
      note: 'CLIP 77 token 上限，超过后部标签影响减弱'
    },
    'MeinaMix': {
      group: 'sd15',
      order: DEFAULT_ORDER,
      qualityPlacement: 'head',
      tokenMode: 'sd15', softTokenLimit: 65, warnTokenLimit: 75
    },
    'Counterfeit V3': {
      group: 'sd15',
      order: DEFAULT_ORDER,
      qualityPlacement: 'head',
      tokenMode: 'sd15', softTokenLimit: 65, warnTokenLimit: 75
    },
    'AbyssOrangeMix3': {
      group: 'sd15',
      order: DEFAULT_ORDER,
      qualityPlacement: 'head',
      tokenMode: 'sd15', softTokenLimit: 65, warnTokenLimit: 75
    }
  };

  // ── 其余模型全部继承默认（Illustrious / NoobAI / 各种 XL 衍生）──
  //    ★ 不给它们伪造「专属顺序」——GPT 明确指出没有数据支撑
  var INHERIT_DEFAULT = [
    'NoobAI-XL (epsilon)', 'NoobAI-XL (v-pred)',
    'Azure Luminara', 'Illustrious-XL v2.0', 'Cat Tower XL',
    'Neta Art XL', 'Nova Anime XL', 'Prefect Illustrious',
    'AstolfoMix', 'Zootlustrious', 'Hassaku XL',
    'WAI-NSFW-Illustrious', 'AAM XL'
  ];
  for (var i = 0; i < INHERIT_DEFAULT.length; i++) {
    if (!PROFILES[INHERIT_DEFAULT[i]]) {
      PROFILES[INHERIT_DEFAULT[i]] = {
        group: 'danbooru',
        order: DEFAULT_ORDER,
        qualityPlacement: 'head',
        note: 'Danbooru 系通用顺序（无官方专属建议）'
      };
    }
  }

  window.PROMPT_PROFILES = {
    // ★★★ 2026-10-24 新增 character / copyright（供角色/作品扩展库使用）
    //   必须【追加到末尾】而不是插入中间 ——
    //   因为 lib/roles.js 里 TAG_ROLE 存的是 0~20 的索引，
    //   中间插入会让所有索引错位，label 全部对不上。
    ROLES: [
      'score', 'source', 'rating', 'quality',
      'subject_count', 'species_job',
      'appearance', 'hair', 'eyes', 'expression',
      'clothing', 'accessory',
      'interaction', 'pose', 'body_state',
      'object', 'environment', 'time_weather',
      'composition', 'lighting', 'style',
      'unknown',
      'character', 'copyright'
    ],
    DEFAULT_ORDER: DEFAULT_ORDER,
    LEGACY_ORDER: LEGACY_ORDER,
    ANIMAGINE_ORDER: ANIMAGINE_ORDER,
    NEG_ORDER: NEG_ORDER,
    NEG_TIERS: NEG_TIERS,
    PROFILES: PROFILES,

    // 取某个模型的配置（找不到就用默认）
    get: function (modelName) {
      return PROFILES[modelName] || { group: 'danbooru', order: DEFAULT_ORDER };
    },

    // 排列模式
    //  ★ 2026-10-23 v2：user 模式改名 —— 它只保证「普通标签」按选择顺序，
    //    模型前缀、rating、保护开关词这些系统词仍固定在前面。
    //    原来叫「保持我的选择顺序」名不副实（GPT 指出）。
    MODES: [
      { id: 'model', label: '模型推荐' },
      { id: 'legacy', label: '旧版兼容顺序' },
      { id: 'user', label: '普通标签按我的选择顺序' }
    ]
  };
})();
