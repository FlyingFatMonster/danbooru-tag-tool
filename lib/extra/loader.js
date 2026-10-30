/* 扩展库：角色 / 作品 / 画师
 *
 * 数据来源: ai-prompt-supermarket
 *           https://github.com/BFRKQSB7/ai-prompt-supermarket
 * 许可:     MIT License
 * 版权:     Copyright (c) 2026 BFRKQSB7
 *
 * ★ 本文件代码部分为本工具原创（MIT），数据部分来自上述项目（MIT）。
 *   完整许可证全文见同目录 THIRD-PARTY-NOTICES.txt
 *
 * ★★★ 2026-10-30 v2 重写（按 GPT 核验后的方案）
 *
 * 一、数据源改了
 *    v1 直接加载 artists.js / characters.js / copyrights.js（10.4 MB，263,275 条）
 *    v2 改用离线预处理过的 pack_cn_*.js（8.94 MB，146,038 条）
 *
 *    预处理做的事（build_pack_cn2.py）：
 *      · 剔除纯英文/拼音画师 117,237 条 —— GPT 判断：
 *        「用户知道 wlop 时，直接输入英文最准确；不存在中文检索增益」
 *      · 括号名拆出【主名】：阿尔托莉雅·潘德拉贡 (泳装Ruler) (第一阶段) (Fate)
 *        → 主名「阿尔托莉雅·潘德拉贡」
 *      · 拆出【别名】：小野寺(merrily;maryanne) → 别名 merrily / maryanne
 *      · 单字主名单独标记（搜索时只做精确/前缀）
 *
 * 二、加载策略（GPT 要求）：
 *    「不进入页面启动热路径；用户开始有效搜索后才加载；
 *      角色、作品、画师独立；不按首字分片」
 *
 *    基础包（主词库）     → 首屏
 *    中文画师包 31,568 条 → 首次搜索时后台加载（gzip 0.51 MB）
 *    作品包     17,152 条 → 同上（gzip 0.41 MB）
 *    角色包     97,318 条 → 主库无足够结果时（gzip 2.43 MB）
 *    纯英文画师           → 不做默认包
 *
 * 三、排序（GPT 给的 8 级优先级，绝不按热度）
 *    1 token 覆盖  2 主名匹配类型  3 限定词匹配  4 名称层级
 *    5 冗余程度    6 长度差        7 库优先级    8 稳定尾键
 *
 * 四、红线不变
 *    · 不并入主库  · 只增不删  · 不污染主搜索
 *    · post_count 从未进入任何数据文件，也不参与排序
 *
 * 用法：
 *   await window.TagExtra.load()              加载全部中文包
 *   await window.TagExtra.load('artists')     只加载画师包
 *   window.TagExtra.search('初音', {limit:20}) 搜索
 *   window.TagExtra.get('hatsune_miku')       取单条
 */
