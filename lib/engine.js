/* ══════════════════════════════════════════════════════════════
   标签匹配引擎 · 浏览器版（Route B）
   从 NL_v2.py 的 FuzzyEngine 移植，逻辑保持一致
   ★ 无任何浏览器依赖，Node 也能跑（便于测试）
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var DATA = null;          // {LIB, SYN, MODELS, C, MANIFEST}

  // ── 工具 ──
  function stripBrackets(s) {
    return String(s || '')
      .replace(/（[^）]*）/g, '')
      .replace(/\([^)]*\)/g, '')
      .trim();
  }

  // ★ 修饰性后缀白名单（区分「暖色/暖色调」与「母亲/母亲髋」）
  var TAIL_OK = null;

  // ★ 否定词开头
  var NEG_RE = /^[无没不非未去脱]/;
  var PARTICLE_RE = /^[的在了]/;
  // ★ B1 通用修饰词（颜色/数量/方位/尺寸/程度/性别年龄）—— 实测这些片段 0 命中
  var MOD_CHARS = '黑白红蓝绿黄紫粉灰棕金银青橙' +
                  '双单多两三四五六七八九十百千万' +
                  '上下左右前后内外的里中旁边' +
                  '大小长短高低粗细厚薄宽窄' +
                  '新旧明暗深浅强弱' +
                  '男女老少';

  // ── 引擎 ──
  function Engine(data) {
    // ★ 隐含关系 / 子类索引：优先用传入的，否则回落到 window 全局
    if (!data.TAG2SUB && root.TAG2SUB) data.TAG2SUB = root.TAG2SUB;
    if (!data.IMPLICATIONS && root.IMPLICATIONS) data.IMPLICATIONS = root.IMPLICATIONS;
    // ★ 官方分类表（Danbooru tag_groups）：同样允许回落到 window 全局
    if (!data.TGROUP && root.TGROUP) data.TGROUP = root.TGROUP;
    this.data = data;
    var LIB = data.LIB, C = data.C || {};
    TAIL_OK = {};
    (C.TAIL_OK || []).forEach(function (t) { TAIL_OK[t] = 1; });

    this.rows = LIB.n.length;
    this.CN2EN = {};         // 中文名(去括号) → [en,...]
    this.CN2EN_RAW = {};
    this.EN2CN = {};
    this.EN2CAT = {};
    this.EN2TIER = {};

    var t0 = (root.performance || Date).now();
    for (var i = 0; i < this.rows; i++) {
      var n = LIB.n[i], c = (LIB.c[i] || '').trim();
      this.EN2CN[n] = c;
      this.EN2CAT[n] = LIB.b[i] || '';
      this.EN2TIER[n] = LIB.t[i] || '';
      if (!c) continue;
      (this.CN2EN_RAW[c] = this.CN2EN_RAW[c] || []).push(n);
      var c2 = stripBrackets(c);
      var parts = (c2 || c).split(/[\/、]/);
      for (var k = 0; k < parts.length; k++) {
        var q = parts[k].trim();
        if (!q) continue;
        (this.CN2EN[q] = this.CN2EN[q] || []).push(n);
      }
    }
    this.buildMs = (root.performance || Date).now() - t0;

    // ══════════════════════════════════════════════════════════════════════════
    // ★ A1 英文倒排索引（替代 51,017 次全表扫描，提速约 13 倍）
    var t0e = (root.performance || Date).now();
    this.EN_TOKENS = [];
    this.EN_TOKEN2TAGS = {};
    this.EN_PREF = {};
    this.EN_NAME_LOWER = {};
    var tokSeen = {};
    for (var ei = 0; ei < LIB.n.length; ei++) {
      var en0 = LIB.n[ei];
      this.EN_NAME_LOWER[en0.toLowerCase()] = en0;
      var toks = en0.toLowerCase().split(/[_\-()\s\/!,.&:;']+/);
      for (var ti = 0; ti < toks.length; ti++) {
        var tk = toks[ti];
        if (!tk) continue;
        (this.EN_TOKEN2TAGS[tk] = this.EN_TOKEN2TAGS[tk] || []).push(en0);
        if (!tokSeen[tk]) { tokSeen[tk] = 1; this.EN_TOKENS.push(tk); }
      }
    }
    for (var tz = 0; tz < this.EN_TOKENS.length; tz++) {
      var tk2 = this.EN_TOKENS[tz];
      if (tk2.length < 2) continue;
      (this.EN_PREF[tk2.substr(0, 2)] = this.EN_PREF[tk2.substr(0, 2)] || []).push(tk2);
    }
    this.idxEnMs = (root.performance || Date).now() - t0e;

    // 2 字倒排索引
    var t1 = (root.performance || Date).now();
    this.IDX2 = {};
    for (var cn in this.CN2EN) {
      for (var j = 0; j < cn.length - 1; j++) {
        var key = cn.substr(j, 2);
        (this.IDX2[key] = this.IDX2[key] || []).push(cn);
      }
    }
    this.idxMs = (root.performance || Date).now() - t1;

    // ★ 单字倒排索引（用于编辑距离 ≤1 的模糊匹配）
    var t1b = (root.performance || Date).now();
    this.IDX1 = {};
    for (var cn1 in this.CN2EN) {
      var L1 = cn1.length;
      if (L1 < 2 || L1 > 7) continue;
      for (var j1 = 0; j1 < L1; j1++) {
        var k1 = cn1.charAt(j1);
        (this.IDX1[k1] = this.IDX1[k1] || []).push(cn1);
      }
    }
    this.idx1Ms = (root.performance || Date).now() - t1b;

    // ★ 子类倒排索引（子类 → [标签]），用于 L4 关联推荐
    var t1c = (root.performance || Date).now();
    this.SUB2TAGS = {};
    var T2S0 = data.TAG2SUB;
    if (T2S0) {
      for (var tg0 in T2S0) {
        var sk0 = String(T2S0[tg0][1]);
        (this.SUB2TAGS[sk0] = this.SUB2TAGS[sk0] || []).push(tg0);
      }
    }
    this.subMs = (root.performance || Date).now() - t1c;

    // 映射表
    var t2 = (root.performance || Date).now();
    this.SYN = {};
    this.SYN_MISS = [];
    var raw = data.SYN || {};
    for (var k2 in raw) {
      var vals = raw[k2];
      if (!Array.isArray(vals)) vals = [vals];
      var ens = [];
      for (var v = 0; v < vals.length; v++) {
        var val = (vals[v] || '').trim();
        if (!val) continue;
        if (this.CN2EN[val]) {
          this.CN2EN[val].forEach(function (e) { if (ens.indexOf(e) < 0) ens.push(e); });
        } else if (this.EN2CN[val] !== undefined) {
          if (ens.indexOf(val) < 0) ens.push(val);
        } else {
          this.SYN_MISS.push([k2, val]);
        }
      }
      if (ens.length) this.SYN[k2] = ens;
    }
    this.synMs = (root.performance || Date).now() - t2;

    // ══════════════════════════════════════════════════════════════════════════
    //  ★★★ 2026-10-30 性能修复：单字 → 含该字的映射表键（CHAR2KEYS）
    //
    //  问题：autoPicks 里的 singleCharAllowed() 原本是这样写的：
    //          for (var _k in _SYNREF) {
    //            if (_k.indexOf(frag) < 0) continue;
    //            if (plainAll.indexOf(_k) >= 0) return false;
    //          }
    //        对【每个单字候选】都遍历全部 76,434 个映射表键。
    //        超长句（60 字）有几十个单字片段 → 几百万次 indexOf。
    //
    //  CPU profile 实测（超长句 60 字，584 候选）：
    //        singleCharAllowed  77.7%
    //        Engine.match        6.4%
    //        Engine 构造          5.1%
    //        Engine.autoPicks    1.4%
    //        autoPicks 单次 164 ms，绝大部分在这一项
    //
    //  修法：建一次「单字 → 含该字的键列表」倒排索引，
    //        运行时只遍历含该字的键（通常几百个而不是 7 万）。
    //  ★ 判断逻辑一字未改，只是把遍历范围从全表缩到相关子集。
    // ══════════════════════════════════════════════════════════════════════════
    var t3 = (root.performance || Date).now();
    this.CHAR2KEYS = Object.create(null);
    //  ★ 不去重：同一个键里重复的字最多让列表里多一条，
    //    运行时多查一次 indexOf 而已，但省掉了 76,434 次对象分配。
    for (var _sk2 in this.SYN) {
      var _len2 = _sk2.length;
      if (_len2 <= 1) continue;
      for (var _si2 = 0; _si2 < _len2; _si2++) {
        var _ch2 = _sk2.charAt(_si2);
        var _arr2 = this.CHAR2KEYS[_ch2];
        if (_arr2) _arr2.push(_sk2);
        else this.CHAR2KEYS[_ch2] = [_sk2];
      }
    }
    this.charIdxMs = (root.performance || Date).now() - t3;


    //  ★★★ 2026-10-30：把映射表（SYN）的纯中文键并进 CN2EN（扩展层）
    //
    //  ★ 位置很重要：必须放在 SYN 索引建完之后。
    //    因为 SYN 的构建（L210）会读 this.CN2EN[val] 展开中文值，
    //    提前合并会改变 SYN 的内容 → 连带改变 match() 的行为 → 破坏回归。
    //    放这里只影响 autoAssemble 的 CN2EN 查表，不动 match。
    //
    //  问题：CN2EN 原来【只从词库的中文名】建。
    //        映射表有 67,238 个纯中文键，其中 41,269 个（61.4%）不在 CN2EN 里。
    //
    //        后果（60 条真实语料实测）：
    //          「少女手淫」只出 girl → 应该有 female_masturbation/fingering/masturbation
    //          「传教士体位」出 0 个词 → 应该有 missionary
    //          「少女跪在地上」出 0 个词 → 应该有 kneeling
    //          autoAssemble 覆盖率只有 48.7%
    //
    //  方案（与 GPT 讨论后确定的保守版）：
    //    · 只并入「纯中文、不含英文」的键
    //    · 目标标签必须在 EN2CAT 里（属于 15 字段）
    //    · 不覆盖 CN2EN 已有的键（核心层优先）
    //    · ★ 排除「释义型」键 —— GPT 指出这是真正的脏源，不是长度
    //    · ★ 排除单字键 —— 单字多义，自动触发风险太大
    //    · ★ 长而自然的表达要保留（「两个人从后面进入」比「进入」更精确）
    //
    //  ★ GPT 明确反对的：不要用「长度」当筛子。短词也可能脏，长句也可能准确。
    //    真正的判据是「这个中文键是不是用户可能自然输入的表达，
    //    而不是词典释义、说明文字或编辑备注」。
    //
    //  ★ 符合设计初衷：用户说什么就能出什么。不删除任何映射，只扩大自动组装的命中面。
    // ══════════════════════════════════════════════════════════════════════════
    var SYN0 = data.SYN || {};
    // 释义型键的标记词（GPT 给的清单 + 实测量补充）
    var META_MARKS = [
      '泛指', '指的是', '通常用于', '包括但不限于', '一般表示',
      '这里指', '与…类似', '与...类似', '的统称', '用来描述',
      '某种类型', '即指', '意思是', '所谓', '又称', '亦称',
      '同义于', '相当于', '近似于', '类似于', '等等'
    ];
    var _synAdded = 0, _synSkipMeta = 0, _synSkipSingle = 0, _synSkipNoCat = 0;
    var _synStructAdd = 0;
    // ★ 建 EN2ROLE（英文标签 → promptRole 名），供下面的「只补 structural 类」用
    //   来源：window.TAG_ROLE = {标签: 角色索引}，window.PROMPT_PROFILES.ROLES = [角色名...]
    this.EN2ROLE = {};
    (function (eg) {
      var TR = root.TAG_ROLE;
      var RL = (root.PROMPT_PROFILES && root.PROMPT_PROFILES.ROLES) || [];
      if (!TR || !RL.length) return;
      for (var t in TR) {
        var ri = TR[t];
        if (ri != null && RL[ri]) eg[t] = RL[ri];
      }
    })(this.EN2ROLE);
    for (var sk in SYN0) {
      if (!sk) continue;
      // ★ 2026-10-30 性能优化：用一次字符扫描代替两次正则
      //   原来是 /[\u4e00-\u9fa5]/.test(sk) + /[A-Za-z]/.test(sk)，
      //   对 76,434 个键跑两遍正则。改成单次扫描，结果完全等价：
      //     hasCn = 含至少一个汉字
      //     hasEn = 含至少一个英文字母
      //     hasDigitOrSym = 含数字或符号（用于提前退出）
      var _hasCn = false, _hasEn = false;
      for (var _scan = 0; _scan < sk.length; _scan++) {
        var _cc = sk.charCodeAt(_scan);
        if (_cc >= 0x4e00 && _cc <= 0x9fa5) { _hasCn = true; if (_hasEn) break; }
        else if ((_cc >= 65 && _cc <= 90) || (_cc >= 97 && _cc <= 122)) { _hasEn = true; if (_hasCn) break; }
      }
      if (!_hasCn) continue;                         // 必须含中文
      if (_hasEn) continue;                          // 不能含英文
      // ★★★ 2026-10-30 二轮修正（GPT 核验后）：
      //
      //   原来这里是 `if (this.CN2EN[sk]) continue;`（核心层优先，跳过）。
      //   实测发现这个策略有严重副作用：
      //     SYN['少女'] = ['1girl']，但核心层 CN2EN['少女'] = ['girl','teen_girl']
      //     → 合并后 1girl 完全丢失
      //     → 「少女伸手摸脸」「少女坐在窗台上」三句都组装不出 1girl
      //
      //   GPT 的判断：
      //     「核心层优先应废止，但不能替换成最终输出裸并集。
      //       正确方案是：候选取并集、来源保留、关系分类、最终选择。」
      //     并明确否决了裸并集，举例：
      //       自慰 → autocunnilingus   凭空加细节
      //       肛交 → ass-to-mouth      因果推断
      //       颜射 → bukkake           单人推多人
      //
      //   最小可行做法（本轮，经 GPT 核验后收紧）：
      //     对【已存在的键】，只补入【纯计数标签】（1girl / 1boy / 2girls / …）。
      //
      //   ★ 2026-10-30 二次收紧的原因：
      //     一开始放行整个 subject_count 类，但做了 506 条关系分类抽样后发现
      //     subject_count 层里混着这些：
      //       少年 → 1boy                complementary  ✅ 该补
      //       女   → 1girl               broader        ⚠️
      //       无脸男 → faceless_male     error          ❌
      //       姐弟  → siblings           error          ❌
      //       全员  → absolutely_everyone alias         ❌
      //     所以只放行「纯计数」形式的标签名，不放行整个类。
      var COUNT_RE = /^(\d+(girl|boy|other)s?|multiple_(girls|boys|others)|no_humans|solo|duo|trio|group)$/;
      if (this.CN2EN[sk]) {
        var _coreArr = this.CN2EN[sk];
        var _sv0 = SYN0[sk];
        var _arr0 = (Object.prototype.toString.call(_sv0) === '[object Array]') ? _sv0 : [_sv0];
        var _added0 = 0;
        for (var _zi = 0; _zi < _arr0.length; _zi++) {
          var _ze = _arr0[_zi];
          if (typeof _ze !== 'string') continue;
          if (!this.EN2CAT[_ze]) continue;
          if (_coreArr.indexOf(_ze) >= 0) continue;
          // 只放行纯计数标签（白名单正则）
          if (!COUNT_RE.test(_ze)) continue;
          _coreArr.push(_ze);
          _added0++;
        }
        if (_added0) _synStructAdd++;
        continue;
      }
      if (sk.length < 2) { _synSkipSingle++; continue; }   // 单字风险太高
      var _isMeta = false;
      for (var mi = 0; mi < META_MARKS.length; mi++) {
        if (sk.indexOf(META_MARKS[mi]) >= 0) { _isMeta = true; break; }
      }
      if (_isMeta) { _synSkipMeta++; continue; }
      var sv = SYN0[sk];
      if (!sv) continue;
      var arr = (Object.prototype.toString.call(sv) === '[object Array]') ? sv : [sv];
      var keep = [];
      for (var si = 0; si < arr.length; si++) {
        var se = arr[si];
        if (typeof se !== 'string') continue;
        if (!this.EN2CAT[se]) continue;              // 只要 15 字段内的标签
        keep.push(se);
      }
      if (!keep.length) { _synSkipNoCat++; continue; }
      this.CN2EN[sk] = keep;
      _synAdded++;
    }
    this.synStats = {
      added: _synAdded,
      skipMeta: _synSkipMeta,
      skipSingle: _synSkipSingle,
      skipNoCat: _synSkipNoCat
    };

  }

  // ── 切片（5→2 字滑窗 + 英文词 + 整句片段）──
  Engine.prototype.cut = function (text) {
    var zh = {}, en = {}, enExact = {};
    var rawText = String(text || '');

    // ★ 特殊形式覆盖：原实现只抓 /[\u4e00-\u9fff]+/，导致映射表里这些键永远匹配不上：
    //     「杏（水果）」→ 只切出「水果」，丢了「杏」
    //     「银 (金属)」 → 只切出「金属」，丢了「银」
    //     「2穴」      → 切出空
    //     「Q版插图」   → 丢了「Q」
    //   实测：1,858 → 36 个精确同义从「搜不到」变成「能搜到」
    var whole = rawText.replace(/[\s\u3000]+/g, '').trim();
    if (whole.length >= 2 && whole.length <= 48) zh[whole] = 1;
    //   保留原样的版本（含空格，如「银 (金属)」）
    var rawTrim = rawText.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
    if (rawTrim.length >= 2 && rawTrim.length <= 48 && rawTrim !== whole) zh[rawTrim] = 1;
    //   混合连续段：中文 + 字母 + 数字 + 括号连在一起的整段
    var mixed = rawText.match(/[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff()（）\[\]【】·・\-_']*/g) || [];
    for (var mi = 0; mi < mixed.length; mi++) {
      var mx = mixed[mi].trim();
      if (!mx) continue;
      if (mx.length >= 2 && mx.length <= 48) zh[mx] = 1;
      // 去括号版本（「杏（水果）」→「杏」）
      var noBr = mx.replace(/[（(][^）)]*[）)]/g, '').trim();
      if (noBr.length >= 1 && noBr !== mx) zh[noBr] = 1;
      // 混合段里的中文子段走滑窗
      var subZh = mx.match(/[\u4e00-\u9fff]+/g) || [];
      for (var si = 0; si < subZh.length; si++) {
        var sz = subZh[si];
        if (sz !== mx) {
          for (var sL = 5; sL >= 2; sL--) {
            for (var ss = 0; ss + sL <= sz.length; ss++) zh[sz.substr(ss, sL)] = 1;
          }
        }
      }
      // ★ 混合段的【前缀滑窗】：让「69式」「T字裤」「2穴」「Q版插」这类键能被切到
      //   原实现只把整段加进去，导致含数字/字母的短键永远匹配不上
      //   （实测：「69式相互口交」切不出「69式」→ sixty_nine 漏召回）
      //   ★ 只取前缀窗口，不取中间/后缀 —— 避免产出「9式」「式相」这类无意义片段
      //   ★★ 只对【确实含数字或字母】的段生效：纯中文段已有完整滑窗，
      //       再加前缀会凭空增多候选，把真答案挤出限额（实测 N30 丢了 anal_fluid）
      //
      // ★★★ 2026-10-30 修 bug：还必须【含中文】
      //
      //   问题：原条件只检查「含字母或数字」，纯 ASCII 段也会走这里：
      //     hatsune_miku → hatsu / hats / hat / ha
      //     blue_eyes    → blue_ / blue / blu / bl
      //     long_hair    → long_ / long / lon / lo
      //   其中 hat / blue / long / bre 在映射表里对应大量标签 → 噪音爆发。
      //
      //   GPT 核验后的实测对比（未限额候选量）：
      //     hatsune_miku  2813 → 12
      //     blue_eyes     1465 → 1
      //     long_hair      679 → 7
      //     69式相互口交     52 → 52   ✅ 保持
      //     T字裤           756 → 756  ✅ 保持
      //     2穴               1 → 1    ✅
      //     Q版插图           26 → 26  ✅
      //     69                5 → 5    ✅
      //
      //   ★ 为什么加这个条件不会损失英文查询能力（GPT 说明原文）：
      //     「SYN 不是英文标签查询的主要入口。构造引擎时已经从 LIB.n 建了三个英文索引：
      //        EN_NAME_LOWER（完整英文标签名 → 原标签名）
      //        EN_TOKEN2TAGS（英文 token → 包含该 token 的标签）
      //        EN_PREF（token 前两字符 → token 候选）
      //      真正负责英文标签搜索的是 f.en 加英文倒排索引。」
      //   ★★ 纯 ASCII 段的整段仍会 zh[mx]=1，配合 en[] 索引照常精确/前缀命中。
      if (mx.length >= 2 && /[A-Za-z0-9]/.test(mx) && /[\u4e00-\u9fff]/.test(mx)) {
        var _mp = Math.min(5, mx.length);
        for (var _mL = _mp; _mL >= 2; _mL--) zh[mx.substr(0, _mL)] = 1;
      }
    }

    var zs = rawText.match(/[\u4e00-\u9fff]+/g) || [];
    for (var i = 0; i < zs.length; i++) {
      var z = zs[i];
      for (var L = 5; L >= 2; L--) {
        for (var s = 0; s + L <= z.length; s++) zh[z.substr(s, L)] = 1;
      }
      // ★ 停用词处理（加强版）
      //  ① 去掉开头的助词
      var t = z.replace(/^[的在了着地得]/, '');
      if (t.length >= 2) zh[t] = 1;
      //  ② 去掉结尾的助词
      var t2 = z.replace(/[的在了着地得]+$/, '');
      if (t2.length >= 2 && t2 !== z) zh[t2] = 1;
      //  ③ 全文去掉虚词后再切窗（"他的手机" → "他手机" → 手机 ✓）
      var t3 = z.replace(/[的在了着地得和与及是就都也还很太更最把被给对向从到]/g, '');
      if (t3.length >= 2 && t3 !== z) {
        zh[t3] = 1;
        for (var L3 = Math.min(5, t3.length); L3 >= 2; L3--) {
          for (var s3 = 0; s3 + L3 <= t3.length; s3++) zh[t3.substr(s3, L3)] = 1;
        }
      }
    }
    // ★ A2 归一化：全角→半角；连字符/下划线互换；单复数变体
    var _norm = String(text || '').replace(/[\uff01-\uff5e]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    }).replace(/\u3000/g, ' ');
    var es = _norm.toLowerCase().match(/[a-z][a-z0-9_\-]{2,}/g) || [];
    for (var e = 0; e < es.length; e++) {
      var w = es[e];
      en[w] = 1;
      if (w.indexOf('-') >= 0) en[w.replace(/-/g, '_')] = 1;
      if (w.indexOf('_') >= 0) en[w.replace(/_/g, '-')] = 1;
      // ★ 复数/单数变体（只做合法英文变形，避免 cat→cates 这类噪音）
      //
      // ★★★ 2026-10-30 修：已知完整标签名【不做形态扩展】
      //
      //   问题实证：
      //     hatsune_miku → hatsune_mikus → 不在标签名里 → 触发 A3 模糊纠错
      //       → et+'s'===frag 命中 hatsune_miku → 展开到 11 个含该 token 的标签
      //     long_hair → long_hairs → 同样 6 个噪音
      //     gold      → golds      → 179 个噪音
      //
      //   实测（抽样 40 个单数标签）：
      //     「已知标签名加复数变体」带来的额外命中 = 0 个
      //     因为精确匹配 EN_NAME_LOWER[w] 已经覆盖了。
      //
      //   ★ GPT 核验后的原则（原文）：
      //     「输入已经是已知完整标签名时，精确匹配终止形态扩展，
      //       不再生成单复数候选。」
      //
      //   ★★ 注意：限制的是【双向】扩展（复数→单数、单数→复数），
      //       不只是 +s 那一个分支 —— 否则 legs→leg 这类仍会产生噪音。
      //
      // ★★★ 2026-10-30 第二轮修（GPT Q3 预警的问题）：
      //
      //   上一轮只禁了「已知标签做扩展」，但用户直接输入复数（如 golds）时，
      //   golds 不是已知标签 → 仍会生成 gold → 然后 gold 走 3b/3c 英文通道
      //     EN_TOKEN2TAGS['gold'] → 121 个含 gold token 的标签
      //     EN_PREF 子串 → 又 +51 个
      //   实测 golds 仍返回 179 条。
      //
      //   ★ GPT 的原则（Q3 原文）：
      //     「生成单数候选后，不要无条件让它参与大范围 token 扩散。
      //       优先要求还原结果满足：是已知完整标签名。」
      //
      //   修法：派生出的单数形式如果【正好是完整标签名】，走 enExact 通道
      //        （只做精确匹配，不扩散）；否则才进 en 全通道。
      var _knownEn = !!(this.EN_NAME_LOWER && this.EN_NAME_LOWER[w]);
      if (!_knownEn && w.length >= 4 && /^[a-z]/.test(w)) {
        var _derived = null;
        if (/ies$/.test(w)) _derived = w.slice(0, -3) + 'y';
        else if (/(?:s|x|z|ch|sh)es$/.test(w)) _derived = w.slice(0, -2);
        else if (/s$/.test(w) && !/ss$/.test(w)) _derived = w.slice(0, -1);
        else if (/(?:s|x|z|ch|sh)$/.test(w)) _derived = w + 'es';
        else _derived = w + 's';

        if (_derived && this.EN_NAME_LOWER && this.EN_NAME_LOWER[_derived]) {
          // 还原结果正好是完整标签 → 只做精确匹配，不扩散
          enExact[_derived] = 1;
        } else if (_derived) {
          en[_derived] = 1;
        }
      }
    }
    return { zh: Object.keys(zh), en: Object.keys(en), enExact: Object.keys(enExact || {}) };
  };

  // ── 匹配 ──
  Engine.prototype.match = function (text, opt) {
    opt = opt || {};
    // ★ 每字段候选上限：实测 32 → 48 可多召回 1 个 NSFW 真答案，
    //   界面只多约 15 个候选（+5%），48 之后完全饱和，再高只增噪不增益
    var perCat = opt.perCat || 48;
    var tier = opt.tier || '全部';
    var useSyn = opt.useSyn !== false;
    var BIZ = (this.data.MANIFEST && this.data.MANIFEST.biz) || [];
    if (!text || !String(text).trim()) return {};

    var t0 = (root.performance || Date).now();
    var f = this.cut(text);
    var frags = f.zh.concat(f.en);
    // ★★★ 2026-10-30：形态派生片段（只做精确匹配）
    //
    //   来源：cut() 的 A2 归一化里，用户输入的复数形式（golds）会还原成单数（gold），
    //        如果 gold 正好是完整标签名，就放进 enExact 而不是 en。
    //
    //   ★ 原因（GPT Q3 原文）：
    //     「生成单数候选后，不要无条件让它参与大范围 token 扩散。」
    //   实测：golds → gold → EN_TOKEN2TAGS['gold'] = 121 个 + EN_PREF 子串 51 个 = 179 条噪音
    //
    //   ★★ 处理：这些片段单独走，只做 3a 精确匹配，不进 3b/3c/A3。
    var exactFrags = (f.enExact || []).slice();
    var exactOnly = {};                     // 供英文通道判断「这个片段只准精确匹配」
    if (exactFrags.length) {
      var _exSeen = {};
      for (var _exi = 0; _exi < frags.length; _exi++) _exSeen[frags[_exi]] = 1;
      for (var _exj = 0; _exj < exactFrags.length; _exj++) {
        if (_exSeen[exactFrags[_exj]]) continue;
        _exSeen[exactFrags[_exj]] = 1;
        frags.push(exactFrags[_exj]);
        exactOnly[exactFrags[_exj]] = 1;
      }
    }
    // ★ A4 同音/形近字归一化：归一化后再切一批，与原片段合并（原输入保留）
    if (opt.useHomo !== false && root.normHomophone) {
      var nt = root.normHomophone(text);
      if (nt !== text) {
        var f2 = this.cut(nt);
        var seenF = {};
        var merged = [];
        for (var fi0 = 0; fi0 < frags.length; fi0++) {
          if (!seenF[frags[fi0]]) { seenF[frags[fi0]] = 1; merged.push(frags[fi0]); }
        }
        var more = f2.zh.concat(f2.en);
        for (var fi1 = 0; fi1 < more.length; fi1++) {
          if (!seenF[more[fi1]]) { seenF[more[fi1]] = 1; merged.push(more[fi1]); }
        }
        frags = merged;
      }
    }
    // ★ B2 单字键：切片补上「映射表里真实存在的单字」（引擎原本切不出单字）
    if (opt.useSingle !== false) {
      var seenS = {};
      var base2 = [];
      for (var fi2 = 0; fi2 < frags.length; fi2++) { seenS[frags[fi2]] = 1; base2.push(frags[fi2]); }
      var zruns = String(text || '').match(/[\u4e00-\u9fff]+/g) || [];
      for (var zr = 0; zr < zruns.length; zr++) {
        for (var zc = 0; zc < zruns[zr].length; zc++) {
          var ch1 = zruns[zr].charAt(zc);
          if (!seenS[ch1] && this.SYN[ch1]) { seenS[ch1] = 1; base2.push(ch1); }
        }
      }
      frags = base2;
    }
    // ★ B1 通用修饰词片段：颜色/数量/方位/大小/程度 —— 实测 443 候选 0 命中，直接丢弃
    // ★★★ 2026-10-23 修 bug：加了单字/颜色键之后，这个丢弃规则会把【真实的键】也丢掉
    //   实证：「黑白」两个字都在 MOD_CHARS 里 → 整段被丢 → SYN['黑白'] 永远读不到
    //        monochrome「单色图」在词库里、键也在，但用户搜「黑白」就是搜不到
    //   修法：只要这个片段在映射表里【有键】，就不丢 —— 它是用户真实会说的词，不是噪音
    var MODCH = MOD_CHARS;
    var fragsKept = [];
    for (var fk = 0; fk < frags.length; fk++) {
      var ff = frags[fk];
      if (ff.length >= 2 && ff.length <= 3 && /^[\u4e00-\u9fff]+$/.test(ff)
          && opt.useModDrop !== false && !this.SYN[ff]) {
        var allMod = true;
        for (var fc = 0; fc < ff.length; fc++) {
          if (MODCH.indexOf(ff.charAt(fc)) < 0) { allMod = false; break; }
        }
        if (allMod) continue;   // 纯修饰词片段且【映射表里没有这个键】→ 丢弃
      }
      fragsKept.push(ff);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  ★★★ 词典驱动的最长词扫描（2026-10-23，采纳 GPT 架构建议）
    //
    //  根因：cut() 的滑窗只切固定长度（实测 5 字），映射表里更长的键
    //        永远不会作为片段出现，等于白建。
    //  实证：加了键「胸罩滑到胸下」→ bra_lift，但永远命中不了，
    //        因为 cut 只产出 5 字窗口，而另一个标签用「胸」占了区间。
    //
    //  做法：用词典本身做一次最长匹配扫描 ——
    //    ① 建首字索引（避免 76,000 个键全扫）
    //    ② 从每个位置出发，找以该字开头的所有已知键，命中就记一个片段
    //    ③ 合并进 frags（去重）
    //  性能：索引只在第一次 match 时构建一次；每次查询的候选量
    //        取决于文本里出现的首字种类，通常是个位数。
    // ══════════════════════════════════════════════════════════════════════
    if (opt.useDictScan !== false && text) {
      if (!this._dictIdx) {
        var _idx = {};
        for (var _dk in this.SYN) {
          if (_dk.length < 3) continue;                    // 3 字以下交给滑窗
          if (!/^[\u4e00-\u9fff]+$/.test(_dk)) continue;    // 只索引纯中文键
          var _c0 = _dk.charAt(0);
          (_idx[_c0] = _idx[_c0] || []).push(_dk);
        }
        for (var _ik in _idx) _idx[_ik].sort(function (a, b) { return b.length - a.length; });
        this._dictIdx = _idx;
      }
      var _txt = String(text);
      var _seenD = {};
      for (var _s1 = 0; _s1 < frags.length; _s1++) _seenD[frags[_s1]] = 1;
      for (var _p1 = 0; _p1 < _txt.length; _p1++) {
        var _bucket = this._dictIdx[_txt.charAt(_p1)];
        if (!_bucket) continue;
        for (var _b1 = 0; _b1 < _bucket.length; _b1++) {
          var _key = _bucket[_b1];
          if (_key.length > _txt.length - _p1) continue;
          if (_txt.substr(_p1, _key.length) === _key && !_seenD[_key]) {
            _seenD[_key] = 1;
            frags.push(_key);
          }
        }
      }
    }
    var hits = {};          // en → 候选
    var hitTotal = 0;       // ★ 已生成的候选总数（用于判断某片段是否零命中）
    var fuzzyBudget = (opt.fuzzyBudget != null) ? opt.fuzzyBudget : 4000;  // ★ 整场模糊扫描总预算（实测 4000 性价比最高）
    var fuzzyMin = (opt.fuzzyMin != null) ? opt.fuzzyMin : 2;              // ★ 模糊匹配最小片段长度
    var self = this;

    // ★ 长片段命中集合：输入里长度 >= 4 且确实能命中的片段
    //   用于「长片段优先降级」：短片段命中的不相干标签要给长片段让位
    //   例：「白色」⊂「白色内裤」→ 「白色」命中的 white_theme 降级
    //   ★ 只收录【确实命中】的长片段，避免空降级
    var LONG_FRAG_HIT = null;
    (function () {
      var longOnes = null;
      for (var _lfi = 0; _lfi < frags.length; _lfi++) {
        var _lf = frags[_lfi];
        if (_lf.length < 4) continue;
        // ★ 只收录【映射表里确实有这个词】的长片段
        //   原因：滑窗会产出大量无意义长串，它们"命中"只是偶然。
        //         只有映射表承认的词，才能用来判定「短片段是跨界假片段」。
        //   例：「成熟女性」是映射表键 → 可用来判定「熟女」是跨界假片段
        //       「插入肛门」不是映射表键 → 不能用来降级「肛门」
        if (self.SYN && self.SYN[_lf]) { (longOnes = longOnes || {})[_lf] = 1; }
      }
      if (longOnes) {
        for (var _lk in longOnes) {
          if (_lk.length >= 4) { LONG_FRAG_HIT = longOnes; break; }
        }
      }
    })();

    function add(en, frag, src, score) {
      if (!en) return;
      var cur = hits[en];
      // ★ 同分同通道时，优先保留【更长的片段】
      //   问题实测：搜「微笑」时同义通道对 smile 产生两个候选片段
      //     「微笑」（2字，等于中文名，本该 loc=4 最高分）
      //     「笑」  （1字，滑窗产物）
      //   两者 score 都是 10、src 都是同义，旧逻辑用「后者覆盖前者」，
      //   结果 smile 的代表片段变成「笑」，在 autoPicks 里输给 laughing，
      //   更让 micro「微小化」靠单字「微」抢走整句。
      //   修法：同分同通道时比较片段长度，长的留下。
      var _better = false;
      if (!cur) _better = true;
      else if (score > cur.score) _better = true;
      else if (score === cur.score) {
        if (src === '同义' && cur.src !== '同义') _better = true;
        else if (src === cur.src && frag && cur.frag && frag.length > cur.frag.length) _better = true;
      }
      if (_better) {
        if (!cur) hitTotal++;   // ★ 只有新增候选才计数
        var _pf = cur && cur.frags ? cur.frags : {};
        if (frag) _pf[frag] = 1;
        // ★★★ 2026-10-30 新增 derivation 字段（按 GPT 核验意见）
        //
        //  用途：priority 需要区分「原文直接命中」和「推断出来」。
        //  GPT 明确说：
        //    「direct_exact 必须由来源路径决定，不能只靠 原文.indexOf(frag) 决定。
        //      否则会把推断出来、但碰巧在原文中找到相同子串的来源误判成 exact。」
        //
        //  取值：
        //    direct    用户写的原词，直接映射到标签（src='中文'）
        //    synonym   映射表里的同义替换（src='同义'）
        //    inferred  隐含语义推断（src='隐含'）
        //
        //  ★ 只有 direct 和 synonym 算 direct_exact；
        //    inferred 算 direct_inferred。
        hits[en] = {
          en: en, cn: self.EN2CN[en] || '', frag: frag, src: src,
          derivation: (src === '同义') ? 'synonym'
                    : (src === '隐含') ? 'inferred'
                    : 'direct',
          score: score, cat: self.EN2CAT[en] || '', tier: self.EN2TIER[en] || '',
          frags: _pf
        };
      } else if (cur) {
        if (frag) cur.frags[frag] = 1;
      }
    }

    // ★ 编辑距离 ≤1 判定（替换/增删各一个字符）
    function ed1(a, b) {
      var la = a.length, lb = b.length;
      if (la === lb) {
        var diff = 0, firstBad = -1;
        for (var i = 0; i < la; i++) {
          if (a.charAt(i) !== b.charAt(i)) {
            diff++;
            if (firstBad < 0) firstBad = i;
            if (diff > 2) return false;
          }
        }
        if (diff <= 1) return true;
        // ★ Damerau：相邻两字符交换算 1 次（skrit ↔ skirt）
        if (diff === 2 && firstBad >= 0 && firstBad + 1 < la) {
          if (a.charAt(firstBad) === b.charAt(firstBad + 1) &&
              a.charAt(firstBad + 1) === b.charAt(firstBad)) {
            for (var k2 = firstBad + 2; k2 < la; k2++) {
              if (a.charAt(k2) !== b.charAt(k2)) return false;
            }
            return true;
          }
        }
        return false;
      }
      if (la > lb) { var tmp = a; a = b; b = tmp; var t2 = la; la = lb; lb = t2; }
      if (lb - la !== 1) return false;
      var p = 0, q = 0, skipped = false;
      while (p < la && q < lb) {
        if (a.charAt(p) === b.charAt(q)) { p++; q++; }
        else {
          if (skipped) return false;
          skipped = true; q++;
        }
      }
      return true;
    }

    for (var i = 0; i < frags.length; i++) {
      var frag = frags[i];
      var before = hitTotal;   // ★ 本片段开始前的候选数
      // ① 映射表
      if (useSyn && this.SYN[frag]) {
        var se = this.SYN[frag];
        for (var a = 0; a < se.length; a++) add(se[a], frag, '同义', 10);
      }
      // ② 中文名匹配（用 2 字索引缩小范围）
      var cands = null;
      if (frag.length >= 2) {
        var k2 = frag.substr(0, 2);
        cands = this.IDX2[k2];
      }
      if (cands && cands.length > 4000) cands = null;
      if (cands) {
        // ★ A2：2 字片段太宽泛 → 只保留「完全 / 前缀 / 后缀」匹配
        //   a2Mode='head'（默认）只留 完全/前缀；a2Mode='edge' 再加后缀
        var a2m = opt.a2Mode || 'edge';
        var tight2 = (frag.length === 2) && (opt.a2 !== false);
        for (var b = 0; b < cands.length; b++) {
          var cn = cands[b];
          if (cn.indexOf(frag) < 0) continue;
          if (tight2) {
            var isHead = cn.indexOf(frag) === 0;
            var isTail = cn.length > 2 && cn.slice(-2) === frag;
            var isFull = cn === frag;
            if (!(isFull || isHead || (a2m === 'edge' && isTail))) continue;
          }
          var ens = this.CN2EN[cn];
          for (var c2 = 0; c2 < ens.length; c2++) {
            add(ens[c2], frag, '中文', frag.length);
          }
        }
      } else if (frag.length === 1) {
        // ★ 单字：走 IDX1 单字索引（原来遍历 4.8 万个中文名，太慢）
        var lstC = this.IDX1[frag];
        if (lstC) {
          for (var d0 = 0; d0 < lstC.length; d0++) {
            var e1 = this.CN2EN[lstC[d0]];
            if (!e1) continue;
            for (var d = 0; d < e1.length; d++) add(e1[d], frag, '中文', 1);
          }
        }
      }
        // ★ 英文通道：允许大小写混写（原来只允许纯小写 → 用户输入「Long Hair」
        //   或「LONG HAIR」时整条英文通道被跳过，long_hair 之类的标签搜不到。
        //   实测：「long hair」命中 long_hair ✅，「Long Hair」🔴，「LONG HAIR」🔴
        if (/^[A-Za-z0-9_\-]+$/.test(frag)) {
          var fragL = frag.toLowerCase();
          // 3a 标签名精确相等（最高优先）
          var exactEn = this.EN_NAME_LOWER[fragL];
          if (exactEn) add(exactEn, frag, '英文', frag.length + 4);
          // ★★★ 2026-10-30：形态派生片段到此为止
          //   只做 3a 精确匹配，不做 3b/3c 扩散（避免 golds→gold→121 个）
          if (exactOnly[frag]) continue;
          // 3b token 精确相等
          var tlist = this.EN_TOKEN2TAGS[fragL];
          if (tlist) { for (var t1i = 0; t1i < tlist.length; t1i++) add(tlist[t1i], frag, '英文', frag.length); }
          // 3c 子串匹配
          if (frag.length >= 2) {
            var bucket = this.EN_PREF[fragL.substr(0, 2)];
            if (bucket) {
              var seenTag = {};
              for (var b1 = 0; b1 < bucket.length; b1++) {
                var tk3 = bucket[b1];
                if (tk3 === fragL) continue;
                if (tk3.indexOf(fragL) < 0) continue;
                var tags3 = this.EN_TOKEN2TAGS[tk3];
                if (!tags3) continue;
                for (var b2 = 0; b2 < tags3.length; b2++) {
                  if (seenTag[tags3[b2]]) continue;
                  seenTag[tags3[b2]] = 1;
                  add(tags3[b2], frag, '英文', frag.length - 1);
                }
              }
            }
          }
        }
      // ★ A3 英文纠错：只在片段没有精确命中时跑
      //   ★ 2026-10-30：形态派生片段（exactOnly）也跳过 —— 它们只准精确匹配
      if (!exactOnly[frag] &&
          fuzzyBudget > 0 && frag.length >= fuzzyMin &&
          /^[a-z][a-z0-9_]{3,}$/.test(frag) &&
          !this.EN_NAME_LOWER[frag] && !this.EN_TOKEN2TAGS[frag]) {
        var eb = this.EN_PREF[frag.substr(0, 2)] || [];
        var cand2 = eb.slice();
        var alpha = 'abcdefghijklmnopqrstuvwxyz';
        var f0 = frag.charAt(0);
        for (var ai = 0; ai < alpha.length; ai++) {
          if (alpha.charAt(ai) === f0) continue;
          var p2 = alpha.charAt(ai) + frag.charAt(1);
          var b6 = this.EN_PREF[p2];
          if (b6) for (var bb = 0; bb < b6.length; bb++) cand2.push(b6[bb]);
        }
        var edSeen = {};
        for (var ec = 0; ec < cand2.length; ec++) {
          var et = cand2[ec];
          if (edSeen[et]) continue;
          edSeen[et] = 1;
          var lenOk = Math.abs(et.length - frag.length) <= 1;
          var pluralOk = (et === frag + 's' || et + 's' === frag || et === frag + 'es' || et + 'es' === frag);

          // ★★★ 2026-10-30 修：单复数归一化【只返回精确标签】，不展开 token 列表
          //
          //   问题实证：
          //     用户输入 golds → et=gold → pluralOk 成立
          //     → add(EN_TOKEN2TAGS['gold'] 的全部) → 179 个噪音
          //
          //   ★ GPT 核验后的原则（原文）：
          //     「形态纠正只能证明 golds 可能表示 gold，
          //       不能证明它表示所有含 gold token 的标签。」
          //
          //   ★★ 所以：如果 et 是完整标准标签名，只加那一个；否则跳过。
          //     真正的模糊拼写纠错仍走下面的 ed1 分支（不受影响）。
          if (pluralOk) {
            var _exactPl = this.EN_NAME_LOWER[et];
            if (_exactPl) add(_exactPl, frag, '单复数', 0.9);
            continue;
          }

          if (!lenOk) continue;
          if (!ed1(frag, et)) continue;
          var etags = this.EN_TOKEN2TAGS[et];
          if (!etags) continue;
          for (var ee = 0; ee < etags.length; ee++) add(etags[ee], frag, '模糊', 0.8);
          fuzzyBudget--;
          if (fuzzyBudget <= 0) break;
        }
      }
      // ★ A3b 复合英文片段的 token 级纠错（schol_uniform → school_uniform）
      if (fuzzyBudget > 0 && /^[a-z][a-z0-9_\-]{3,}$/.test(frag) && /[_\-]/.test(frag)) {
        var segs = frag.split(/[_\-]+/);
        var fixedSegs = [], anyFixed = false;
        for (var sg = 0; sg < segs.length; sg++) {
          var seg = segs[sg];
          if (!seg) continue;
          if (this.EN_TOKEN2TAGS[seg]) { fixedSegs.push(seg); continue; }
          var fixed = null;
          if (seg.length >= 3) {
            var sgPref = this.EN_PREF[seg.substr(0, 2)] || this.EN_PREF[seg.substr(0, 1)] || [];
            for (var s2 = 0; s2 < sgPref.length; s2++) {
              if (Math.abs(sgPref[s2].length - seg.length) > 1) continue;
              if (ed1(seg, sgPref[s2]) || sgPref[s2] === seg + 's' || sgPref[s2] + 's' === seg) {
                fixed = sgPref[s2]; break;
              }
            }
          }
          if (fixed) { fixedSegs.push(fixed); anyFixed = true; }
          else fixedSegs.push(seg);
        }
        if (anyFixed) {
          var candTags = null;
          for (var fs = 0; fs < fixedSegs.length; fs++) {
            var tl2 = this.EN_TOKEN2TAGS[fixedSegs[fs]];
            if (!tl2) { candTags = null; break; }
            if (candTags === null) candTags = tl2.slice();
            else {
              var inter = [];
              for (var ci2 = 0; ci2 < candTags.length; ci2++) {
                if (tl2.indexOf(candTags[ci2]) >= 0) inter.push(candTags[ci2]);
              }
              candTags = inter;
            }
          }
          if (candTags) for (var ct = 0; ct < candTags.length && fuzzyBudget > 0; ct++) {
            add(candTags[ct], frag, '模糊', 0.9); fuzzyBudget--;
          }
        }
      }
      // ★ ④ 模糊匹配（编辑距离 ≤1）—— 只在该片段【零命中】时才跑，且有整场预算
      if (fuzzyBudget > 0 && hitTotal === before && frag.length >= fuzzyMin && frag.length <= 6 &&
          /^[\u4e00-\u9fff]+$/.test(frag)) {
        // ★ 取片段里各字的索引列表（按大小升序），逐个小到大扫
        var lists = [];
        for (var fi = 0; fi < frag.length; fi++) {
          var lst1 = this.IDX1[frag.charAt(fi)];
          if (lst1 && lst1.length) lists.push(lst1);
        }
        lists.sort(function (x, y) { return x.length - y.length; });
        var fuzzySeen = {};         // 去重
        for (var li = 0; li < lists.length; li++) {
          var L1 = lists[li];
          if (L1.length > 3000) continue;     // 单表过大直接跳过
          if (fuzzyBudget <= 0) break;
          for (var bi = 0; bi < L1.length; bi++) {
            var bn = L1[bi];
            if (fuzzySeen[bn]) continue;
            fuzzySeen[bn] = 1;
            if (Math.abs(bn.length - frag.length) > 1) continue;
            if (bn === frag) continue;
            if (!ed1(bn, frag)) continue;
            var bens = this.CN2EN[bn];
            if (!bens) continue;
            for (var bj = 0; bj < bens.length; bj++) add(bens[bj], frag, '模糊', 1);
          }
          fuzzyBudget -= L1.length;
        }
      }
    }

    // ── 置信度分级 ──
    var cats = {};
    for (var en3 in hits) {
      var v = hits[en3];
      var cnS = stripBrackets(v.cn) || v.cn || '';
      var frag3 = v.frag || '';
      v.ratio = cnS.length ? Math.min(1, frag3.length / cnS.length) : 0;
      var c2 = cnS.replace(PARTICLE_RE, '');
      v.is_prefix = !!frag3 && c2.indexOf(frag3) === 0;
      // ★ 后缀匹配：片段在中文名末尾（如「舌头」→「吐舌头」）
      v.is_suffix = !!frag3 && frag3.length < c2.length && c2.slice(-frag3.length) === frag3;
      v.is_neg = NEG_RE.test(c2);
      var rest = v.is_prefix ? c2.slice(frag3.length) : '!';
      v.tail_ok = !!TAIL_OK[rest];
      // ★ 位置分：完全匹配 4 > 前缀 3 > 后缀 2 > 中间 1（用于排序）
      v.loc = (cnS === frag3) ? 4 : (v.is_prefix ? 3 : (v.is_suffix ? 2 : 1));

      // ══════════════════════════════════════════════════════════════
      //  ★ 置信度分级
      //    同义命中（映射表直接对应）默认最高，但【也必须过片段质量门槛】，
      //    否则单字片段会把不相干的标签顶上来：
      //      「白」→ white_theme「白色主题」（ratio 0.25）
      //      「穿着」→ bewear「穿着熊」（宝可梦）
      // ══════════════════════════════════════════════════════════════
      var edge0 = v.is_prefix || v.is_suffix;
      if (v.src === '同义') {
        // ★ 单字片段且【不是完全匹配中文名】→ 最多 mid
        //   「白」→「白色主题」（中文名不是"白"）降级；
        //   但「伞」→「伞」、「雨」→「雨」中文名就是该字，保持 high
        if (frag3.length === 1 && cnS !== frag3) v.conf = 'mid';
        // ★ 片段只覆盖中文名不到一半 → mid
        //   例：「白」→「白色主题」ratio 0.25 降级
        else if (v.ratio < 0.5) v.conf = 'mid';
        else v.conf = 'high';
      }
      else if (cnS === frag3) v.conf = 'high';
      else if (v.score >= 4) v.conf = 'high';
      else if (v.score === 3) v.conf = 'mid';
      else if (v.score === 2) {
        // ★ 前缀和后缀同等对待（都说明片段贴合中文名的边缘，不是被夹在中间）
        var edge = v.is_prefix || v.is_suffix;
        // ★ B3 动态阈值：2 字片段太宽泛 → 收紧；4 字以上更具体 → 放宽
        var strict = (frag3.length >= 4) ? -0.10 : 0;   // A2 已过滤 2 字中间匹配，这里不再重复惩罚
        if (v.ratio >= (0.6 + strict) && edge && !v.is_neg && (v.tail_ok || v.is_suffix)) v.conf = 'high';
        else if (v.ratio >= (0.4 + strict) && edge && !v.is_neg) v.conf = 'mid';
        else v.conf = 'low';
      } else v.conf = 'low';

      // ══════════════════════════════════════════════════════════════
      //  ★ 弱片段降级：常见纯动词（穿着 / 戴着 / 拿着 …）单独命中时降一级
      //    原因：「穿着」会命中「穿着熊（角色扮演）」这类宝可梦名，
      //          与用户说的"穿着"毫无关系
      // ══════════════════════════════════════════════════════════════
      if (frag3.length >= 2 && frag3.length <= 3) {
        var _ALLWEAK = true;
        for (var _wi = 0; _wi < frag3.length; _wi++) {
          if (WEAK_CHARS.indexOf(frag3.charAt(_wi)) < 0) { _ALLWEAK = false; break; }
        }
        if (_ALLWEAK) {
          v.conf = 'low';    // 纯动词片段（穿着/戴着/拿着）直接沉底
        }
      }

      // ══════════════════════════════════════════════════════════════
      //  ★ 跨词边界假片段降级
      //    中文没有词边界，滑窗会把相邻两个字拼成不存在的词：
      //      「成熟女性」→ 滑窗出「熟女」→ 命中 milf（严重错配）
      //      「成熟女人」→ 同样出「熟女」
      //    判定：既要 ①被更长的命中片段包含，又要 ②在原文中【不在开头】。
      //      ②是关键——「白色内裤」的「白色」在开头，是用户真说的词，不降；
      //               而「成熟女性」的「熟女」在位置 1，是拼出来的假词，降。
      // ══════════════════════════════════════════════════════════════
      if (frag3.length <= 3 && LONG_FRAG_HIT && String(text).indexOf(frag3) > 0) {
        var _covered = false;
        for (var _lf2 in LONG_FRAG_HIT) {
          if (_lf2.length > frag3.length && _lf2.indexOf(frag3) >= 0) { _covered = true; break; }
        }
        if (_covered) {
          // 候选若确实被那个真实长片段命中过 → 不降
          var _frs = v.frags ? Object.keys(v.frags) : [];
          var _hasLong = false;
          for (var _fi3 = 0; _fi3 < _frs.length; _fi3++) {
            if (LONG_FRAG_HIT[_frs[_fi3]]) { _hasLong = true; break; }
          }
          if (!_hasLong) {
            if (v.conf === 'high') v.conf = 'mid';
            else if (v.conf === 'mid') v.conf = 'low';
          }
        }
      }

      v.en_s = en3.toLowerCase();
      (cats[v.cat] = cats[v.cat] || []).push(v);
    }

      // ══════════════════════════════════════════════════════════
      // ★ Tier3 Token 覆盖率加权（只在【关键词式输入】时生效）
      //   条件：所有分段都 <= 6 字 —— 长句描述不受影响，保持最优字段顺序
      //   例：「blue eyes」→ blue_eyes(命中2词) 排在 blue_outline(1词) 前面
      // ══════════════════════════════════════════════════════════
      var _iw = String(text || '').split(/[\s,，、;；。.！!？?\/|]+/).filter(function (x) { return x.length >= 1; });
      var _kwStyle = _iw.length >= 2 && _iw.every(function (x) { return x.length <= 6; });
      if (_kwStyle) {
        for (var _cw in hits) {
          var _cv = hits[_cw];
          var _cf = _cv.frags ? Object.keys(_cv.frags) : (_cv.frag ? [_cv.frag] : []);
          var _cov = {};
          for (var _cfi = 0; _cfi < _cf.length; _cfi++) {
            var _cr = _cf[_cfi];
            if (!_cr) continue;
            for (var _iwi = 0; _iwi < _iw.length; _iwi++) {
              if (!_cov[_iwi] && _iw[_iwi].indexOf(_cr) >= 0) _cov[_iwi] = 1;
            }
          }
          var _covN = Object.keys(_cov).length;
          if (_covN >= 2) _cv.score += _covN * 2;
        }
      }

    // ══════════════════════════════════════════════════════════════
    // ★ ⑤ 隐含标签（Danbooru tag_implications）
    //    只对高置信度候选做；score 0.5（低于任何正常匹配）；有上限
    // ══════════════════════════════════════════════════════════════
    var IMPLT = this.data.IMPLICATIONS || null;
    if (IMPLT && opt.useImpl !== false) {
      var implCap = (opt.implCap != null) ? opt.implCap : 24;
      var implAdded = 0;
      var seeds = [];
      for (var se in hits) {
        var sv = hits[se];
        if (sv.conf === 'high') seeds.push(sv);
      }
      for (var si2 = 0; si2 < seeds.length && implAdded < implCap; si2++) {
        var sd = seeds[si2];
        var cons = IMPLT[sd.en];
        if (!cons) continue;
        for (var sj = 0; sj < cons.length && implAdded < implCap; sj++) {
          var ce = cons[sj];
          if (hits[ce]) continue;                 // 已存在就不加
          if (!self.EN2CN[ce] && !self.CN2EN[ce]) continue;
          var before2 = hitTotal;
          add(ce, sd.frag, '隐含', 0.5);
          if (hitTotal > before2) implAdded++;
        }
      }
      // 隐含出来的候选补做置信度分级
      for (var ie in hits) {
        var iv = hits[ie];
        if (iv.conf !== undefined) continue;
        iv.ratio = 0; iv.loc = 0; iv.is_prefix = false; iv.is_suffix = false;
        iv.en_s = ie.toLowerCase();
        iv.conf = 'low';
        (cats[iv.cat] = cats[iv.cat] || []).push(iv);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // ★ ⑥ L4 语义关联兜底 —— 用【隐含关系扩展】而不是"同小类"
    //    实测：同小类推荐是噪音（子类太大，随机挑的标签无关）
    //    改为：当总候选很少时，沿隐含关系走第 2 跳（隐含的隐含）
    // ══════════════════════════════════════════════════════════════
    if (IMPLT && opt.useAssoc !== false) {
      var totalNow = 0;
      for (var te in hits) totalNow++;
      // 只在候选很少时兜底（阈值默认 12 个）
      var assocThresh = (opt.assocThresh != null) ? opt.assocThresh : 12;
      if (totalNow < assocThresh) {
        var hop2Cap = (opt.hop2Cap != null) ? opt.hop2Cap : 8;
        var hop2 = 0;
        var seed2 = [];
        for (var q1 in hits) {
          var v1 = hits[q1];
          if (v1.conf !== 'high' && v1.src !== '隐含') continue;
          seed2.push(v1);
        }
        for (var r1 = 0; r1 < seed2.length && hop2 < hop2Cap; r1++) {
          var nexts = IMPLT[seed2[r1].en];
          if (!nexts) continue;
          for (var r2 = 0; r2 < nexts.length && hop2 < hop2Cap; r2++) {
            var ce2 = nexts[r2];
            if (hits[ce2]) continue;
            if (!self.EN2CN[ce2] && !self.CN2EN[ce2]) continue;
            var b4 = hitTotal;
            add(ce2, '', '关联', 0.4);
            if (hitTotal > b4) {
              hop2++;
              var nv2 = hits[ce2];
              nv2.ratio = 0; nv2.loc = 0; nv2.is_prefix = false; nv2.is_suffix = false;
              nv2.en_s = ce2.toLowerCase();
              nv2.conf = 'low';
              (cats[nv2.cat] = cats[nv2.cat] || []).push(nv2);
            }
          }
        }
      }
    }

    // ── 排序 + 分级限额 + tier 筛选 ──
    var out = {};
    for (var ci = 0; ci < BIZ.length; ci++) {
      var cat = BIZ[ci];
      var lst = cats[cat];
      if (!lst) continue;
      lst = lst.filter(function (x) {
        if (tier === 'NSFW') return x.tier === 'NSFW' || x.tier === '分级';
        if (tier === 'SFW') return x.tier === 'SFW';
        return true;
      });
      if (!lst.length) continue;
      var rank = { high: 0, mid: 1, low: 2 };
      lst.sort(function (a, b) {
        if (rank[a.conf] !== rank[b.conf]) return rank[a.conf] - rank[b.conf];
        // ★ 同义命中（映射表直接对应）优先，且【片段越长越优先】
        //   原因：「白色内裤」整串命中 white_panties 比「内裤」命中 panties 更精准，
        //         但 white_panties 的中文名「白内裤」不含「白色内裤」→ loc 只有 1，
        //         若只比 loc，整串命中反而排在部分命中后面
        var sa = (a.src === '同义') ? 0 : 1;
        var sb0 = (b.src === '同义') ? 0 : 1;
        if (sa !== sb0) return sa - sb0;
        if (sa === 0) {                                   // 双方都是同义命中 → 比片段长度
          var fa = (a.frag || '').length, fb = (b.frag || '').length;
          if (fa !== fb) return fb - fa;
        }
        if ((b.loc || 0) !== (a.loc || 0)) return (b.loc || 0) - (a.loc || 0);  // ★ 位置分
        if (b.ratio !== a.ratio) return b.ratio - a.ratio;
        if (b.score !== a.score) return b.score - a.score;
        return a.en_s < b.en_s ? -1 : a.en_s > b.en_s ? 1 : 0;
      });
      // ★ 分级限额（mid 8→12 · low 5→8）：实测可提升召回，候选量仍在可控范围
      var miCap = (opt.midCap != null) ? opt.midCap : 30;
      var loCap = (opt.lowCap != null) ? opt.lowCap : 20;
      var hi = lst.filter(function (x) { return x.conf === 'high'; });
      // ★★★ 2026-10-23 修 L3：同义直接命中的候选不受 perCat 截断
      //   盲测归因发现 30 个漏项死在这里：
      //     「拿着咖啡杯」→ cup「杯子」，键「杯子」明明存在，
      //     但被 perCat=48 的总额度挤出了候选区。
      //   理由：src==='同义' 意味着「用户说的这个词，映射表里就写着这个标签」，
      //         这是最可靠的命中，不该因为同字段里别的噪音多就被丢掉。
      //   做法：先保留全部高置信，再用 perCat 限制 mid/low 的数量。
      var synHi = hi.filter(function (x) { return x.src === '同义'; });
      var otherHi = hi.filter(function (x) { return x.src !== '同义'; });
      var mi = lst.filter(function (x) { return x.conf === 'mid'; }).slice(0, miCap);
      var lo = lst.filter(function (x) { return x.conf === 'low'; }).slice(0, loCap);
      var budget = Math.max(0, perCat - synHi.length);
      var kept = synHi.concat(otherHi, mi, lo).slice(0, synHi.length + budget);
      if (kept.length) out[cat] = kept;
    }
    this.lastMs = (root.performance || Date).now() - t0;
    return out;
  };

  // ── 中文含义 ──
  // ══════════════════════════════════════════════════════════════════════
  //  ★ 精准自动勾选（autoPicks）
  //    原则：每个输入概念只自动勾【命中最精准的那一个】标签
  //          其余候选保留给用户人工挑选，不自动勾选
  //    原因：一个词会命中大量同类变体（内裤→panties/wet_panties/white_panties…）
  //          全部自动勾上会造成提示词污染与互相矛盾（long_hair + medium_hair）
  //
  //    算法：
  //      ① 收集全部候选，按【候选质量】排序
  //         质量：映射表同义 > 片段等于中文名 > 高置信 > 位置分 > 匹配比例
  //      ② 依次尝试：该候选的片段与已占用的原文区间不重叠 → 采纳
  //      ③ 同一标签只采纳一次
  //
  //    参数：
  //      opt.allowed  可选，只允许从中挑选的标签集合（用于保证「所见即所得」）
  //                   传入界面实际显示的标签集合，避免自动勾选了看不见的标签
  //
  //    返回：{ 标签名: 1, ... }
  // ══════════════════════════════════════════════════════════════════════
  Engine.prototype.autoPicks = function (text, opt) {
    opt = opt || {};
    var txt = String(text || '');
    var r = this.match(txt, opt);
    var allowed = opt.allowed || null;

    // ── 片段定位工具（先定义，打分要用）──

    // ③ 片段在原文中的连续出现位置
    function spansOf(f) {
      var out = [], p = 0;
      while (true) {
        var k = txt.indexOf(f, p);
        if (k < 0) break;
        out.push([k, k + f.length]);
        p = k + 1;
      }
      return out;
    }

    // ★★ 跳跃定位（gap-aware）
    //   根因：「被射在脸上」的片段是「射脸上」（cut 去掉了停词「在」），
    //        连续 indexOf 永远找不到，导致 facial「颜射」这个最精准的候选被丢弃，
    //        反而勾上 in_the_face「面部受击」。
    //   做法：按字符顺序在原文里找，允许中间夹字符（最多 2 个）。
    //        返回真实覆盖区间，供后续按「覆盖原文长度」评分。
    //   例：「射脸上」在「被射在脸上」→ [1,5]，覆盖 4 字（中间夹了「在」）
    //   限制：跳跃数 ≤2，避免跨度失控去占别人的区间。
    function spansOfGap(f) {
      var sps = spansOf(f);
      if (sps.length) return sps;
      var n = f.length;
      // ★★★ 2026-10-23 修 bug：原来 n<3 直接放弃跳跃定位，
      //   导致「闭眼」在「闭着眼」里永远定位不到 → closed_eyes 丢失。
      //   中文里「V着N」「V了N」「A的N」这类单字插入极其常见，
      //   实测「闭着眼」「喝着水」「抱着猫」「摸着头发」全部漏召回。
      //   新规则：2 字片段允许跳过 1 个字；3 字以上仍允许跳 2 个。
      //   ★ 2 字只跳 1 个是刻意收紧 —— 避免「白色」匹配到「白天色」之类的误伤。
      if (n < 2) return [];
      var maxGap = (n === 2) ? 1 : 2;
      var out = [];
      for (var st = 0; st < txt.length; st++) {
        if (txt.charAt(st) !== f.charAt(0)) continue;
        var ti = st, gaps = 0, okAll = true;
        for (var fi = 1; fi < n; fi++) {
          var ch = f.charAt(fi);
          var j = ti + 1;
          var skipped = 0;
          while (j < txt.length && txt.charAt(j) !== ch) { j++; skipped++; }
          if (j >= txt.length || skipped > maxGap) { okAll = false; break; }
          gaps += skipped;
          ti = j;
        }
        if (!okAll || gaps > maxGap) continue;
        var sp = [st, ti + 1];
        var dup = false;
        for (var q2 = 0; q2 < out.length; q2++) {
          if (out[q2][0] === sp[0] && out[q2][1] === sp[1]) { dup = true; break; }
        }
        if (!dup) out.push(sp);
        if (out.length >= 4) break;
      }
      return out;
    }

    // ★★ 否定前缀检测
    //   问题实测（2026-10-22）：中文否定词被完全忽略，导致语义反向。
    //     「不穿内裤」→ putting_on_panties「穿内裤」
    //     「不戴眼镜」→ putting_on_eyewear「戴眼镜」
    //     「不笑」    → laughing「大笑」
    //     「没有射精」→ ejaculation「射精」
    //   用户说「不穿内裤的女生」却拿到「穿内裤」标签，出图完全相反。
    //   做法：片段在原文里的起点若紧邻否定词，就判为否定命中。
    //   后续处理：优先找该标签的否定形式（no_xxx / xxx_removed / not_xxx），
    //            找不到就直接跳过这个候选 —— 宁可不勾，绝不能勾反。
    //   ★ 「无」不列入否定词：中文「无码」「无袖」是独立词，不是否定式。
    var NEG_WORDS = ['没有', '不是', '不要', '不', '没', '未', '别', '非'];
    // 否定词与片段之间允许夹的「轻动词」：不【穿】内裤、不【戴】眼镜、不【露】乳头
    // ★ 只允许这些字，避免「不断」「不同」这类词被误判成否定
    var NEG_LIGHT = '穿戴露带用做来去要有是在着过起下出进上回拿脱去';
    function negatedAt(sp) {
      // ★★★ 2026-10-23 双重否定支持
      //   中文里「不是没有穿内裤」= 穿了内裤，但原来的实现只判断「前方有没有否定词」，
      //   见到「不是」就判否 → 输出 no_panties，语义完全反了。
      //   做法：在片段之前的一段窗口内【数否定词个数】，奇数=否定，偶数=肯定。
      //   窗口取 6 字，够覆盖「不是没有」「不算是没」这类双层结构。
      //   单层否定（「不穿内裤」1 个）→ 仍然判否，行为不变。
      var winStart = Math.max(0, sp[0] - 6);
      var pre = txt.substring(winStart, sp[0]);
      var negCount = 0;
      // 从长到短匹配，避免「不」抢走「不是」的位置
      var sorted = NEG_WORDS.slice().sort(function (a, b) { return b.length - a.length; });
      var pos = 0;
      while (pos < pre.length) {
        var matched = null;
        for (var si = 0; si < sorted.length; si++) {
          if (pre.substr(pos, sorted[si].length) === sorted[si]) { matched = sorted[si]; break; }
        }
        if (matched) { negCount++; pos += matched.length; }
        else pos++;
      }
      // ① 否定词紧贴片段（原逻辑保留，作为快速通道）
      var tight = false;
      for (var i = 0; i < NEG_WORDS.length; i++) {
        var nw = NEG_WORDS[i];
        var st = sp[0] - nw.length;
        if (st >= 0 && txt.substring(st, sp[0]) === nw) { tight = true; break; }
      }
      // ② 否定词 + 1~2 个轻动词 + 片段
      //    例：「不穿内裤」的片段「内裤」前面是「不穿」
      //        「没有戴帽子」的片段「帽子」前面是「没有戴」
      if (!tight) {
        for (var back = 2; back <= 4; back++) {
          var s0 = sp[0] - back;
          if (s0 < 0) continue;
          var seg = txt.substring(s0, sp[0]);
          for (var k = 0; k < NEG_WORDS.length; k++) {
            var w = NEG_WORDS[k];
            if (seg.indexOf(w) !== 0) continue;
            var mid = seg.substring(w.length);
            if (!mid.length || mid.length > 2) continue;
            var allLight = true;
            for (var j = 0; j < mid.length; j++) {
              if (NEG_LIGHT.indexOf(mid.charAt(j)) < 0) { allLight = false; break; }
            }
            if (allLight) { tight = true; break; }
          }
          if (tight) break;
        }
      }
      if (!tight) return false;
      // ③ 有否定结构时用计数决定：偶数个否定 = 肯定
      return (negCount % 2) === 1;
    }
    // 找否定形式标签（返回 null 表示库里没有）
    var _libNames = null;
    function negFormOf(en) {
      if (!_libNames) {
        _libNames = {};
        var _L = this.data && this.data.LIB;
        if (_L && _L.n) for (var _i = 0; _i < _L.n.length; _i++) _libNames[_L.n[_i]] = 1;
      }
      var cands = ['no_' + en, en + '_removed', 'not_' + en, en + '_off'];
      for (var i = 0; i < cands.length; i++) {
        if (_libNames[cands[i]]) return cands[i];
      }
      return null;
    }

    // ★★★ 单字键策略（2026-10-23 采纳 GPT 架构建议，第二版）
    //   第一版是「allow/block 手工列表」，不可持续 —— 每加一个字要手写几十条。
    //   GPT 指出的更干净规则：
    //     · 用户【完整查询】就是这一个字 → 允许自动勾选（这是明确意图）
    //     · 长文本里裸单字作为子串 → 只进候选，不自动勾选（永不污染）
    //     · 强构式（手部特写/双手遮住胸口）→ 片段本身就是多字键，走不到这里
    //   这样一次性消灭所有 allow/block 配置，且「手」「白」不再污染长描述。
    //   代价：用户搜「手」时要自己点一下 —— 但搜「手」本来就是探索性操作。
    // ★★★ 危险单字表（2026-10-23 第三版）
    //   只有这些字在长文本里不自动勾 —— 它们是修饰性/构词性的，单看无意义。
    //   其余单字（风/雪/云/书/雨/猫…）都是实义名词，长句里也该勾。
    //
    //   实证：之前「所有单字在长文本里都不勾」，
    //        结果「风把她的长裙和头发吹起来」漏了 wind（frag 就是「风」，high 置信），
    //        「她裹着围巾坐在长椅上喂鸽子，旁边堆着雪」漏了 snow。
    //   而这些才是真的该拦：单搜「手」出「手部特写」，长句里「拿着书」不该出手部特写。
    var DANGER_SINGLE = {
      '手': 1, '白': 1, '黑': 1, '点': 1, '微': 1, '黄': 1, '红': 1, '蓝': 1,
      '一': 1, '二': 1, '三': 1, '两': 1, '半': 1, '多': 1, '少': 1,
      '大': 1, '小': 1, '高': 1, '矮': 1, '长': 1, '短': 1, '粗': 1, '细': 1,
      '上': 1, '下': 1, '左': 1, '右': 1, '前': 1, '后': 1, '内': 1, '外': 1,
      '光': 1, '暗': 1, '亮': 1, '深': 1, '浅': 1, '干': 1, '湿': 1,
      '穿': 1, '戴': 1, '拿': 1, '抱': 1, '放': 1, '坐': 1, '站': 1, '躺': 1,
      '身': 1, '体': 1, '脸': 1, '眼': 1, '口': 1, '脚': 1, '腿': 1, '臂': 1
    };
    var _CHAR2KEYS = this.CHAR2KEYS || Object.create(null);
    function singleCharAllowed(frag, sp) {
      var raw = String(text || '').trim();
      var plain = raw.replace(/[\s，。,\.！!？?、；;：:]+/g, '');
      // ① 整个查询就是这个字 → 一律允许（用户明确在搜这个字）
      if (plain === frag) return true;
      // ★★★ 2026-10-23 第四版：根本规则 —— 「被更长键包含时不许单独触发」
      //   问题实证（比黑名单可靠得多）：
      //     「内裤」→ 单字「裤」触发 pants「裤子」        （内裤 ≠ 裤子）
      //     「比基尼」→ 单字「尼」触发 buddhist_nun「尼姑」（比基尼 ≠ 尼姑）
      //     「巨乳」→ 单字「乳」触发 breasts「胸部」      （巨乳已经更精确）
      //   判据：文本里存在一个【更长的键】包含这个单字，并且它也被切出来了
      //        → 这个单字是那个词的一部分，不是独立概念，不许自动勾。
      //   反例（该允许）：「风把她的长裙吹起来」里「风」没有被更长的键包含
      //                   → 它是独立的词，应该允许。
      var _plainAll = String(text);
      // ★★★ 2026-10-30 性能修复：用字符倒排索引代替全表扫描
      //
      //  问题：原来是 `for (var _k in _SYNREF)` 遍历全部 76,434 个键，
      //        对每个单字候选都跑一遍。
      //        超长句（60 字）有几十个单字片段 → 几百万次 indexOf。
      //
      //  CPU profile 实测：singleCharAllowed 占 autoPicks 总耗时的 77.7%，
      //  超长句单次 164 ms。
      //
      //  修法：构造 Engine 时建 CHAR2KEYS 索引（单字 → 含该字的键列表），
      //        运行时只遍历含该字的键（通常几百个，不是 7 万）。
      //  判断逻辑一字未改，只是换了遍历范围。
      var _cand = _CHAR2KEYS[frag];
      if (_cand) {
        for (var _ci2 = 0; _ci2 < _cand.length; _ci2++) {
          var _k = _cand[_ci2];
          if (_k.length <= 1) continue;
          if (_plainAll.indexOf(_k) >= 0) return false;
        }
      }
      // ② 在危险表里 → 长文本里不自动勾
      if (DANGER_SINGLE[frag]) return false;
      // ③ 其余实义单字允许
      return true;
    }

    // ① 全部候选 + 质量分
    var cands = [];
    for (var c in r) {
      var lst = r[c] || [];
      for (var i = 0; i < lst.length; i++) {
        var v = lst[i];
        if (!v.frag) continue;
        if (v.conf !== 'high' && v.conf !== 'mid') continue;   // 低置信不自动勾
        if (allowed && !allowed[v.en]) continue;               // ★ 只要界面可见的
        // ★★★ 2026-10-27：自动勾选也要过滤噪音候选
        //   isCharNoise 原来只在 grouped()（界面分组）里调用，
        //   autoPicks 完全没过滤 → 界面已隐藏的垃圾照样被自动勾上。
        //   ★ 只过滤 isCharNoise 已判定的噪音，不新增启发式。
        if (isCharNoise(v)) continue;
        // ★ 先定位，定位不到的候选直接跳过（原本就是这样，行为不变）
        var sps0 = spansOfGap(v.frag);
        if (!sps0.length) continue;
        // ★★★ 2026-10-23 修精度：否定形式标签只在真有否定时才自动勾
        //   问题实证：「戴耳机闭着眼听歌」会勾上 headset_removed「摘下耳机」。
        //   原因：「耳机」是「摘下耳机」的后缀，中文名二次匹配给了 mid 置信，
        //         于是 headset_removed 被当成普通候选勾上了。
        //   判据：标签名形如 no_* / *_removed / not_* / *_off 时，
        //         只有原文确实出现了否定词才允许自动勾。
        //   这比逐个加黑名单可靠 —— 库里 197 个否定形式标签一次覆盖。
        if (/^(no_|not_)|(_removed|_off)$/.test(v.en)) {
          // ★ 否定判定要看两处：
          //   ① 片段之前有没有否定词（「不」+「戴眼镜」）
          //   ② 片段本身是否就含否定词（键「不戴眼镜」整条命中 monocle_removed）
          var _hasNeg = false;
          for (var _nw = 0; _nw < NEG_WORDS.length; _nw++) {
            if (v.frag.indexOf(NEG_WORDS[_nw]) === 0) { _hasNeg = true; break; }
          }
          if (!_hasNeg && !negatedAt(sps0[0])) {
            // 没有否定却出现了否定形式标签 → 跳过
            continue;
          }
        }
        // ★★★ 单字键条件触发：长句里的裸单字不自动勾
        if (v.frag.length === 1 && !singleCharAllowed(v.frag, sps0[0])) continue;
        // ★★ 否定前缀：被否定的候选不直接勾，改成找它的否定形式标签
        //   例：「不穿内裤」里片段「穿内裤」紧跟「不穿」→ 判否
        //        库里有 no_panties → 改勾 no_panties（这才是用户要的）
        //        库里没有对应否定标签 → 整个跳过（宁可不勾，绝不勾反）
        //   ★ 片段自身包含否定词时不受影响，
        //     所以「没穿内裤」这种整串是映射表键的正常命中。
        //   ★ 标签本身是否定形式（no_xxx / xxx_removed / not_xxx）时也放过。
        if (negatedAt(sps0[0]) &&
            !/^(no_|not_)/.test(v.en) && !/_removed$/.test(v.en) && !/_off$/.test(v.en)) {
          var _nf = negFormOf.call(this, v.en);
          if (!_nf) continue;                   // 无否定形式 → 跳过
          if (allowed && !allowed[_nf]) continue; // 否定形式不在界面候选里 → 也跳过
          cands.push({
            en: _nf, cat: c, frag: v.frag,
            q: 1000000 + 100000 + (sps0[0][1] - sps0[0][0]) * 5000 + 5000,
            sps: sps0, negAlt: 1
          });
          continue;
        }
        // ★ 用「覆盖原文的字符数」而不是「片段长度」来评分
        //   原因：「射脸上」跳过后覆盖 4 字（射在脸上），比「在脸上」覆盖 3 字更完整
        var cover = sps0[0][1] - sps0[0][0];
        var q = 0;
        if (v.src === '同义') q += 1000000;                   // 映射表命中：最精准
        // ★ 置信度必须高于「片段等于中文名」的加成
        //   反例：「成熟女性」里 milf 靠 loc=4 反超了 conf=high 的 mature_female
        if (v.conf === 'high') q += 100000;
        // ★ 覆盖长度是精准度的核心指标：
        //   「白色内裤」整串命中 white_panties 比「内裤」命中 panties 更合用户意图
        q += cover * 5000;
        if ((v.loc || 0) === 4) q += 3000;                    // 片段等于中文名
        q += (v.loc || 0) * 100;                              // 位置分 1~4
        q += Math.round((v.ratio || 0) * 50);                 // 匹配比例
        // ★★★ 2026-10-24 新增：同义键内部的「首选」优先
        //   问题实证（隐藏集 v2 诊断）：一个中文键指向多个同义标签时，
        //   autoPicks 会因为 match() 的字母序而挑到非首选的那个，甚至勾上多个。
        //     「丁字裤」= [thong, g-string, t-back, tanga_panties, tanga, ...]
        //       实际勾了 t-back + tanga（两个同义词，提示词里概念重复）
        //     「丸子头」= [hair_bun, bun]  → 勾了 bun（非首选）
        //     「露肩」  = [bare_shoulders, off_shoulder, shoulder_peek]
        //       → 勾了 bare_shoulders + shoulder_peek
        // ★★★ 2026-10-24 记录：尝试过「同义键首选优先」规则，已回滚
        //
        //  问题：一个中文键指向多个同义标签时，autoPicks 会勾到非首选的，
        //        甚至勾上多个（「露肩」→ bare_shoulders + shoulder_peek）。
        //        全库有 4,173 个键（5.5%）指向 ≥2 个标签。
        //
        //  试过的做法：按标签在 SYN[key] 数组里的位置给递减奖励（第 0 个最高）。
        //  第一次用 (6-pos)*5000（最高 30000）：
        //    v2 召回 67.2% → 66.4%，对抗集 36→34，并列40 40→39  ← 全面变差
        //  第二次改用 (6-pos) 也就是 6~1 分（纯打平局用）：
        //    v2 召回 67.2% → 68.1%，但对抗集 36→35、并列40 40→39  ← 仍有回归
        //    具体原因：「水手服」的数组是 [serafuku, ..., sailor_uniform, ...]，
        //    奖励让 serafuku 排第一，但 serafuku 是日文说法、sailor_uniform 是英文对应，
        //    两者都对，属于等价替换的噪声，不值得为它破坏测试。
        //
        //  ★ 现在的做法：不再用「数组位置」这种隐含顺序，
        //    改用 GPT 逐组标注的真实首选（window.SYN_LABELS.p）。
        //    见下面的 +1 奖励 —— 只用来打破完全同分的僵局，不改动任何量级关系。
        if (v.src === '同义') {
          var SL = (typeof window !== 'undefined' ? window.SYN_LABELS : null) || this.SYN_LABELS;
          if (SL && SL.p) {
            var _pref = SL.p[v.frag];
            if (_pref && _pref === v.en) q += 1;
          }
        }
        cands.push({ en: v.en, cat: c, frag: v.frag, q: q, sps: sps0, synHigh: (v.src === '同义' && v.conf === 'high') });
      }
    }

    // ② 质量降序（同分保持 match() 的原始顺序 → 稳定）
    //
    //  ★★★ 2026-10-24 记录：尝试过「具体优先」规则（GPT 建议的 C 方案），已回滚
    //
    //  试过的做法：同片段时，若 A 的英文名包含 B，就给 A 加 200,000 分。
    //  实测结果（失败）：
    //    对抗集    36/37 → 28/37
    //    并列短语   18/18 → 11/18
    //    「巨乳」  large_breasts → alternate_breast_size_(larger)
    //    「黑色过膝袜」black_thighhighs → socks_over_kneehighs
    //  原因是「英文名包含」这个判据太宽松：
    //    alternate_breast_size_(larger) 含 breast → 被误判为 breasts 的下位词
    //    socks_over_kneehighs 含 kneehighs → 被误判为更具体
    //  收益只有 +0.9% 召回，破坏却是大面积回归，所以回滚。
    //
    //  ★ 上义词替代的正确修法应该是「按中文名的语义包含关系」而不是「英文名子串」，
    //    这需要更严谨的语义判定（可能要 GPT 逐条标注父子关系），留待后续。
    //    当前只保留 isCharNoise 的放宽（那条带来 +2.0% 且回归全绿）。
    cands.sort(function (a, b) { return b.q - a.q; });

    var taken = [], usedTag = {}, picks = {}, synExtra = {};
    function overlaps(sp) {
      for (var i = 0; i < taken.length; i++) {
        if (sp[0] < taken[i][1] && taken[i][0] < sp[1]) return true;
      }
      return false;
    }
    // ★ 材质标签豁免：让「透明比基尼」这类复合标签旁边能同时带上材质标签
    //   原因：SD 对复合标签的理解弱，单靠 transparent_bikini 常画不出透明效果，
    //        需要 see-through / transparent 这类材质词单独强化。
    //   实测：用户输入「少女穿着透明比基尼」，只给 transparent_bikini 时出图无透明感。
    //   限制：① 只在材质白名单内 ② 同一片段最多额外带 1 个材质标签
    var MATERIAL = {
      transparent: 1, 'see-through': 1, 'semi-transparent': 1, sheer: 1, translucent: 1,
      lace: 1, fishnet: 1, wet: 1, 'wet_clothes': 1, oiled: 1, glistening: 1,
      shiny: 1, latex: 1, leather: 1, mesh: 1, glossy: 1
    };
    var matUsed = {};
    function spanKey(sp) { return sp[0] + ':' + sp[1]; }

    // ══════════════════════════════════════════════════════════════════════
    //  ★★★ 概念组（2026-10-23 采纳 GPT 架构建议）
    //    核心思想：判断两个候选「是否表达可并存的语义维度」，
    //              而不是简单地「区间重叠就互相排斥」。
    //      同组 = 同一维度上的竞争 → 只选一个
    //        red_hair / black_hair 都是 hair_color，不能同时出
    //      异组 = 不同维度 → 可以共存
    //        red_hair(颜色) + long_hair(长度) + ponytail(发型) 三个都该出
    //    实证问题：「黑发长发双马尾」以前只能出 1~2 个。
    //    返回 null 表示没有归类，交给原有规则判断。
    // ══════════════════════════════════════════════════════════════════════
    var CG_COLOR = 'red|black|blonde|white|blue|green|pink|purple|brown|grey|gray|silver|orange|aqua|multicolored|two-tone';
    var CG_ALL = '_';
    // ★★★ 2026-10-30 性能修复：把 4 个 new RegExp 预编译成常量
    //
    //  问题：conceptGroup() 里原来写的是
    //          if (new RegExp('^(' + CG_COLOR + ')_hair$').test(e)) ...
    //        CG_COLOR 是 119 字符的模式串，每次调用都重新编译。
    //
    //  实测（超长句 60 字，584 个候选）：
    //        conceptGroup 被调用约 3000 次 × 4 个正则 = 约 12,000 次编译
    //        autoPicks 单句 170 ms，其中绝大部分是这一项
    //
    //  修法：模块级预编译，只编译一次。判断逻辑一字未改。
    var RE_CG_HAIR = new RegExp('^(' + CG_COLOR + ')_hair$');
    var RE_CG_EYES = new RegExp('^(' + CG_COLOR + ')_eyes$');
    var RE_CG_LEGWEAR = new RegExp('^(' + CG_COLOR + ')_(thighhighs|pantyhose|socks|kneehighs)$');
    var RE_CG_UNDERWEAR = new RegExp('^(' + CG_COLOR + ')_(panties|thong|bikini|bra|lingerie)$');
    function conceptGroup(en) {
      var e = String(en).toLowerCase();
      if (/^(long_hair|short_hair|medium_hair|absurdly_long_hair|very_long_hair|cropped_hair|very_short_hair|alternate_hair_length_\(shorter\)|alternate_hair_length_\(longer\))$/.test(e)) return 'hair_length';
      if (RE_CG_HAIR.test(e)) return 'hair_color';
      if (/^(ponytail|twintails|braid|twin_braids|drill_hair|hair_bun|double_bun|side_ponytail|hime_cut|bob_cut|ahoge|hair_intakes|hair_over_one_eye|messy_hair|straight_hair|curly_hair|wavy_hair|spiked_hair)$/.test(e)) return 'hair_style';
      if (RE_CG_EYES.test(e)) return 'eye_color';
      if (/^(thighhighs|pantyhose|socks|kneehighs|stockings|legwear|ankle_socks|bare_legs|zettai_ryouiki|garter_belt|garter_straps)$/.test(e)) return 'legwear';
      if (RE_CG_LEGWEAR.test(e)) return 'legwear';
      if (/^(panties|thong|bikini|g-string|fundoshi|boxers|briefs)$/.test(e)) return 'underwear';
      if (RE_CG_UNDERWEAR.test(e)) return 'underwear_color';
      if (/^(bra|lingerie|camisole|bralette)$/.test(e)) return 'brassiere';
      if (/^(standing|standing_up|sitting|kneeling|lying|lying_down|lying_on_stomach|lying_on_back|squatting|crawling|all_fours|on_back|on_stomach|on_side|seiza|wariza)$/.test(e)) return 'posture';
      if (/^(against_wall|leaning_on_wall|wall|on_wall)$/.test(e)) return 'wall';
      if (/^(large_breasts|huge_breasts|gigantic_breasts|medium_breasts|small_breasts|flat_chest|absurdly_large_breasts)$/.test(e)) return 'breast_size';
      if (/^(skirt|dress|shorts|pants|jeans|leotard|bodysuit|shirt|blouse|sweater|jacket|coat|white_shirt|black_shirt|loose_shirt|dress_shirt|knit_dress|long_skirt|micro_skirt)$/.test(e)) return 'garment_type';
      // ★ 裸露状态：和「穿什么」是两个不同维度，可以共存
      //   实证：「只穿白衬衫」既要 white_shirt(穿什么) 也要 no_pants(没穿什么)
      if (/^(no_pants|no_bra|no_panties|topless|completely_nude|naked|bottomless|nude)$/.test(e)) return 'nudity_state';
      if (/^(nipples|nipple_slip|puffy_nipples|inverted_nipples)$/.test(e)) return 'nipple_state';
      // ★ 胸部区域：和「乳头状态」是两个维度，可以共存
      //   实证：「胸口全露了」应同时出 breasts「胸部」和 nipples「乳头」
      if (/^(breasts|cleavage|underboob|sideboob|covered_nipples)$/.test(e)) return 'breast_region';
      // ★ 动作细节：同一段文字里的不同动作可以共存
      if (/^(arms_up|holding_above_head|hands_up|arm_up)$/.test(e)) return 'arm_pose';
      if (/^(doggystyle|doggy_style|sex_from_behind|missionary|girl_on_top|upright_straddle)$/.test(e)) return 'sex_position';
      if (/^(smile|grin|frown|pout|open_mouth|closed_mouth|parted_lips)$/.test(e)) return 'mouth_expr';
      if (/^(closed_eyes|closing_eyes|one_eye_closed|half-closed_eyes|half_closed_eyes|wide-eyed|wide_eyed|empty_eyes|vacant_eyes|rolling_eyes|eye_contact|looking_at_viewer|looking_away|looking_back|looking_up|looking_down|looking_to_the_side)$/.test(e)) return 'eye_state';
      if (/^(smile|smiling|light_smile|serious|expressionless|laughing|grin)$/.test(e)) return 'expression';
      // ★ 同一段文字的多种解释：只能留一个最合适的
      //   实证：「被射在脸上」会同时勾 facial / cum_on_face / cumshot_on_face / in_the_face
      //         前三个是「颜射」的同义标签，第四个是「面部受击」（语义错误）
      if (/^(facial|cum_on_face|cumshot_on_face|in_the_face|face_cum)$/.test(e)) return 'cum_on_face';
      if (/^(creampie|creampied|internal_cumshot|after_sex)$/.test(e)) return 'internal_cum';
      return null;
    }

    for (var s = 0; s < cands.length; s++) {
      var cd = cands[s];
      if (usedTag[cd.en]) continue;
      var sps = cd.sps || [];              // ★ 打分阶段已算好，直接复用
      if (!sps.length) continue;
      var free = null;
      for (var w = 0; w < sps.length; w++) {
        if (!overlaps(sps[w])) { free = sps[w]; break; }
      }
      if (!free) {
        // ★★ 并列概念豁免：同一个片段被多个「同义 + 高置信」候选共享时，允许都勾
        //   问题实测：「黑发红眼」在映射表里是 SYN["黑发红眼"] = [black_hair, red_eyes]，
        //            两个标签都用 frag=「黑发红眼」命中，抢同一个 4 字段；
        //            autoPicks 只能给这段分配一个 → 另一个永久丢失。
        //            实测 18 个常见并列短语，只有 56% 两个概念都能出。
        //   判据：① 新候选的片段与已占用区间【完全相同】
        //        ② 新候选与占用者都是 src=同义 且 conf=high
        //        ③ 同一段最多额外追加 2 个（防止极端情况爆炸）
        //   只在这三条都满足时放行 —— 普通的高分抢位不受影响。
        var spN = sps[0];
        var sameSpan = null;
        for (var t1 = 0; t1 < taken.length; t1++) {
          if (taken[t1][0] === spN[0] && taken[t1][1] === spN[1]) { sameSpan = taken[t1]; break; }
        }
        // ★★★ 概念组判定（优先于下面的区间规则）—— 两半都要
        //   【同组 → 阻断】同一语义维度上的竞争，只能留一个
        //     实证：「靠着墙站」里 standing_up 和 standing 是同义词，
        //           以前靠「片段≥3字」规则被同时勾上，出图没意义。
        //   【异组 → 放行】不同语义维度可以共存
        //     实证：「黑发长发」→ black_hair(hair_color) + long_hair(hair_length)
        var cgNew = conceptGroup(cd.en);
        if (sameSpan && cgNew) {
          var cgOcc = conceptGroup(sameSpan[2]);
          if (cgOcc) {
            if (cgOcc === cgNew) continue;           // 同组 → 阻断
            usedTag[cd.en] = 1;                      // 异组 → 放行
            picks[cd.en] = 1;
            taken.push([spN[0], spN[1], cd.en, cd.synHigh ? 'synHigh' : '', cd.cat]);
            continue;
          }
        }

        // ★★★ 2026-10-23 修 bug：嵌套片段豁免
        //   问题实证：「看书」占 [4,6] → reading「阅读」，
        //             「书」是 [5,6] → book「书」，被判为重叠而丢弃 → 道具丢了。
        //   放行条件（任一）：
        //     ① 概念组都已知且不同 —— 不同语义维度
        //        例：black_hair(hair_color) vs long_hair(hair_length)
        //     ② 字段不同 —— 动作/道具本来就是两个字段
        //        例：reading(动作体位) vs book(道具拘束)
        //   ★ 只处理「被完全包含」，不含「部分交叠」，避免放得太宽。
        var nested = null;
        for (var t2 = 0; t2 < taken.length; t2++) {
          if (spN[0] >= taken[t2][0] && spN[1] <= taken[t2][1]) { nested = taken[t2]; break; }
        }
        if (nested) {
          var cgN2 = conceptGroup(nested[2]);
          var diff = false;
          // ★★★ 附加限制（2026-10-23 修精度）：
          //   嵌套片段必须是占用者片段的【真子串】，且更短。
          //   正例：「书」⊂「看书」→ 道具和动作两个概念 ✅
          //   反例：`in_the_face` 和 `facial` 的片段都是「射脸上」，
          //         是同一段文字的两种解释 → 不该都勾（实测污染）
          var _nf = String(cd.frag || '');
          var _of = '';
          for (var _q3 = 0; _q3 < cands.length; _q3++) {
            if (cands[_q3].en === nested[2]) { _of = String(cands[_q3].frag || ''); break; }
          }
          var _isRealNested = _nf && _of && _nf !== _of && _nf.length < _of.length && _of.indexOf(_nf) >= 0;
          if (_isRealNested) {
            if (cgNew && cgN2 && cgN2 !== cgNew) diff = true;          // 概念组不同
            else if (nested[4] && cd.cat && nested[4] !== cd.cat) diff = true;  // 字段不同
          }
          if (diff) {
            usedTag[cd.en] = 1;
            picks[cd.en] = 1;
            taken.push([spN[0], spN[1], cd.en, cd.synHigh ? 'synHigh' : '', cd.cat]);
            continue;
          }
        }
        // ★★ 放行条件：跨字段 —— 但概念组相同时一律阻断
        //    「黑发红眼」→ black_hair(发型发色) + red_eyes(表情眼神)   跨字段 ✅
        //    「内裤」    → panties + knickers                       同字段 = 同义词 ❌
        //   ★★★ 2026-10-23 补：跨字段也要看概念组
        //     反例：「被射在脸上」的 facial(体液痕迹) 和 in_the_face(表情眼神)
        //           字段不同，但都属于 cum_on_face 概念组 → 不该都勾。
        //   ★★★ 同时删掉原来的「片段≥3字」放行条件（它造成了三个同义「颜射」全被勾）：
        //     「黑长直」的三个标签概念组各不相同，已被上面的概念组规则覆盖。
        var _cgCross = conceptGroup(cd.en);
        var _cgCrossOcc = sameSpan ? conceptGroup(sameSpan[2]) : null;
        if (sameSpan && cd.synHigh && sameSpan[3] === 'synHigh'
            && sameSpan[4] !== cd.cat
            && !(_cgCross && _cgCrossOcc && _cgCross === _cgCrossOcc)) {
          var sk = spanKey(spN);
          synExtra[sk] = (synExtra[sk] || 0) + 1;
          if (synExtra[sk] <= 2) {
            usedTag[cd.en] = 1;
            picks[cd.en] = 1;
            continue;
          }
        }

        // ★ 材质标签豁免：被【复合标签】占用的片段，仍允许附加 1 个材质标签
        //   场景：「透明比基尼」命中 transparent_bikini（占用整段），
        //        但 SD 对复合标签理解弱，需 see-through/transparent 强化才画得出透明。
        //   ★ 关键限制：占用者本身若是材质标签则不免豁
        //     （否则单搜「透明」会额外勾上「半透明」，语义错误）
        if (!MATERIAL[cd.en]) continue;
        var sp0 = sps[0], k0 = spanKey(sp0);
        if (matUsed[k0]) continue;
        var occBy = null;
        for (var t0 = 0; t0 < taken.length; t0++) {
          if (sp0[0] < taken[t0][1] && taken[t0][0] < sp0[1]) { occBy = taken[t0][2]; break; }
        }
        if (!occBy) continue;
        if (MATERIAL[occBy]) continue;          // 占用者也是材质 → 不重复叠加
        matUsed[k0] = 1;
        usedTag[cd.en] = 1;
        picks[cd.en] = 1;
        continue;
      }
      // ★ 同一片段只允许出一个标签：占用后该区间的其他候选自然失效
      taken.push([free[0], free[1], cd.en, cd.synHigh ? 'synHigh' : '', cd.cat]);
      usedTag[cd.en] = 1;
      picks[cd.en] = 1;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  ★ 后置全局精简：2026-10-23 尝试后【撤回】
    //
    //  尝试内容：在贪心选完之后再做一次遍历，删掉
    //    ① 同概念组内除最优者外的标签
    //    ② 中文名被更长名包含的泛标签（skirt vs micro_skirt）
    //
    //  实测结果（盲测 120 条）：
    //    召回      64.9% → 62.8%   ↓ 变差
    //    并列18    18/18 → 17/18   ↓ 变差
    //    并列40    40/40 → 39/40   ↓ 变差
    //
    //  原因：概念组阻断已经在贪心阶段做过一次了，这里再删一次
    //        会把「同一概念组但都该保留」的合法组合误删
    //        （并列短语的具体例子里，两个标签同组但都成立）。
    //        上下位删除则误伤了「白色吊带袜」这类合理结果。
    //
    //  结论：全局精简应该只在「确实出现同义冗余」时动手，
    //        而不是按概念组一刀切。这个方向需要更强的内容判断依据，
    //        当前阶段先保持贪心 + 概念组阻断的现状。
    // ══════════════════════════════════════════════════════════════════════

    return picks;
  };

  Engine.prototype.zhOf = function (en) {
    var C = this.data.C || {};
    var low = String(en).toLowerCase().trim();
    if (C.ERA_ZH && C.ERA_ZH[low]) return C.ERA_ZH[low];
    var m = /^year\s+(\d{4})$/.exec(low);
    if (m) return m[1] + '年画风';
    if (C.EXTRA_ZH && C.EXTRA_ZH[low]) return stripBrackets(C.EXTRA_ZH[low]) || en;
    // ★ 词库键用下划线（upper_body），提示词里常写空格（upper body）
    //   依次尝试：原词 → 小写 → 空格转下划线 → 空格转连字符
    //   纯加法回退，原有能查到的词结果不变
    var zh = this.EN2CN[en]
          || this.EN2CN[low]
          || (low.indexOf(' ') >= 0 ? this.EN2CN[low.replace(/\s+/g, '_')] : null)
          || (low.indexOf(' ') >= 0 ? this.EN2CN[low.replace(/\s+/g, '-')] : null)
          || (low.indexOf('_') >= 0 ? this.EN2CN[low.replace(/_/g, ' ')] : null);
    if (zh) return stripBrackets(zh) || zh;
    return en;
  };

  // ══════════════════════════════════════════════════════════════════════
  //  ★ 分类聚合（分类列表模式）
  //    · 有 Danbooru 官方 tag_group 且准确的标签 → 用官方组（中文组名）
  //    · 没有官方归属的标签 → 用本工具自己的分类（15 个内容字段）
  //    · 两类混在同一个列表里，不再区分「官方 / 兜底」
  //    · 分类按命中强度排序（命中置顶）
  //  ★ 只影响界面显示，不影响 match() 的返回，也不影响提示词组装顺序
  // ══════════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════════
  //  噪音判定 isCharNoise（★ 2026-10-27 从 grouped() 内部提到模块级）
  //
  //  原因：原来它嵌在 grouped() 里，只有界面分组能用。
  //        autoPicks（自动勾选）和 autoAssemble（自动组装）都拿不到，
  //        导致「界面已隐藏的垃圾候选，照样被自动组装进提示词」。
  //        实测：「金发双马尾女仆穿白色围裙」自动组装出了
  //              white_(among_us)_(cosplay)、calla_lily_(genshin_impact)、
  //              maid_(fire_emblem:_three_houses) 三个无关角色。
  //
  //  ★ 提到模块级后三处共用同一套判据。逻辑本身一字未改。
  // ══════════════════════════════════════════════════════════════════════════
function isCharNoise(v) {
  var en = String(v.en || '');
  // ★★ 否定形式标签豁免（no_xxx / xxx_removed / not_xxx / xxx_off）
  //   原因：否定解析（autoPicks 里 negatedAt 命中后）要从界面候选里找这些标签，
  //        一旦被噪音过滤掉，否定解析就落空，「不穿内裤」会什么都不给。
  //   2026-10-22 第一次扩展过滤规则时没做这个豁免，
  //   否定句式测试从 38/38 掉到 32/38 —— 就是这个原因。
  if (/^(no_|not_)/.test(en) || /_removed$/.test(en) || /_off$/.test(en)) return false;

  // ★★★ 2026-10-30 新增：cosplay 专名一律判噪音
  //
  //  问题实证：
  //    SYN[夜] = [night, yoru_(chainsaw_man)_(cosplay)]
  //    用户搜「夜空的星星」→ 组装出 yoru_(chainsaw_man)_(cosplay)
  //    （《电锯人》的角色「夜」）
  //
  //  ★ 为什么之前的规则拦不住：
  //    · 规则①要求 conf='low'，但这条是 src='同义' conf='high'
  //    · 规则② 有 `src !== '同义'` 的豁免，
  //      而映射表本身的错误正好走的是同义路径 → 完全绕过过滤
  //    · 上一轮的「同组异类」启发式也没扫到，因为
  //      yoru 的中文名「夜（电锯人）（角色扮演）」和键「夜」共享字
  //
  //  ★ 判据（非常保守，只打「中文查询命中 cosplay 专名」）：
  //    ① 命中片段含汉字（说明是中文查询，不是用户直接打 cosplay）
  //    ② 标签名以 _cosplay / _(cosplay) 结尾，或中文名含「角色扮演/Cosplay」标注
  //
  //  ★★ 为什么必须加条件①：
  //    用户直接写「cosplay」时，返回 cosplay 标签是正确行为。
  //    只有「中文词 → cosplay 专名」这种跨语义域的误配才是噪音。
  var _fragHasCn = /[\u4e00-\u9fa5]/.test(String(v.frag || ''));
  if (_fragHasCn) {
    if (/[_（(][Cc]osplay[)）]?$/.test(en) || /_cosplay$/.test(en)) return true;
    if (/[(（]\s*(角色扮演|[Cc]osplay)\s*[)）]/.test(String(v.cn || ''))) return true;
  }

  // ① 单字 + 低置信 + 目标中文名 >2 字 → 噪音
  if (v.frag && v.frag.length === 1 && v.conf === 'low' && String(v.cn || '').length > 2) return true;

  // ② 短片段撞到更长的中文名（截断式误配）→ 噪音
  //    问题实测：搜「梦幻」→ mugenkan「梦幻馆（东方Project）」
  //            搜「唯美」→ vivlos「唯美跃升（赛马娘）（角色扮演）」
  //            搜「高级」→ ultra_ball「高级球」
  //            搜「脸上带点红晕」→ blood_on_face「脸上带血」（前缀）
  //            搜「脸上带点红晕」→ penis_on_face「阴茎在脸上」（后缀）
  //            搜「下巴放在手上」→ jaw_drop「掉下巴」（后缀）
  //            搜「表情有点忧郁」→ multiple_expressions「多表情」（中间）
  //    判据：片段 ≤3 字 + 走中文名通道（非映射表）+ 目标中文名比片段长
  //          + 片段出现在中文名的任意位置
  //    ★ 前缀、后缀、中间都要查 —— 只查前缀会漏掉「阴茎在脸上」「掉下巴」。
  //    ★ 否定形式标签已在上面豁免，所以「未穿内裤」不会被「内裤」误过滤。
  //    保留例：「内裤」→ underwear「内裤」（中文名 2 字，不更长 → 不触发）
  //           「长发」→ long_hair「长发」（同上）
  //  ★★★ 2026-10-23 修：虚词/语缀剥离后再比
  //     隐藏集归因发现「捆绑」→ bound「被捆绑」被这条误杀 —— 它是 RANKING
  //     类失败里最大的一批。中文名比片段多出来的只是「被/的/地/得/很/了…」
  //     这类虚词时，属于合理修饰，不是截断式误配。
  //       误杀：「捆绑」→「被捆绑」  「打伞」→「撑着伞」
  //       该杀：「梦幻」→「梦幻馆（东方Project）」（多出的是实词）
  //
  //  ★★★ 2026-10-24 尝试过继续放宽（只按「多出部分含括号/数字/字母」判）
  //     效果：隐藏集 v2 召回 65.2% → 67.2%（+2.0），但代价是：
  //       「比基尼」→ 多勾 lamborghini「兰博基尼」（子串碰撞）
  //       「内裤」  → 多勾 black/blue/brown_panties（颜色限定被放行）
  //       「双马尾」→ 多勾 zebra_tail「斑马尾」等 9 个
  //     短词精准度明显下降，规格测试从 112/0 掉到 111/1。
  //     ★ 结论：这类问题应该靠「标注父子关系」的数据治理解决，
  //       而不是启发式放宽过滤。所以回滚，保留 2026-10-23 的虚词豁免版本。
  //   ★★★ 2026-10-30 修：长度判断和包含判断都要用【剥掉助词后】的片段
  //
  //     原来的 `v.frag.length <= 3` 用的是原始 frag，导致「着泳装的」（4 字）
  //     连规则② 都进不去 —— 实测漏网 swimsuit_(xenoblade_x)。
  //
  //     cut() 的滑窗会切出「着黑色」「着女仆」「着泳装的」「黄昏的」这类
  //     带前后助词的片段（来自「穿着黑色」「黄昏的海边」），
  //     必须先把助词剥掉，长度和包含关系的判断才准。
  var _cnA = String(v.cn || '');
  var _frA = String(v.frag || '')
    .replace(/^[的着了地得和与及在把被给对向从到]+/, '')
    .replace(/[的着了地得]+$/, '');
  if (!_frA) _frA = String(v.frag || '');
  if (_frA && _frA.length <= 3 && v.src !== '同义') {
    var _cn = _cnA;
    var _fr = _frA;
    if (_cn.length > _fr.length && _cn.indexOf(_fr) >= 0) {
      // 把中文名里的虚词剔掉，再看剩下的核心部分是不是就等于片段
      var _core = _cn.replace(/[被的了着过地得很有在将把给对于之其和与及或吗呢吧啊]/g, '');
      if (_core !== _fr) return true;
    }
  }
  return false;
}


  Engine.prototype.grouped = function (text, opt) {
    opt = opt || {};
    var r = this.match(text, opt);
    var TG = this.data.TGROUP || (typeof window !== 'undefined' ? window.TGROUP : null) || null;
    var gTab = (TG && TG.g) ? TG.g : [];
    var gMap = (TG && TG.t) ? TG.t : {};

    var buckets = {};
    var order = [];
    var offCnt = 0, ownCnt = 0;
    // ★ 单字噪音过滤（仅界面层，不影响 match / 组装）
    //   问题实测：搜「比基尼」→ 154 个候选里 97 个是单字「尼」的匹配，
    //            界面上出现「尼泊尔 / 尼康 / 泰坦尼克号 / 兰博基尼」，
    //            单字噪音平均占候选的 69%。
    //   判据：片段只有 1 字 + 低置信 + 目标中文名超过 2 字 → 视为噪音，界面不显示。
    //         · 「跪」→ kneeling「跪着」（中文名 2 字）→ 保留（这是正确匹配）
    //         · 「尼」→ nepal「尼泊尔」（中文名 3 字）→ 隐藏
    //   代价实测：界面候选 177 → 72（-59%），召回指标完全不变（match 仍返回全部）。
    var _charNoise = 0;
    for (var c in r) {
      var lst = r[c] || [];
      for (var i = 0; i < lst.length; i++) {
        var v = lst[i];
        if (isCharNoise(v)) { _charNoise++; continue; }
        var gi = gMap[v.en];
        // ★ 一级分类卡统一用 15 内容字段（2026-10-19 改进）
        //   原实现：有官方组的进「官方组」卡，没有的进 15 字段卡 → 两套体系混用，
        //           同一个概念被拆成两张卡（例：threesome 进「性行为」卡、
        //           group_sex 进「动作体位」卡，用户在界面看到两张都装性行为的卡）。
        //   实测：一个句子会摊出 39~46 张碎片卡。
        //   现在：一级固定 15 张卡，官方组名降为二级分组依据（见 v.officialGroup）。
        var key = 'B' + c;
        var name = c;
        var official = (gi != null && gTab[gi]) ? 1 : 0;
        var b = buckets[key];
        if (!b) {
          b = buckets[key] = {
            key: key, name: name, official: official,
            cat: c, syn: 0, syn2: 0, high: 0, list: []
          };
          order.push(key);
        }
        if (v.src === '同义') {
          b.syn++;
          // ★ 只有【片段长度 >= 2】的同义命中才给分类加分
          //   单字片段（女/尼/在…）会产生大量噪音（1girl / buddhist_nun / mfd_threesome），
          //   若给分类加分，会把 beach 这类精准命中挤出前列
          if (v.frag && v.frag.length >= 2) b.syn2++;
        }
        if (v.conf === 'high') b.high++;
        v.cat = c;              // ★ 记下该标签所属的 15 字段（组装与选择键仍用它）
        // ★ 记下官方组名，供界面二级分组使用（官方组名比关键词规则更准）
        if (gi != null && gTab[gi]) v.officialGroup = gTab[gi][1];
        b.list.push(v);
        if (official) offCnt++; else ownCnt++;
      }
    }

    var out = [];
    for (var k in buckets) {
      var bb = buckets[k];
      // 组内排序：与 match() 完全一致
      bb.list.sort(function (a, b2) {
        var rk = { high: 0, mid: 1, low: 2 };
        if (rk[a.conf] !== rk[b2.conf]) return rk[a.conf] - rk[b2.conf];
        if ((b2.loc || 0) !== (a.loc || 0)) return (b2.loc || 0) - (a.loc || 0);
        if (b2.ratio !== a.ratio) return b2.ratio - a.ratio;
        if (b2.score !== a.score) return b2.score - a.score;
        return a.en < b2.en ? -1 : a.en > b2.en ? 1 : 0;
      });
      out.push(bb);
    }

    // ★ 命中置顶（分类排序）
    //   syn2 = 片段长度 >=2 的同义命中数 —— 排除单字片段产生的噪音
    //          例：「女」会命中 1girl/mfd_threesome，「尼」会命中 buddhist_nun，
    //              若给分类加分，会把 beach 这类精准命中挤出前列
    //   同分时：长片段优先 > 同义总数 > 原文出现顺序
    out.sort(function (a, b2) {
      var sa = (a.syn2 || 0) * 10000 + a.high * 10 + a.list.length;
      var sb = (b2.syn2 || 0) * 10000 + b2.high * 10 + b2.list.length;
      if (sa !== sb) return sb - sa;
      if (a.syn !== b2.syn) return b2.syn - a.syn;
      return order.indexOf(a.key) - order.indexOf(b2.key);
    });
    out.officialCnt = offCnt;      // 统计：走官方组的候选数
    out.ownCnt = ownCnt;           // 统计：走自有分类的候选数
    out.charNoiseFiltered = _charNoise;   // 统计：界面被过滤掉的单字噪音数
    return out;
  };

  // ── 词库搜索 ──
  Engine.prototype.search = function (kw, limit) {
    kw = String(kw || '').trim().toLowerCase();
    if (!kw) return [];
    limit = limit || 40;
    var out = [], LIB = this.data.LIB;
    for (var i = 0; i < this.rows && out.length < limit; i++) {
      if ((LIB.n[i] || '').toLowerCase().indexOf(kw) >= 0 ||
        (LIB.c[i] || '').toLowerCase().indexOf(kw) >= 0) {
        out.push({ en: LIB.n[i], cn: LIB.c[i], cat: LIB.b[i], tier: LIB.t[i] });
      }
    }
    return out;
  };

  /* ══════════════════════════════════════════════════════════════
     ★ 高命中自动组装（借鉴 Anima-Prompt-Writer 的「术语回填」）

     原理：描述里【完整出现】的词，如果词库有对应条目，
           就是最强的命中信号 —— 不管限额有没有把它挤掉，都要补回来

     判定（三种都算高命中）：
       ① 中文名 === 描述里的片段          「自慰」→ 自慰
       ② 去掉助词后相等                  「愉悦的表情」→ 愉悦表情
       ③ 片段 + 修饰后缀相等              「暖色」+「调」→ 暖色调

     ★ 只补不删：已有候选不动，只添加缺的
     ★ 这些词置信度直接给 high（因为描述里字面出现了）
     ══════════════════════════════════════════════════════════════ */
  // 常见纯动词用字（这些字单独构成的 2~3 字片段命中标签时降级）
  var WEAK_CHARS = '穿着戴拿带配披脱上下身' + '了着过的在地得';
  var PARTICLE_G = /[的地得了着]/g;

  Engine.prototype.autoAssemble = function (text, cats, opt) {
    opt = opt || {};
    cats = cats || {};
    var self = this;
    var report = { count: 0, byCat: {}, list: [] };

    // 已有候选
    var have = {};
    for (var c0 in cats) {
      for (var i0 = 0; i0 < cats[c0].length; i0++) have[cats[c0][i0].en] = 1;
    }

    // 修饰后缀表
    var SUF = {};
    var TL = (this.data.C && this.data.C.TAIL_OK) || [];
    for (var t0 = 0; t0 < TL.length; t0++) SUF[TL[t0]] = 1;

    var tier = opt.tier || '全部';

    function tryAdd(cn, frag, why) {
      var ens = self.CN2EN[cn];
      if (!ens) return;
      for (var k = 0; k < ens.length; k++) {
        var en = ens[k];
        if (have[en]) continue;
        var cat = self.EN2CAT[en];
        if (!cat) continue;                         // 不在 15 字段内，跳过
        var ti = self.EN2TIER[en] || '';
        if (tier === 'NSFW' && ti !== 'NSFW' && ti !== '分级') continue;
        if (tier === 'SFW' && ti !== 'SFW') continue;
        // ★★★ 2026-10-27：自动组装也要过滤噪音候选
        //   CN2EN['白色'] 里就含 white_(among_us)_(cosplay)，
        //   CN2EN['女仆'] 里含 maid_(fire_emblem:_three_houses)，
        //   界面看不见但它们照样被组装进提示词。
        if (isCharNoise({ en: en, cn: self.EN2CN[en] || '', frag: frag,
                          conf: 'high', src: '组装' })) continue;
        have[en] = 1;
        (cats[cat] = cats[cat] || []).push({
          en: en, cn: self.EN2CN[en] || '', frag: frag, src: '组装',
          // ★★★ 2026-10-30 新增 derivation（按 GPT 核验意见）
          //
          //  autoAssemble 的三条路径：
          //    ① tryAdd(frag, frag, '字面一致')  → 原文片段直接查表 → direct
          //    ② tryAdd(st,  frag, '去助词')     → 去掉助词后查表   → direct
          //    ③ tryAdd(frag+s, frag, '加后缀')  → 加后缀后查表     → direct
          //  三条都是从原文片段直接派生的词法映射，都算 direct。
          //
          //  ★ 与 match() 的区别：match 有「同义/隐含」两种推断路径，
          //    autoAssemble 只有词法路径，所以这里恒为 direct。
          //    但保留字段以便将来扩展（如加 related 扩展时）。
          derivation: 'direct',
          score: frag.length, cat: cat, tier: ti,
          conf: 'high', auto: 1, ratio: 1, ground: 1,
          autoWhy: why
        });
        report.count++;
        report.byCat[cat] = (report.byCat[cat] || 0) + 1;
        report.list.push({ en: en, cn: self.EN2CN[en] || '', cat: cat, frag: frag, derivation: 'direct', autoWhy: why });
      }
    }

    var f = this.cut(text);
    for (var i = 0; i < f.zh.length; i++) {
      var frag = f.zh[i];
      if (frag.length < 2) continue;
      tryAdd(frag, frag, '字面一致');                                  // ①
      var st = frag.replace(PARTICLE_G, '');
      if (st !== frag && st.length >= 2) tryAdd(st, frag, '去助词');    // ②
      for (var s in SUF) tryAdd(frag + s, frag, '加后缀');              // ③
    }
    return report;
  };


  // ── 导出 ──
  var API = { Engine: Engine, stripBrackets: stripBrackets };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.TagEngine = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
