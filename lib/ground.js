/* ══════════════════════════════════════════════════════════════
   接地检查（Grounding Check）· 改进版
   借鉴 ComfyUI-Anima-Prompt-Writer 的思路：
     反查每个候选标签【在源描述里有没有依据】，标出可疑的

   ★ 只标记 + 温和降级，绝不删除 —— 保证召回率不变

   判定规则（按优先级）：
     ① 映射表命中（src='同义'）        → 永不降级（人工验证过的）
     ② CN === FRAG                    → 完全接地 ✓
     ③ CN 剩「修饰后缀」（调/色/度）     → 接地 ✓
     ④ CN 剩的部分在【源描述里出现】     → 接地 ✓
     ⑤ CN 剩的部分能【在词库里独立成词】 → ★ 可疑（带来了新语义）
     ⑥ CN 剩的部分不能成词（构词成分）   → 放行（不算新语义）
     ⑦ 源描述里出现了否定/限定词         → 接地 ✓

   降级策略：high → mid（温和一档，不直接降到 low）
             mid / low 保持不动
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var TAIL_OK = {
    '调': 1, '色调': 1, '色': 1, '色系': 1, '系': 1, '度': 1, '型': 1,
    '形': 1, '形状': 1, '状': 1, '质': 1, '质感': 1, '感': 1, '风': 1,
    '风格': 1, '款': 1, '式': 1, '样式': 1, '版': 1, '版本': 1, '化': 1,
    '性': 1, '样': 1
  };
  // 虚词：不当证据也不当新语义
  var WEAK = /^[的地得了着和与或在是有个只很太把被就都一二三四五六七八九十]+$/;
  // 否定/限定词：出现就说明用户是在收窄范围，放行
  var LIMIT_RE = /[无没不非未去脱空少缺半只仅]/;

  function stripBrackets(s) {
    return String(s || '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim();
  }

  /**
   * @param {object} cand    候选 { en, cn, frag, src, conf }
   * @param {string} src     源描述文本
   * @param {object} ctx     { isWord(str) → bool, tailOk }
   */
  function ground(cand, src, ctx) {
    ctx = ctx || {};
    var isWord = ctx.isWord || function () { return false; };
    var extraTail = ctx.tailOk || {};
    var cn = stripBrackets(cand.cn) || cand.cn || '';
    var frag = cand.frag || '';
    var S = String(src || '');

    // ① 映射表命中 → 永不判可疑
    if (cand.src === '同义') {
      return { ok: true, score: 1, reason: '', missing: [] };
    }
    if (!cn) return { ok: true, score: 1, reason: '', missing: [] };
    if (cn === frag) return { ok: true, score: 1, reason: '', missing: [] };

    var tailOk = function (t) { return !!(TAIL_OK[t] || extraTail[t]); };
    var inSrc = function (w) { return !w || WEAK.test(w) || S.indexOf(w) >= 0; };
    // ★ 关键新增：剩余部分必须是"能独立成词的语义单元"才算新语义
    var isRealUnit = function (w) { return !!(w && !WEAK.test(w) && isWord(w)); };

    var check = function (parts) {
      // parts: 需要验证的剩余片段数组
      var bad = [];
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (!p) continue;
        if (tailOk(p)) continue;          // 修饰后缀
        if (inSrc(p)) continue;           // 源描述里有
        if (isRealUnit(p)) bad.push(p);   // ★ 能独立成词且源文本没有 → 可疑
        // 不能成词 → 构词成分 → 不判可疑
      }
      return bad;
    };

    // ② 前缀匹配
    if (frag && cn.indexOf(frag) === 0) {
      var rest = cn.slice(frag.length);
      if (!rest) return { ok: true, score: 1, reason: '', missing: [] };
      var bad = check([rest]);
      if (!bad.length) return { ok: true, score: 0.9, reason: '', missing: [] };
      return { ok: false, score: 0.4, missing: bad,
               reason: '多出「' + bad.join('」「') + '」，描述里没有' };
    }

    // ③ 后缀匹配
    if (frag && cn.length > frag.length && cn.slice(-frag.length) === frag) {
      var pre = cn.slice(0, cn.length - frag.length);
      var bad2 = check([pre]);
      if (!bad2.length) return { ok: true, score: 0.9, reason: '', missing: [] };
      return { ok: false, score: 0.4, missing: bad2,
               reason: '限定词「' + bad2.join('」「') + '」，描述里没有' };
    }

    // ④ 中间匹配
    var i = cn.indexOf(frag);
    if (i > 0) {
      var a = cn.slice(0, i), b = cn.slice(i + frag.length);
      var bad3 = check([a, b]);
      if (!bad3.length) return { ok: true, score: 0.85, reason: '', missing: [] };
      return { ok: false, score: 0.4, missing: bad3,
               reason: '多出「' + bad3.join('」「') + '」，描述里没有' };
    }

    // ⑤ 其他（frag 不在 cn 里，通常是英文命中）
    return { ok: true, score: 0.6, reason: '', missing: [] };
  }

  /**
   * 批量应用
   * @returns { stats }  就地修改 cats
   */
  function apply(cats, src, opts) {
    opts = opts || {};
    if (opts.enable === false) return null;

    // 源描述里有否定/限定词 → 整体放宽，不做降级
    var lenient = LIMIT_RE.test(String(src || ''));

    var stats = { total: 0, suspicious: 0, downgraded: 0, byReason: {}, lenient: lenient };
    for (var cat in cats) {
      var list = cats[cat];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        stats.total++;
        var g = ground(c, src, opts);
        c.ground = g.ok ? 1 : 0;
        c.groundReason = g.reason || '';
        if (!g.ok) {
          stats.suspicious++;
          var k = (g.missing[0] || '').slice(0, 4);
          stats.byReason[k] = (stats.byReason[k] || 0) + 1;
          // ★ 温和降级：只动 high，且只降一档
          if (!lenient && c.conf === 'high') {
            c.conf = 'mid';
            c.downgraded = 1;
            stats.downgraded++;
          }
        }
      }
    }
    return stats;
  }

  var API = { ground: ground, apply: apply, TAIL_OK: TAIL_OK, stripBrackets: stripBrackets };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.TagGround = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