(function () {
  'use strict';

  // ── 包定义（按 GPT 的分层方案）──
  var PACKS = {
    works:   { file: 'lib/extra/pack_cn_works.js',   varName: 'EXTRA_CN_WORKS',   n: 17152,  priority: 1, label: '作品' },
    artists: { file: 'lib/extra/pack_cn_artists.js', varName: 'EXTRA_CN_ARTISTS', n: 31568,  priority: 2, label: '画师' },
    chars:   { file: 'lib/extra/pack_cn_chars.js',   varName: 'EXTRA_CN_CHARS',   n: 97318,  priority: 0, label: '角色' }
  };
  // 类型码（和预处理脚本一致）
  var KIND_NAME = ['char', 'work', 'artist'];
  var KIND_TO_PACK = { char: 'chars', work: 'works', artist: 'artists' };

  var LOADED = { chars: false, works: false, artists: false };
  var LOADING = {};

  // ── 注入脚本 ──
  function inject(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[data-extra="' + src + '"]')) { res(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.setAttribute('data-extra', src);
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('加载失败: ' + src)); };
      document.head.appendChild(s);
    });
  }

  // ── 索引：从预处理好的紧凑记录直接读，不再二次对象化 ──
  //   GPT 要求：「不要再把全部数据复制成另一套对象数组」
  var IDX = null;          // [{en, dis, base, kind, aliases, single}]
  var BY_EN = null;        // en → record

  function buildIndex() {
    if (IDX) return IDX;
    var arr = [];
    for (var pk in PACKS) {
      var vn = PACKS[pk].varName;
      var raw = window[vn];
      if (!raw || !raw.length) continue;
      for (var i = 0; i < raw.length; i++) {
        var r = raw[i];
        if (!r || !r.d) continue;
        arr.push({
          en: r.e,
          dis: r.d,                    // 显示名（完整）
          cn: r.d,                     // ★ 兼容旧字段名（app.js 的 renderExtra 用 it.cn）
          base: r.b || r.d,            // 主名（没剥离过就等同显示名）
          kind: KIND_NAME[r.k] || 'char',
          aliases: r.a || null,
          single: r['1'] === 1,
          unparsed: r.u === 1
        });
      }
    }
    IDX = arr;
    BY_EN = Object.create(null);
    for (var j = 0; j < arr.length; j++) {
      if (!BY_EN[arr[j].en]) BY_EN[arr[j].en] = arr[j];
    }
    return IDX;
  }

  // ── 加载 ──
  //   不传参数 → 加载三个中文包
  //   传 'artists' → 只加载画师包
  function load(which) {
    var want = which ? [which] : ['works', 'artists', 'chars'];
    var jobs = [];
    for (var i = 0; i < want.length; i++) {
      var pk = want[i];
      if (!PACKS[pk]) continue;
      if (LOADED[pk]) continue;
      if (LOADING[pk]) { jobs.push(LOADING[pk]); continue; }
      (function (k) {
        LOADING[k] = inject(PACKS[k].file).then(function () {
          LOADED[k] = !!window[PACKS[k].varName];
          IDX = null; BY_EN = null;      // 有新增才失效缓存
          return true;
        }).catch(function (e) {
          LOADING[k] = null;
          throw e;
        });
        jobs.push(LOADING[k]);
      })(pk);
    }
    if (!jobs.length) return Promise.resolve(true);
    return Promise.all(jobs).then(function () { return true; });
  }

  function isLoaded() {
    return LOADED.chars && LOADED.works && LOADED.artists;
  }

  // ══════════════════════════════════════════════════════════════════
  //  匹配等级（GPT 的 8 级排序，转成数字越小越优先）
  //
  //  1 完整名精确  2 主名精确  3 别名精确
  //  4 主名前缀    5 完整名前缀  6 别名前缀
  //  7 主名词边界/连续子串  8 完整名子串  9 限定词命中
  // ══════════════════════════════════════════════════════════════════
  function rankOf(it, q, ql) {
    var dis = it.dis, base = it.base;
    var en = String(it.en || '').toLowerCase();
    var disL = String(dis).toLowerCase();
    var baseL = String(base).toLowerCase();

    if (dis === q) return 1;
    if (base === q) return 2;
    if (en === ql) return 1;                       // 英文精确等同完整名精确
    if (it.aliases) {
      for (var a = 0; a < it.aliases.length; a++) {
        if (it.aliases[a] === q) return 3;
      }
    }
    if (baseL.indexOf(ql) === 0) return 4;
    if (disL.indexOf(ql) === 0) return 5;
    if (en.indexOf(ql) === 0) return 5;
    if (it.aliases) {
      for (var b = 0; b < it.aliases.length; b++) {
        if (String(it.aliases[b]).toLowerCase().indexOf(ql) === 0) return 6;
      }
    }
    if (baseL.indexOf(ql) >= 0) return 7;
    if (disL.indexOf(ql) >= 0) return 8;
    if (en.indexOf(ql) >= 0) return 8;
    if (it.aliases) {
      for (var c = 0; c < it.aliases.length; c++) {
        if (String(it.aliases[c]).toLowerCase().indexOf(ql) >= 0) return 9;
      }
    }
    return 99;
  }

  // ── 类型名兼容 ──
  //   旧版用 'copyright'，新版用 'work'（更准确：包含作品/企划/系列）。
  //   两边都接受，输出两边都给，避免破坏既有调用方和测试页。
  function normKind(k) {
    if (!k) return k;
    if (k === 'copyright' || k === 'copyrights') return 'work';
    if (k === 'chars') return 'char';
    if (k === 'artists') return 'artist';
    return k;
  }
  function withCompat(o) {
    if (!o) return o;
    // 结果里同时给出 work 和 copyright
    o.copyright = o.work;
    o.copyrightTotal = o.workTotal;
    return o;
  }

  /* 搜索
   * opt.kinds    ['char','work','artist']  默认三种都搜（'copyright' 也接受）
   * opt.limit    每种最多返回多少条（默认 20）
   */
  function search(q, opt) {
    opt = opt || {};
    q = String(q || '').trim();
    var empty = withCompat({ char: [], work: [], artist: [], total: 0, truncated: false });
    if (!q) return empty;

    var ql = q.toLowerCase();
    var kinds = (opt.kinds || ['char', 'work', 'artist']).map(normKind);
    var limit = opt.limit || 20;

    // ★ GPT 的短查询保护 + 实测收紧：
    //   单字 → 只做精确（rank ≤2），否则「女」「铃」会带出几百条
    //   两字 → 精确 + 前缀（rank ≤6）
    //   三字以上 → 全放开
    var maxRank = q.length <= 1 ? 2 : (q.length <= 2 ? 6 : 98);

    var idx = buildIndex();
    var out = { char: [], work: [], artist: [], total: 0, truncated: false };

    for (var i = 0; i < idx.length; i++) {
      var it = idx[i];
      if (kinds.indexOf(it.kind) < 0) continue;
      // ★ 单字主名保护：非精确命中时跳过，避免「荧」把所有带荧的都拉出来
      if (it.single && q.length <= 1 && it.base !== q) continue;
      var r = rankOf(it, q, ql);
      if (r >= 99 || r > maxRank) continue;
      it._r = r;
      // 覆盖率（同等级时更贴切的优先）
      var nl = it.base.length || it.dis.length;
      it._cov = nl ? q.length / nl : 0;
      // ★ 冗余度：显示名比主名多出来的字数（即没被查询覆盖的限定词量）
      //   GPT 的第 5 级排序项「冗余程度 —— 未被查询覆盖的限定词数量少者优先」
      //   用途：「初音」查询时，主名精确的「初音 (公主连结!)」冗余 7 字，
      //        而主名前缀的「初音未来」冗余 0 字 → 后者应该优先。
      it._red = Math.max(0, (it.dis.length - it.base.length));
      (out[it.kind] = out[it.kind] || []).push(it);
    }

    // ── GPT 的 8 级排序 ──
    //   本实现：匹配等级 → 覆盖率 → 未被查询覆盖的额外长度 → 库优先级 → 字典序
    function cmp(a, b) {
      // ★ 主名精确(2) 与 主名前缀(4) 合并为一档先比，再比冗余
      //   原因：「初音」查询时，主名精确的「初音 (公主连结!)」会压过
      //        主名前缀的「初音未来」，但后者才是用户想要的。
      //   ★ 但单字查询时不合并 —— 否则「荧」会让「荧光鱼」压过「荧 (原神)」。
      var mergeTier = q.length >= 2;
      function tier(r) {
        if (r === 1) return 1;                 // 完整名精确
        if (mergeTier) {
          if (r === 2 || r === 4) return 2;    // 主名精确 / 主名前缀 合并
        } else {
          if (r === 2) return 2;               // 单字：主名精确独立一档
          if (r === 4) return 3;               // 单字：主名前缀次之
        }
        if (r === 3) return mergeTier ? 3 : 4; // 别名精确
        if (r === 5) return mergeTier ? 4 : 5; // 完整名前缀
        if (r === 6) return mergeTier ? 5 : 6; // 别名前缀
        if (r === 7) return mergeTier ? 6 : 7; // 主名子串
        if (r === 8) return mergeTier ? 7 : 8; // 完整名子串
        return 9;
      }
      var ta = tier(a._r), tb = tier(b._r);
      if (ta !== tb) return ta - tb;                                // ① 匹配质量
      if (a._red !== b._red) return a._red - b._red;                // ② 冗余度（少者优先）
      if (Math.abs(a._cov - b._cov) > 0.001) return b._cov - a._cov; // ③ 覆盖率
      var la = a.base.length, lb = b.base.length;                   // ④ 长度差
      if (la !== lb) return la - lb;
      var pa = PACKS[KIND_TO_PACK[a.kind]] ? PACKS[KIND_TO_PACK[a.kind]].priority : 9;
      var pb = PACKS[KIND_TO_PACK[b.kind]] ? PACKS[KIND_TO_PACK[b.kind]].priority : 9;
      if (pa !== pb) return pa - pb;                                // ⑤ 库优先级
      return a.en < b.en ? -1 : a.en > b.en ? 1 : 0;                // ⑥ 稳定尾键
    }

    var tc = 0, tw = 0, ta = 0;
    for (var k in out) {
      if (k === 'total' || k === 'truncated') continue;
      var arrk = out[k];
      if (!arrk || !arrk.length) continue;
      arrk.sort(cmp);
      var before = arrk.length;
      if (k === 'char') tc = before;
      else if (k === 'work') tw = before;
      else if (k === 'artist') ta = before;
      if (arrk.length > limit) { out[k] = arrk.slice(0, limit); out.truncated = true; }
    }
    out.total = tc + tw + ta;
    out.charTotal = tc;
    out.workTotal = tw;
    out.artistTotal = ta;
    return withCompat(out);
  }

  function get(en) {
    var idx = buildIndex();
    if (BY_EN && BY_EN[en]) return BY_EN[en];
    for (var i = 0; i < idx.length; i++) if (idx[i].en === en) return idx[i];
    return null;
  }

  window.TagExtra = {
    load: load,
    isLoaded: isLoaded,
    search: search,
    get: get,
    packs: function () {
      var o = {};
      for (var k in PACKS) o[k] = { loaded: !!LOADED[k], n: PACKS[k].n, label: PACKS[k].label };
      return o;
    },
    stats: function () {
      var idx = buildIndex();
      var byKind = { char: 0, work: 0, artist: 0 };
      var withBase = 0, withAlias = 0, single = 0;
      for (var i = 0; i < idx.length; i++) {
        byKind[idx[i].kind] = (byKind[idx[i].kind] || 0) + 1;
        if (idx[i].base !== idx[i].dis) withBase++;
        if (idx[i].aliases) withAlias++;
        if (idx[i].single) single++;
      }
      return {
        total: idx.length, byKind: byKind,
        withBase: withBase, withAlias: withAlias, singleBase: single,
        loaded: { chars: LOADED.chars, works: LOADED.works, artists: LOADED.artists },
        // ★ 兼容旧字段名（测试页和 app.js 在用）
        chars: byKind.char,
        copyrights: byKind.work,
        artists: byKind.artist,
        source: 'ai-prompt-supermarket (MIT)'
      };
    }
  };
})();
