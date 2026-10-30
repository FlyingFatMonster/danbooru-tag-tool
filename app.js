/* 标签查询工具 · Edge 浏览器版（Route B）
   无服务器 · 无依赖 · 双击 index.html 即用
   界面逻辑：中文输入 → 15 字段候选卡片 → 点选 → 实时组装
*/
(function () {
  'use strict';
  var E = null, DATA = {}, SEL = {}, BIZ = [], GROUND = null, GROUPED = null, AUTOPICK = null;

  // ══════════════════════════════════════════════════════════════════════════
  //  ★★★ 2026-10-30：16 类投影视图（categoryV2）
  //
  //  背景：GPT 2026-10-24 设计了 16 类界面，但当时前置条件不满足。
  //  现在前置条件已达成：
  //    · promptRole 已重标（80.4% 独立准确率）
  //    · SEL 的键已从「分类|标签」改成纯标签（换分类不丢选择）
  //    · 选择状态按标签保存
  //
  //  ★ GPT 的实施建议（原文）：
  //    「建议先做成 feature flag / 切换项灰度，不立刻承诺永久双布局：
  //      · 两个布局只做不同的投影视图
  //      · 切换时断言 SEL 完全不变
  //      · 收集实际使用率，旧布局没人用就删掉，而不是永久维护两套」
  //
  //  ★ 本实现严格按此：
  //    · 只在 render() 里重排 BUCKETS，不动 DATA / GROUPED / SEL / 组装顺序
  //    · 两种布局共用同一份勾选状态，切换时不丢任何选择
  //    · 默认仍是旧的 15 字段布局，新版要手动开
  // ══════════════════════════════════════════════════════════════════════════

  // 16 类的显示顺序（按创作时的思考顺序：先定人，再定外观，再定动作场景）
  var V2_ORDER = [
    'identity',        // 身份规格（画质/评级/人数/来源）
    'character',       // 角色作品（角色名/作品名/物种职业）
    'appearance',      // 外貌总述
    'hair',            // 发型发色
    'eyes_expression', // 眼睛与表情
    'clothing',        // 服装
    'accessory',       // 配饰
    'pose_action',     // 姿势动作
    'interaction',     // 互动
    'body_detail',     // 身体细节
    'object',          // 道具物件
    'environment',     // 场景地点
    'time_weather',    // 时间天气
    'composition',     // 镜头构图
    'lighting_effect', // 光影氛围
    'style_quality'    // 风格与其它
  ];

  var V2_LABEL = {
    identity: '身份规格', character: '角色作品', appearance: '外貌', hair: '发型发色',
    eyes_expression: '眼睛表情', clothing: '服装', accessory: '配饰', pose_action: '姿势动作',
    interaction: '互动', body_detail: '身体细节', object: '道具物件', environment: '场景地点',
    time_weather: '时间天气', composition: '镜头构图', lighting_effect: '光影氛围',
    style_quality: '风格其它'
  };

  // promptRole → 16 类（24 个 role 全覆盖）
  var V2_OF_ROLE = {
    score: 'identity', source: 'identity', rating: 'identity', quality: 'identity',
    subject_count: 'identity', character: 'character', copyright: 'character',
    species_job: 'character',
    appearance: 'appearance', hair: 'hair',
    eyes: 'eyes_expression', expression: 'eyes_expression',
    clothing: 'clothing', accessory: 'accessory',
    pose: 'pose_action', interaction: 'interaction', body_state: 'body_detail',
    object: 'object', environment: 'environment', time_weather: 'time_weather',
    composition: 'composition', lighting: 'lighting_effect',
    style: 'style_quality', unknown: 'style_quality'
  };

  var LAYOUT_V2 = false;   // false = 旧 15 字段；true = 新 16 类

  // 取一个标签的 16 类归属（找不到就归 style_quality）
  function catV2Of(tag) {
    try {
      var TR = window.TAG_ROLE;
      var RL = (window.PROMPT_PROFILES && window.PROMPT_PROFILES.ROLES) || [];
      if (TR) {
        var ri = TR[tag];
        if (ri != null && RL[ri]) {
          var cls = V2_OF_ROLE[RL[ri]];
          if (cls) return cls;
        }
      }
    } catch (e) { /* 忽略 */ }
    return 'style_quality';
  }

  // 把一个标签重排到 16 类（纯投影，不改任何原数据）
  function rebucketV2(buckets) {
    var out = {};
    var cnt = 0;
    for (var bi = 0; bi < buckets.length; bi++) {
      var list = buckets[bi].list || [];
      for (var li = 0; li < list.length; li++) {
        var it = list[li];
        var cls = catV2Of(it.en);
        (out[cls] = out[cls] || []).push(it);
        cnt++;
      }
    }
    var res = [];
    for (var oi = 0; oi < V2_ORDER.length; oi++) {
      var k = V2_ORDER[oi];
      if (!out[k] || !out[k].length) continue;
      res.push({
        name: 'v2:' + k,
        cat: V2_LABEL[k] || k,
        v2: k,
        official: false,
        list: out[k]
      });
    }
    return { buckets: res, total: cnt };
  }


  // ── 兼容的剪贴板 ──
  //  ★ 2026-10-23 修：Firefox 在 file:// 下 navigator.clipboard 存在但会 reject，
  //    原来的写法只在「没有 clipboard API」时才降级，导致 Firefox 点复制没反应。
  //    现在改成：API 存在也先试，失败（reject）再走 textarea + execCommand 兜底。
  function copyText(t) {
    function legacy() {
      return new Promise(function (res) {
        var ta = document.createElement('textarea');
        ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) { }
        document.body.removeChild(ta); res();
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        return navigator.clipboard.writeText(t).catch(legacy);
      } catch (e) {
        return legacy();
      }
    }
    return legacy();
  }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ── 启动 ──
  function boot() {
    var t0 = performance.now();
    if (!window.LIB || !window.MANIFEST) {
      $('cards').innerHTML =
        '<div class="card"><h3>数据未加载</h3><div class="stat">' +
        '请先运行 <b>build\\build.py</b> 生成 lib\\ 下的数据文件</div></div>';
      return;
    }
    BIZ = window.MANIFEST.biz;
    E = new window.TagEngine.Engine({
      LIB: window.LIB, SYN: window.SYN, MODELS: window.MODELS,
      C: window.C, MANIFEST: window.MANIFEST
    });
    // ★ ④ 载入用户自定义映射（localStorage），合并进 SYN
    var nUsr = 0;
    try { nUsr = loadUserSyn(); applyUserSyn(); } catch (e) { }
    var ms = performance.now() - t0;
    $('stat').innerHTML =
      '词库 <b>' + window.MANIFEST.rows.toLocaleString() + '</b> 词 · 映射表 <b>' +
      window.MANIFEST.syn.toLocaleString() + '</b> 键 · 模型 <b>' +
      window.MANIFEST.models.toLocaleString() + '</b> 个' +
      (nUsr ? ' · 自定义 <b>' + nUsr + '</b> 条' : '') +
      '<span class="dim">　就绪 ' + ms.toFixed(0) + ' ms</span>';
    buildModels();
    buildStyles();
    $('q').focus();
  }

  // ── 模型下拉 ──
  function buildModels() {
    var sel = $('model'), M = window.MODELS || {};
    // 本地扫描在纯浏览器做不到（无法读目录），列全部预设
    var groups = {};
    Object.keys(M).forEach(function (k) {
      var g = M[k].group || '其他';
      (groups[g] = groups[g] || []).push(k);
    });
    sel.innerHTML = '';
    Object.keys(groups).forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = g;
      groups[g].forEach(function (k) {
        var o = document.createElement('option');
        o.value = k; o.textContent = k;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    if (Object.keys(M).length) { sel.value = Object.keys(M)[0]; }
    onModel();
  }

  function onModel() {
    var M = window.MODELS || {}, p = M[$('model').value];
    if (!p) return;
    var parts = [];
    if (p.clip !== '' && p.clip != null) parts.push('CLIP ' + p.clip);
    if (p.steps !== '' && p.steps != null) parts.push(p.steps + ' 步');
    if (p.cfg !== '' && p.cfg != null) parts.push('CFG ' + p.cfg);
    if (p.sampler) parts.push(p.sampler);
    $('mparam').textContent = parts.join(' · ');
    // 分级
    var rs = (p.rating && p.rating.length) ? p.rating : ['explicit', 'questionable', 'safe'];
    var rc = $('rating');
    rc.innerHTML = '';
    rs.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r; o.textContent = r; rc.appendChild(o);
    });
    // 专属词
    // ★★★ 2026-10-24 修复（GPT 核验指出的高危问题）：
    //   原来这一行是：
    //     var tags = (key && dir[key]) ? dir[key] : ((dir.noobai||[]).concat(dir.animagine||[]));
    //   意思是「模型没有自己的专属词时，就借 NoobAI 和 Animagine 的」。
    //   后果：20 个模型里有 15 个（Illustrious 系、SD1.5 系、各种 XL 衍生）
    //        都会看到 NoobAI 的年代词（newest/recent/mid/early）
    //        和 Animagine 的年份词（year 2005…2012）——
    //        这些是那两个模型独有的训练标签，对别的模型是污染。
    //   现在：没有专属词就显示空，并给出明确提示，绝不借用别人的。
    //   ★ 已加入 STYLES 的旧词不自动删除（不擅自改用户的选择），
    //     但下拉框里不再提供不匹配当前模型的词。
    var C = window.C || {}, dir = C.EXCLUSIVE_BY_MODEL || {};
    var key = null;
    var low = ($('model').value || '').toLowerCase();
    ['noobai', 'animagine', 'pony'].forEach(function (k) { if (low.indexOf(k) >= 0) key = k; });
    var tags = (key && dir[key]) ? dir[key] : [];
    EXCL = tags;
    var ec = $('excl');
    ec.innerHTML = '';
    if (!tags.length) {
      var o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = '（本模型无专属词）';
      o0.disabled = true;
      ec.appendChild(o0);
    }
    tags.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t[0]; o.textContent = t[0] + '（' + t[1] + '）';
      ec.appendChild(o);
    });
    renderStyles();
    build();
  }

  // ── 风格下拉 ──
  function buildStyles() {
    var C = window.C || {}, sc = $('style');
    sc.innerHTML = '';
    (C.STYLE_TAGS || []).forEach(function (t) {
      var o = document.createElement('option');
      o.value = t[0]; o.textContent = t[0] + '（' + t[1] + '）';
      sc.appendChild(o);
    });
  }

  // ── 已选风格/专属 ──
  var STYLES = [], EXCL = [];
  function addStyle(fromExcl) {
    var el = fromExcl ? $('excl') : $('style');
    if (!el.value) { setStatus('请先在下拉里选一项'); return; }
    var name = el.value;
    if (STYLES.indexOf(name) >= 0) { setStatus('「' + name + '」已在列表中'); return; }
    STYLES.push(name);
    renderStyles();
    // ★ 新增风格后：先应用跳过增量（手动模式下也生效），再组装
    applySkipDelta('pos'); applySkipDelta('neg');
    build();
    var C = window.C || {}, sk = C.STYLE_SKIP || {};
    var n = (sk[name] || []).length;
    setStatus('已添加「' + zhOfStyle(name) + '」' + (n ? '（跳过 ' + n + ' 个冲突词）' : ''));
  }
  /* ══════════════════════════════════════════════════════════════
     ★ NSFW / SFW 统计提示（照搬手动工具 _update_tier_hint）
     ══════════════════════════════════════════════════════════════ */
  function updateTierInfo() {
    var el = $('tierinfo'); if (!el) return;
    var n = { NSFW: 0, SFW: 0, 分级: 0, '': 0 }, total = 0;
    var T = window.LIB && window.LIB.t ? window.LIB.t : [];
    for (var i = 0; i < T.length; i++) {
      var t = T[i] || '';
      n[t] = (n[t] || 0) + 1;
      total++;
    }
    if (!total) { el.textContent = ''; return; }
    var nsfw = n.NSFW + n['分级'];
    var s = '词库 ' + total.toLocaleString() + ' 词';
    if (nsfw || n.SFW) {
      s += '　NSFW ' + nsfw.toLocaleString() + '　SFW ' + n.SFW.toLocaleString();
      if (n[''] ) s += '　无标记 ' + n[''];
    } else {
      s += '（无 NSFW/SFW 标记列）';
    }
    el.textContent = s;
  }

  function zhOfStyle(n) {
    var all = (C.STYLE_TAGS || [])
      .concat(C.NO0BAI_ERA_TAGS || [])
      .concat(C.NOOBAI_ERA_TAGS || [])
      .concat(C.YEAR_TAGS || [])
      .concat(C.PONY_TAGS || []);
    for (var i = 0; i < all.length; i++) if (all[i][0] === n) return all[i][1];
    if (C.ERA_ZH && C.ERA_ZH[n]) return C.ERA_ZH[n];
    var m = /^year\s+(\d{4})$/.exec(n);
    if (m) return m[1] + '年画风';
    return n;
  }

  // ══════════════════════════════════════════════════════════════════
  //  ★ 统一的单词翻译入口
  //    顺序：① 词库标签（E.zhOf）—— 词库的中文名更完整
  //             例 newest → 「最新年代(2021-2024)」，比年代表的「最新」详细
  //          ② 风格/年代/年份/评分词（zhOfStyle）—— 词库查不到时兜底
  //             例 depth of field → 「景深」（词库里是 depth_of_field，带空格查不到）
  // ══════════════════════════════════════════════════════════════════
  function zhWord(w) {
    if (!w) return '';
    var y = E ? E.zhOf(w) : w;
    if (y && y !== w && y.trim()) return y;   // 词库有中文就用词库的
    var z = zhOfStyle(w);
    return (z && z.trim()) ? z : w;           // 否则查风格/年代/年份/评分表
  }
  function renderStyles() {
    var box = $('selstyle');
    box.innerHTML = '';
    if (!STYLES.length) { $('selnone').style.display = ''; return; }
    $('selnone').style.display = 'none';
    STYLES.forEach(function (s, i) {
      var b = document.createElement('span');
      b.className = 'chip';
      b.textContent = zhOfStyle(s) + ' ✕';
      b.title = s;
      b.onclick = function () {
        STYLES.splice(i, 1); renderStyles(); build();
        setStatus('已移除「' + zhOfStyle(s) + '」');
      };
      box.appendChild(b);
    });
  }
  function setStatus(t) { $('hint').textContent = t || ''; }

  // ── 匹配 ──
  // ══════════════════════════════════════════════════════════════════════════
  //  ★★★ 2026-10-24 角色/作品扩展库
  //
  //  数据来源：ai-prompt-supermarket（MIT，Copyright (c) 2026 BFRKQSB7）
  //    角色 97,318 条 · 作品 17,152 条 · 合计 114,470 条
  //
  //  设计约束（GPT 2026-10-24 建议 + 项目红线）：
  //    ① 不并入主库 —— 主库 51,110 条完全不动
  //    ② 按需加载 —— 点按钮才载入，不影响默认启动
  //    ③ 独立渲染区 —— 不混进 15 字段卡片，避免把「角色」当成「人物属性」
  //    ④ 分组+配额 —— 角色和作品分开列，各最多 20 条，防搜索结果污染
  //    ⑤ 短词保护 —— 1~2 字只做精确/前缀，否则「少女」会带出上千角色名
  //    ⑥ 绝不按热度排序 —— 只用「匹配等级 → 覆盖率 → 名称长度 → 字典序」
  //    ⑦ post_count 已在生成阶段剔除，运行时根本没有这个字段
  //
  //  ★ 必须放在 IIFE 顶层（和 doMatch 同级）——
  //    第一次实现时放在 DOMContentLoaded 回调内部，doMatch 找不到它，
  //    结果扩展库数据加载成功了但界面一片空白。
  // ══════════════════════════════════════════════════════════════════════════
  var EXTRA_ON = false;
  var EXTRA_Q = '';

  function renderExtra(q) {
    var box = $('extracards');
    if (!box) return;
    box.innerHTML = '';
    EXTRA_Q = q || '';
    if (!EXTRA_ON || !window.TagExtra) return;
    if (!q) return;

    var res;
    try { res = window.TagExtra.search(q, { limit: 20 }); }
    catch (e) { return; }
    // ★ 2026-10-30 修：原来只检查 char 和 copyright，
    //   导致「只有画师命中」的查询（如用户搜某画师名）整块不显示。
    if (!res) return;
    var _nCh = (res.char || []).length;
    var _nWo = (res.copyright || res.work || []).length;
    var _nAr = (res.artist || []).length;
    if (!_nCh && !_nWo && !_nAr) return;

    var wrap = document.createElement('div');
    wrap.className = 'out';
    var h = document.createElement('h3');
    h.innerHTML = '🎭 角色 / 作品 / 画师 <span class="sp"></span>' +
      '<span class="stat" style="font-weight:400">匹配 ' + res.total + ' 条' +
      (res.truncated ? '（每组最多显示 20）' : '') + '</span>';
    wrap.appendChild(h);

    function group(title, list, cat) {
      if (!list.length) return;
      var g = document.createElement('div');
      g.style.margin = '6px 0 2px';
      var gh = document.createElement('div');
      gh.style.cssText = 'font-size:12px;color:#888;margin:4px 0 2px';
      gh.textContent = title + '（' + list.length + '）';
      g.appendChild(gh);
      list.forEach(function (it) {
        var row = document.createElement('div');
        var key = it.en;
        row.className = 'row' + (SEL[key] ? ' on' : '') + ' high';
        row.style.cursor = 'pointer';
        row.innerHTML =
          '<span class="box">' + (SEL[key] ? '☑' : '☐') + '</span>' +
          '<span class="en">' + esc(it.en) + '</span>' +
          '<span class="cn">' + esc(it.cn) + '</span>' +
          '<span class="fr">' + (it.kind === 'char' ? '角色' : it.kind === 'artist' ? '画师' : '作品') + '</span>';
        row.title = it.en + (it.aliases && it.aliases.length ? '\n别名: ' + it.aliases.join(' / ') : '');
        row.onclick = function () {
          if (SEL[key]) delete SEL[key];
          else SEL[key] = { en: it.en, cn: it.cn, frag: q, cat: cat, tier: 'SFW', src: '扩展库' };
          renderExtra(EXTRA_Q);
          build();
        };
        g.appendChild(row);
      });
      wrap.appendChild(g);
    }
    group('角色', res.char, '角色');
    group('作品', res.copyright, '作品');
    group('画师', res.artist, '画师');
    box.appendChild(wrap);
  }

  function doMatch() {
    var q = $('q').value.trim();
    if (!q) { clearAll(); return; }
    SUBFILTER = null;   // ★ 新搜索时清掉小类筛选
    window._OPEN = {};  // ★ 新搜索时重置分类展开状态（默认展开命中最强的前 3 个）
    var t0 = performance.now();
    DATA = E.match(q, { tier: $('tier').value });
    // ★★★ 2026-10-30：记录候选的 derivation，供 priority 判断「独立来源」
    //
    //  GPT 的要求：
    //    「某标签有独立来源，当且仅当它至少有一个 direct_exact 来源，
    //      且该来源是直接映射到这个标签的，不是从子标签派生来的。」
    //
    //  所以这里把 match() 返回的 derivation 字段存下来。
    //  复杂度 O(候选数)，几百到几千次赋值，微秒级。
    (function () {
      var map = {};
      if (DATA) {
        for (var c in DATA) {
          var lst = DATA[c] || [];
          for (var i = 0; i < lst.length; i++) {
            var v = lst[i];
            if (!v || !v.en) continue;
            (map[v.en] = map[v.en] || []).push({
              frag: v.frag || '', derivation: v.derivation || 'direct'
            });
          }
        }
      }
      AUTO.candSrc = map;
    })();
    // ★ 分类聚合（官方 tag_group 优先，无归属的兜底到 15 字段）
    //   只用于显示；DATA 仍是按 15 字段的结构，组装顺序完全不变
    GROUPED = (typeof E.grouped === 'function')
      ? E.grouped(q, { tier: $('tier').value })
      : null;
    // ★ 精准自动勾选：每个输入概念只勾命中最精准的那一个标签
    //   其余候选保留给用户人工挑选（不再把所有高置信都勾上）
    //   ★ 只在【界面实际显示】的标签里挑 —— 保证所见即所得，
    //     不会出现"提示词里有、界面看不到、用户取消不了"的标签
    AUTOPICK = (typeof E.autoPicks === 'function')
      ? (function () {
        var vis = {};
        if (GROUPED) {
          for (var gi = 0; gi < GROUPED.length; gi++) {
            var gl = GROUPED[gi].list || [];
            for (var gj = 0; gj < gl.length; gj++) vis[gl[gj].en] = 1;
          }
        }
        return E.autoPicks(q, { tier: $('tier').value, allowed: vis });
      })()
      : null;

    // ★ 接地检查（借鉴 Anima-Prompt-Writer）：反查候选在描述里有没有依据
    //   只标记可疑 + 温和降级，绝不删除，保证召回率不变
    GROUND = null;
    if (window.TagGround && $('chkGround') && $('chkGround').checked) {
      var gOpt = {
        enable: true,
        isWord: function (s) { return !!(E.CN2EN[s] && E.CN2EN[s].length); },
        tailOk: (function () {
          var m = {}, list = (window.C && window.C.TAIL_OK) || [];
          for (var i = 0; i < list.length; i++) m[list[i]] = 1;
          return m;
        })()
      };
      // ① 对 DATA 跑一遍（组装链路用的结构）
      GROUND = window.TagGround.apply(DATA, q, gOpt);
      // ② ★★ 必须再对 GROUPED 跑一遍
      //    原因：grouped() 内部会重新调用 match()，产出的是【另一批全新对象】，
      //         与 DATA 不共享实例。只给 DATA 打标记的话，
      //         界面渲染（用的是 GROUPED）永远拿不到 ground 字段，
      //         接地标记会 100% 失效、一个都不显示。
      if (GROUPED && GROUPED.length) {
        var gBuckets = {};
        for (var gi = 0; gi < GROUPED.length; gi++) {
          gBuckets[GROUPED[gi].name || ('g' + gi)] = GROUPED[gi].list || [];
        }
        var gStats = window.TagGround.apply(gBuckets, q, gOpt);
        if (gStats && GROUND) {
          // 计数以界面口径为准（用户看到多少才算多少）
          GROUND.suspicious = gStats.suspicious;
          GROUND.downgraded = gStats.downgraded;
          GROUND.byReason = gStats.byReason;
          GROUND.total = gStats.total;
        }
        // ★ 同步刷新各分类的 high 计数（降级后可能变化）
        for (var gj = 0; gj < GROUPED.length; gj++) {
          var gl2 = GROUPED[gj].list || [], hc = 0;
          for (var gk = 0; gk < gl2.length; gk++) if (gl2[gk].conf === 'high') hc++;
          GROUPED[gj].high = hc;
        }
      }
    }

    // ★ 高命中自动组装（借鉴 Anima-Prompt-Writer 的「术语回填」）
    //   描述里字面出现的词，词库有对应条目 → 不管限额有没有挤掉，都补回来
    ASSEMBLE_REPORT = null;
    if ($('chkAuto') && $('chkAuto').checked) {
      ASSEMBLE_REPORT = E.autoAssemble(q, DATA, { tier: $('tier').value });
      // 补进来的词重新排一次序（让它们落到合理位置）
      BIZ.forEach(function (cat) {
        var lst = DATA[cat];
        if (!lst || !lst.length) return;
        var rank = { high: 0, mid: 1, low: 2 };
        lst.sort(function (a, b) {
          if ((a.auto ? 1 : 0) !== (b.auto ? 1 : 0)) return (b.auto ? 1 : 0) - (a.auto ? 1 : 0);
          if (rank[a.conf] !== rank[b.conf]) return rank[a.conf] - rank[b.conf];
          return (b.ratio || 0) - (a.ratio || 0);
        });
      });
    }

    SEL = {};
    // ★ 不清 MANUAL：用户改过的提示词要一直保留到主动点「恢复自动」
    //   若在这里清零，用户手改后一按匹配就被自动内容覆盖，等于手动模式形同虚设
    //   清除入口有三处：恢复自动按钮 / chkManual 取消勾选 / 追加新词
    render(performance.now() - t0);
    // ★★ 2026-10-24 扩展库结果（角色/作品）—— 独立渲染区，不混进 15 字段卡片
    renderExtra(q);
    var n = ASSEMBLE_REPORT ? ASSEMBLE_REPORT.count : 0;
    setStatus(n ? '匹配完成 · 高命中自动补入 ' + n + ' 词' : '匹配完成');
  }

  // ★ 小类筛选状态：null = 全部显示；{cat, sub} = 只看该小类
  var SUBFILTER = null;

  function render(ms) {
    var el = $('cards');
    el.innerHTML = '';
    // ★ 小类筛选提示条
    if (SUBFILTER) {
      var bar = document.createElement('div');
      bar.className = 'subbar';
      bar.innerHTML = '🔍 只看 <b>' + esc(SUBFILTER.cat) + ' › ' + esc(SUBFILTER.sub) + '</b>';
      var cb = document.createElement('button');
      cb.textContent = '显示全部';
      cb.onclick = function () { SUBFILTER = null; render(); };
      bar.appendChild(cb);
      el.appendChild(bar);
    }
    var total = 0, hi = 0, susp = 0;
    // ══════════════════════════════════════════════════════════════════
    //  ★ 分类列表模式（纯官方分类）
    //  · 只显示有 Danbooru 官方 tag_group 归属的标签
    //  · 没有官方归属的标签不进列表（数量在底部提示）
    //  · 分类按命中强度置顶；折叠式，点标题展开
    //  ★ 只改显示；DATA 仍按 15 字段保存，提示词组装顺序完全不变
    // ══════════════════════════════════════════════════════════════════
    var BUCKETS = (GROUPED && GROUPED.length) ? GROUPED : [];

    // ★★★ 2026-10-30：16 类投影视图
    //   LAYOUT_V2 为 true 时，把所有卡片的标签按 categoryV2 重新分组。
    //   ★ 纯投影：DATA / GROUPED / SEL / 组装顺序完全不受影响。
    //   ★ 每个标签只搬位置，勾选状态（SEL 里按纯标签存）原样保留。
    if (LAYOUT_V2 && BUCKETS.length) {
      var _v2 = rebucketV2(BUCKETS);
      BUCKETS = _v2.buckets;
    }

    // 没有任何分类时的提示
    if (!BUCKETS.length) {
      var em = document.createElement('div');
      em.className = 'card';
      em.innerHTML = '<h3>没有匹配到任何标签</h3>' +
        '<div class="stat">这个词没有命中词库里的任何标签。' +
        '<br><br>可以换个说法再试，或用「词库搜索」直接查词库。</div>';
      el.appendChild(em);
      $('cnt').innerHTML = '共 <b>0</b> 候选';
      build();
      return;
    }

    // 展开状态（默认展开前 3 个命中最强的分类）
    if (!window._OPEN) window._OPEN = {};
    BUCKETS.forEach(function (bk, bi) {
      if (window._OPEN[bk.name] === undefined) window._OPEN[bk.name] = (bi < 3);
    });

    // ★ 关键：先把【所有分类】的默认勾选状态初始化好
    //   否则折叠分类里被自动勾选的标签不会进组装
    //   ★ 自动勾选规则：只有 autoPicks 认定的「每个概念最精准那一个」才勾
    //     其余候选一律不勾，留给用户人工挑选
    BUCKETS.forEach(function (bk) {
      (bk.list || []).forEach(function (it) {
        var kk = it.en;
        var picked = !!(AUTOPICK && AUTOPICK[it.en]);
        it.auto = picked ? 1 : 0;                       // 供行样式与悬停提示用
        if (SEL[kk] === undefined) SEL[kk] = picked;
      });
    });

    BUCKETS.forEach(function (bk) {
      var list = bk.list || [];
      if (!list.length) return;
      var card = document.createElement('div');
      card.className = 'card';
      var h = document.createElement('h3');
      h.className = 'grp';
      var opened = !!window._OPEN[bk.name];
      // ★ 官方组与本工具自有分类混排，不再显示「官方」徽章
      // ★ 2026-10-30：16 类视图用中文标签名显示（内部 key 仍是 v2:xxx，供 _OPEN 用）
      h.innerHTML = '<span class="tg">' + (opened ? '▾' : '▸') + '</span> ' +
        esc(bk.v2 ? (V2_LABEL[bk.v2] || bk.cat || bk.name) : bk.name) +
        ' <span>（' + list.length + '）</span>' +
        (bk.syn ? ' <span class="synb">同义 ' + bk.syn + '</span>' : '');
      h.style.cursor = 'pointer';
      h.onclick = function () {
        window._OPEN[bk.name] = !window._OPEN[bk.name];
        render();
      };
      card.appendChild(h);
      // ★ 计数要在【折叠前】累加 —— 折叠的标签也算候选、也算高置信
      list.forEach(function (it) {
        total++; if (it.conf === 'high') hi++;
        if (it.ground === 0) susp++;
      });
      if (!opened) { el.appendChild(card); return; }   // 折叠：不渲染标签行
      // ★ 子类分组：同子类排在一起
      //   ★ 但不得打乱引擎给出的精准顺序：
      //     排序优先级 = 置信度 → 同义命中 → 子类 → 引擎原顺序（稳定）
      //     否则 milf 会被 white_(among_us) 之类挤到后面
      if (typeof subOf === 'function' && list.length) {
        var _R = { high: 0, mid: 1, low: 2 };
        list.forEach(function (x, xi) {
          x._sub = subOf(x.cat, x.en, x.cn) || '';
          x._i = xi;                      // 记录引擎原顺序
        });
        list.sort(function (a, b) {
          var ra = _R[a.conf] != null ? _R[a.conf] : 3;
          var rb = _R[b.conf] != null ? _R[b.conf] : 3;
          if (ra !== rb) return ra - rb;
          // 同义命中（映射表直接命中）优先
          var sa = (a.src === '同义') ? 0 : 1;
          var sb2 = (b.src === '同义') ? 0 : 1;
          if (sa !== sb2) return sa - sb2;
          // ★ 双方都是同义命中 → 完全保持引擎原顺序
          //   （引擎已按片段长度排好：整串「白色内裤」命中排在「内裤」部分命中之前）
          if (sa === 0) return a._i - b._i;
          // 非映射表命中的，再按子类聚拢
          if (a._sub !== b._sub) {
            return (typeof subIdx === 'function' ? subIdx(a.cat, a._sub) : 0) -
                   (typeof subIdx === 'function' ? subIdx(b.cat, b._sub) : 0);
          }
          return a._i - b._i;             // 同子类保持引擎原顺序
        });
        var _cnt = {};
        list.forEach(function (x) { _cnt[x._sub] = (_cnt[x._sub] || 0) + 1; });
      }
      var lastSub = null, lastConf = null;
      list.forEach(function (it) {
        var cat = it.cat;                      // ★ 标签所属的 15 字段
        if (SUBFILTER && (SUBFILTER.cat !== bk.name || SUBFILTER.sub !== it._sub)) return;
        if (it._sub && (it._sub !== lastSub || lastConf !== it.conf)) {
          var sh = document.createElement('div');
          sh.className = 'subh';
          var mk = { high: '★ 高', mid: '◆ 中', low: '· 低' }[it.conf] || '';
          var isOn = SUBFILTER && SUBFILTER.cat === bk.name && SUBFILTER.sub === it._sub;
          sh.innerHTML = '<b>' + esc(it._sub) + '</b> <span>' + (_cnt[it._sub] || 0) +
            ' · ' + mk + ' · ' + (isOn ? '点我取消筛选' : '点我只看这类') + '</span>';
          sh.style.cursor = 'pointer';
          (function (cc, ss, sy) {
            sy.onclick = function () {
              var was = SUBFILTER && SUBFILTER.cat === cc && SUBFILTER.sub === ss;
              SUBFILTER = was ? null : { cat: cc, sub: ss };
              render();
            };
          })(bk.name, it._sub, sh);
          if (isOn) sh.classList.add('on');
          card.appendChild(sh);
          lastSub = it._sub; lastConf = it.conf;
        }
        total++; if (it.conf === 'high') hi++;
        if (it.ground === 0) susp++;
        var key = it.en;   // ★ 2026-10-27：键改成纯标签（零重复，换分类不丢选择）
        var on = SEL[key];
        var row = document.createElement('div');
        row.className = 'row ' + it.conf + (it.src === '同义' ? ' syn' : '') +
          (it.ground === 0 ? ' susp' : '') + (it.auto ? ' auto' : '') + (on ? ' on' : '');
        if (it.auto) row.title = '高命中自动组装：描述里出现了「' + it.frag + '」';
        else if (it.ground === 0) row.title = '接地可疑：' + it.groundReason;
        row.innerHTML =
          '<span class="box">' + (on ? '☑' : '☐') + '</span>' +
          '<span class="mark">' + ({ high: '★', mid: '◆', low: '·' }[it.conf]) + '</span>' +
          '<span class="en">' + esc(it.en) + '</span>' +
          '<span class="cn">' + esc(it.cn || '-') + '</span>' +
          (it.frag ? '<span class="fr">←' + esc(it.frag) + '</span>' : '') +
          (it.tier === 'NSFW' ? '<span class="fr nsfw">[N]</span>' : '');
        row.onclick = function () {
          SEL[key] = !SEL[key];
          // ★ 2026-10-27：记录用户亲手点过这个标签 → 父子抑制时永不剔除它
          if (SEL[key]) MANUAL_SEL[key] = 1; else delete MANUAL_SEL[key];
          row.classList.toggle('on', SEL[key]);
          row.querySelector('.box').textContent = SEL[key] ? '☑' : '☐';
          try { logSel(SEL[key] ? 'add' : 'del', it, cat, it._sub); } catch (e) { }
          if (MANUAL.pos) {
            var cur = $('pos').value.trim();
            var lst2 = cur ? cur.split(',').map(function (s) { return s.trim(); }) : [];
            if (SEL[key]) {
              if (!lst2.some(function (w) { return w.toLowerCase() === it.en.toLowerCase(); })) {
                lst2.push(it.en); setBox('pos', lst2.join(', '));
              }
            } else {
              lst2 = lst2.filter(function (w) { return w.toLowerCase() !== it.en.toLowerCase(); });
              setBox('pos', lst2.join(', '));
            }
          } else {
            build();
          }
          if (SEL[key] && window.C && window.C.GENERIC_MAP && window.C.GENERIC_MAP[it.en]) {
            var r = row.getBoundingClientRect();
            showGenericHint(it.en, r.left, r.bottom);
          } else {
            hideHint();
          }
        };
        row.oncontextmenu = function (e) {
          e.preventDefault();
          showCtx(e.clientX, e.clientY, it, cat);
        };
        row.onmouseenter = function () {
          if (window.C && window.C.GENERIC_MAP && window.C.GENERIC_MAP[it.en] && $('hintbox').hidden) {
            var r = row.getBoundingClientRect();
            showGenericHint(it.en, r.left, r.bottom);
          }
        };
        card.appendChild(row);
      });
      el.appendChild(card);
    });
    $('cnt').innerHTML = '共 <b>' + total + '</b> 候选（★' + hi +
      (susp ? '，<span style="color:#B8860B">接地可疑 ' + susp + '</span>' : '') + '）' +
      // ★ 2026-10-30：ms 可能为 undefined（布局切换时调 render() 不带参数）
      (typeof ms === 'number' && isFinite(ms)
        ? '<span class="dim">　' + ms.toFixed(0) + ' ms</span>' : '');
    build();
  }

  function setAll(v) {
    document.querySelectorAll('.row').forEach(function (r) {
      var en = r.querySelector('.en').textContent;
      var on = v;
      for (var k in SEL) { if (k === en) SEL[k] = on; }
      r.classList.toggle('on', on);
      r.querySelector('.box').textContent = on ? '☑' : '☐';
    });
    build();
  }
  function setConf() {
    var want = Array.prototype.slice.call(arguments);
    document.querySelectorAll('.row').forEach(function (r) {
      var c = r.classList.contains('high') ? 'high'
        : r.classList.contains('mid') ? 'mid' : 'low';
      var on = want.indexOf(c) >= 0;
      var en = r.querySelector('.en').textContent;
      for (var k in SEL) { if (k === en) SEL[k] = on; }
      r.classList.toggle('on', on);
      r.querySelector('.box').textContent = on ? '☑' : '☐';
    });
    build();
  }

  // ── 组装 ──
  // ★ AUTO = 最近一次自动组装的内容；MANUAL = 哪个框被用户改过（改过就不再覆盖）
  var AUTO = { pos: '', neg: '', unknown: [] };
  var MANUAL = { pos: false, neg: false };
  // ══════════════════════════════════════════════════════════════════════════
  //  排列模式
  //
  //  ★★★ 2026-10-24 决策变更（用户人工实测后确认）：
  //    原来有三种排列模式，现在只保留「模型推荐」一种：
  //      model   模型推荐       ← 唯一模式
  //      legacy  旧版兼容顺序   ← 已从界面移除
  //      user    普通标签按我的顺序 ← 已从界面移除
  //
  //  ★ 为什么不彻底删代码：
  //    promptRole 目前只有 55.7% 准确率（72.3% 靠不可靠的 biz_category 兜底）。
  //    如果重标后发现某类标签判不准，还需要能切回旧顺序验证，
  //    不用紧急发新版。所以：
  //      · build() 里三个分支的代码全部保留
  //      · 界面上的下拉框移除（用户看不到这三个选项）
  //      · 这个变量默认为 'model'，只有 __TEST.setMode 能改（自动化测试用）
  //
  //  ★ 将来如果 role 重标验证通过、确认永久不需要回退，可以直接删掉
  //    legacy / user 两个分支的代码。
  // ══════════════════════════════════════════════════════════════════════════
  var ORDER_MODE = 'model';
  // ══════════════════════════════════════════════════════════════════════════
  //  钉住（★ 2026-10-25 新增）
  //
  //  作用：点「清空」时，被钉住的标签保留下来，不会被一起清掉。
  //        适合「每次都要带的词」，比如 1girl、masterpiece、rating_explicit。
  //
  //  ★ 只是「清空时跳过」，标签本身不删、不隐藏、不影响搜索和组装。
  //    完全符合项目「绝不删除」的原则。
  //
  //  ★ 存内存不存 localStorage：刷新页面后自动失效，
  //    避免用户忘了自己钉过什么导致「怎么清都清不干净」的困惑。
  // ══════════════════════════════════════════════════════════════════════════
  var PINNED = {};

  // ══════════════════════════════════════════════════════════════════════════
  //  MANUAL_SEL（★ 2026-10-27 新增）
  //
  //  记录「用户亲手点选过」的标签。
  //  与 SEL 的区别：SEL 是当前是否选中（含自动组装），
  //                  MANUAL_SEL 是用户是否明确表达过要它。
  //
  //  ★ 用途：父子抑制时，用户手动选的词【永不被抑制】。
  //     比如自动给了 white_bikini + bikini，抑制 bikini；
  //     但如果用户自己点了 bikini，就两个都保留。
  //
  //  ★ 不持久化（和 SEL 一致），刷新即清空。
  // ══════════════════════════════════════════════════════════════════════════
  var MANUAL_SEL = {};
  var ASSEMBLE_REPORT = null;

  function build(opt) {
    opt = opt || {};
    var M = window.MODELS || {}, C = window.C || {};
    var p = M[$('model').value] || {};
    var pos = [], neg = [];
    // 模型画质词
    if (p.pos) pos = pos.concat(p.pos.split(',').map(function (s) { return s.trim(); }).filter(Boolean));
    // 分级
    if (p.rating && p.rating.length) {
      // ★ 不能用 `p.rating_prefix || 'rating_'`：
      //   空字符串在 JS 里是 falsy，会让「明确配成空前缀」的模型
      //   （Animagine、SD1.5 系）被强行套上 rating_ 前缀。
      //   实测后果：Animagine 官方要的是裸词 explicit/sensitive，
      //            工具却输出 rating_explicit，模型读不到正确的分级指令。
      //   改成「只有字段缺失时才用默认值」，空前缀才真正生效。
      var _rp = (p.rating_prefix != null) ? p.rating_prefix : 'rating_';
      pos.push(_rp + $('rating').value);
    }
    // 候选
    var byCat = {};
    for (var k in SEL) {
      if (!SEL[k]) continue;
      var cat = catOf(k), en = k;
      (byCat[cat] = byCat[cat] || []).push(en);
    }
    // ★★ 2026-10-23 v2：不再在这里单独拼「画面质量」
    //   GPT 核验指出：提前拼进去会绕过 role 排序，
    //   导致 DEFAULT_ORDER / ANIMAGINE_ORDER 里 quality 的位置失效。
    //   现在「画面质量」和其他字段一样进入 byRole，统一参与排序。
    // ★★ 色彩强化（合并了原「色彩保护」）：正向加 13 个强化词，负向加 6 个反色词
    var COLOR_ON = $('chkColor') && $('chkColor').checked;
    if (COLOR_ON) {
      var cp = (C.COLOR_POS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (cp.length) pos = pos.concat(cp);
    }
    // ★★ 全身保护（正向补充词）：放在靠前位置，权重更高
    //    full body / entire body visible / from head to toe / detailed body
    if ($('chkBody') && $('chkBody').checked) {
      var fp = (C.FULLBODY_POS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (fp.length) pos = pos.concat(fp);
    }
    // ★★ 风格 / 专属词（照搬手动工具 _refresh_prompts 的第 ④ 步）
    //    位置：模型画质词 → 画面质量 → rating → 【风格/专属】→ 其余分段
    if (STYLES && STYLES.length) pos = pos.concat(STYLES);

    // ══════════════════════════════════════════════════════════════════════
    //  ★★★ 2026-10-23 架构解耦 v2 —— 按 GPT 核验意见重写
    //
    //  v1 的四个错误（GPT 逐条指出）：
    //   ① 把「去重」当成了「移动位置」：
    //      posSuffix.filter(t => pos.indexOf(t) < 0) 只防重复，
    //      已存在的词根本不会被移到尾部 → Animagine 质量词尾置实际未生效。
    //   ② 「画面质量」字段被提前拼进 pos，绕过了 role 排序 →
    //      声明「按 role 组装」但 quality 实际不受 DEFAULT_ORDER 控制。
    //   ③ 未知 role 默认塞进 style → 掩盖数据缺失，统计失真。
    //   ④ 「我的选择顺序」名不副实：系统词已提前插入。
    //
    //  v2 的做法：
    //   ① prefix/suffix 一律「先删掉旧位置，再放到目标位置」
    //   ② 画面质量也进 byRole，统一参与排序
    //   ③ 未知 role → 'unknown'（排在最后，且不伪装成 style）
    //   ④ 模式名改为「普通标签按我的选择顺序」
    // ══════════════════════════════════════════════════════════════════════
    var PP = window.PROMPT_PROFILES || null;
    var ROLE = window.TAG_ROLE || null;
    // ★ 2026-10-24：排列模式改为单一模式（模型推荐），从变量取而非 DOM
    var mode = ORDER_MODE || 'model';
    var prof = PP ? PP.get($('model').value) : null;

    // ★ 把 prefix/suffix 从列表中彻底移除（不是跳过），返回新数组
    function removeAll(list, words) {
      if (!words || !words.length) return list.slice();
      return list.filter(function (t) { return words.indexOf(t) < 0; });
    }

    // ── 收集每个 role 下的标签（现在包含「画面质量」，不再单独排除）──
    var byRole = {};
    var unknownTags = [];
    BIZ.forEach(function (c) {
      var lst = byCat[c];
      if (!lst) return;
      lst.forEach(function (en) {
        // ★ 2026-10-23 二轮修复：role 索引存在但越界/非法时，也要记进 unknownTags
        //   原来只有「ROLE[en] 不存在」才记录，索引非法会静默变成 unknown 而不报。
        var ri = (ROLE && ROLE[en] != null) ? ROLE[en] : null;
        var rn = (ri != null && PP && PP.ROLES && PP.ROLES[ri]) ? PP.ROLES[ri] : null;
        if (!rn) {
          rn = 'unknown';
          if (unknownTags.indexOf(en) < 0) unknownTags.push(en);
        }
        (byRole[rn] = byRole[rn] || []).push(en);
      });
    });
    // ★ 2026-10-24：unknownTags 以前只收集不使用（死代码，GPT 指出）。
    //   现在把它存到 AUTO 上，由 budgetTxt 显示「N 词排序待定」，
    //   并在鼠标悬停时列出具体是哪些词 —— 用户能知道为什么某个词跑到了奇怪的位置。
    //   ★ 只是提示，绝不因此删除或隐藏任何标签。
    AUTO.unknown = unknownTags;

    // ★★★ 2026-10-24 角色/作品扩展库的两个分类
    //   这两个分类不在 MANIFEST.biz（15 字段）里，所以上面的 BIZ.forEach 不会带出它们。
    //   按 GPT 的建议，它们在提示词里的位置：
    //     角色 → character role（在 subject_count / species_job 之后）
    //     作品 → copyright role（紧跟角色之后，Animagine 官方要求「角色名后跟作品名」）
    //   如果 PROMPT_PROFILES 里还没有这两个 role，就退回到「紧跟在人数之后」的位置。
    [['角色', 'character'], ['作品', 'copyright']].forEach(function (pair) {
      var cat = pair[0], rnDef = pair[1];
      var lst = byCat[cat];
      if (!lst || !lst.length) return;
      var hasRole = PP && PP.ROLES && PP.ROLES.indexOf(rnDef) >= 0;
      var rn = hasRole ? rnDef : 'unknown';
      if (!hasRole && unknownTags.length === 0) unknownTags = unknownTags || [];
      (byRole[rn] = byRole[rn] || []).push.apply(byRole[rn], lst);
    });

    // ★★★ 2026-10-27：兜底 —— 消费 byCat 里剩下的所有分类
    //
    //   背景：SEL 的键改成纯标签后，分类要由 catOf() 从词库查。
    //        如果某个标签不在主词库里（扩展库标签、用户自定义映射产生的词），
    //        catOf() 会返回「未分类」，而「未分类」不在 BIZ 的 15 个字段里，
    //        上面两个 forEach 都不会带出它 → 标签【静默消失】。
    //
    //   GPT 核验指出这是发布阻断级风险，确实如此。
    //
    //   ★ 修法：不特判「未分类」，统一消费所有没被前两段认领的分类。
    //   ★ 原则：分类只决定「排在哪一段」，绝不能决定「能不能进提示词」。
    //     这是项目红线「永远保留可达性」的直接体现。
    var _consumed = {};
    BIZ.forEach(function (c) { _consumed[c] = 1; });
    _consumed['角色'] = 1;
    _consumed['作品'] = 1;
    var _orphanCats = [];
    for (var _oc in byCat) {
      if (_consumed[_oc]) continue;
      var _olist = byCat[_oc];
      if (!_olist || !_olist.length) continue;
      _orphanCats.push(_oc + '(' + _olist.length + ')');
      _olist.forEach(function (en) {
        var ri2 = (ROLE && ROLE[en] != null) ? ROLE[en] : null;
        var rn2 = (ri2 != null && PP && PP.ROLES && PP.ROLES[ri2]) ? PP.ROLES[ri2] : null;
        if (!rn2) {
          rn2 = 'unknown';
          if (unknownTags.indexOf(en) < 0) unknownTags.push(en);
        }
        (byRole[rn2] = byRole[rn2] || []).push(en);
      });
    }
    AUTO.orphanCats = _orphanCats;   // 供 budgetTxt 提示（只提示，不删词）

    if (mode === 'user') {
      // 普通标签按用户勾选顺序；系统词（模型 pos / rating / 保护词）保持在前
      var sysSet = {};
      pos.forEach(function (t) { sysSet[t] = 1; });
      for (var sk in SEL) {
        if (!SEL[sk]) continue;
        // ★ 2026-10-27：SEL 的键已是纯英文标签，不需要再切分
        var sen = sk;
        if (!sysSet[sen]) pos.push(sen);
      }
    } else if (mode === 'legacy' || !PP) {
      // 旧版：按 15 字段原顺序（画面质量本来就在最前，BIZ 顺序天然保留）
      BIZ.forEach(function (c) {
        if (byCat[c]) pos = pos.concat(byCat[c]);
      });
      // ★ 2026-10-27：兜底消费未认领的分类，防止标签静默丢失
      //   （同上面模型推荐模式的修法，GPT 核验指出的发布阻断级风险）
      var _lc = {};
      BIZ.forEach(function (c) { _lc[c] = 1; });
      for (var _lcat in byCat) {
        if (!_lc[_lcat] && byCat[_lcat] && byCat[_lcat].length) {
          pos = pos.concat(byCat[_lcat]);
        }
      }
    } else {
      // ── 模型推荐顺序 ──
      var order = (prof && prof.order) || PP.DEFAULT_ORDER;
      // 防御：order 里不应有重复 role
      var seenRole = {};
      order.forEach(function (rn) {
        if (seenRole[rn]) return;
        seenRole[rn] = 1;
        if (byRole[rn]) pos = pos.concat(byRole[rn]);
      });
      // 兜底：order 没覆盖的 role 追加在后面，防止丢标签
      // ★ 2026-10-23 三轮修复（GPT 指出）：
      //   原来 unknown 和「profile 未覆盖的合法 role」混在同一个兜底循环里，
      //   相对顺序取决于对象键顺序，注释声称「unknown 排最后」比实现保证得更强。
      //   现在：先追加未覆盖的合法 role，unknown 单独严格放最后。
      for (var rn2 in byRole) {
        if (seenRole[rn2] || rn2 === 'unknown') continue;
        pos = pos.concat(byRole[rn2]);
      }
      if (byRole['unknown']) pos = pos.concat(byRole['unknown']);
    }

    if (mode !== 'legacy') {
      // ══════════════════════════════════════════════════════════════════════
      //  ★★★ 父子抑制（2026-10-27 新增）
      //
      //  问题：用户说「白色比基尼」，自动组装输出 white_bikini + bikini +
      //        girl + teen_girl —— 父子冗余，浪费 token，还可能干扰模型。
      //
      //  数据：lib/parentmap.js 的 window.PARENT_OF
      //        来源 = GPT 标注 1565 条 + 严格白名单模板 2658 条
      //        模板只收「颜色/尺寸/材质/图案 + 中心词」且中文名必须包含关系
      //        已排除：否定词(no_/not_)、事件关系词(holding_/sitting_)、
      //                括号消歧义、中英文不对应
      //
      //  规则（按 GPT 核验意见）：
      //    · 只在【组装阶段】抑制上位词，绝不删除词库里的标签
      //    · 用户手动点选的词（MANUAL）永不被抑制
      //    · 被抑制的词仍在界面上可见、可手动加回
      //    · 抑制原因记到 AUTO.subsumed，供预算提示显示
      //
      //  ★ 完全符合项目红线「永远保留可达性」——
      //    这只是在输出里去重，不是让标签变得不可达。
      // ══════════════════════════════════════════════════════════════════════
      var PMAP = window.PARENT_OF;
      if (PMAP) {
        var inPos = {};
        pos.forEach(function (t) { inPos[t] = 1; });
        var killed = {};
        pos.forEach(function (t) {
          if (killed[t]) return;
          // 收集 t 的所有祖先（传递闭包）
          var todo = (PMAP[t] || []).slice();
          var seen = {};
          while (todo.length) {
            var anc = todo.pop();
            if (seen[anc]) continue;
            seen[anc] = 1;
            // 不抑制：不在当前输出里 / 用户手动选的 / 已被抑制的
            if (!inPos[anc] || MANUAL_SEL[anc] || killed[anc]) {
              var more = PMAP[anc];
              if (more) for (var mi = 0; mi < more.length; mi++) todo.push(more[mi]);
              continue;
            }
            killed[anc] = t;
            var more2 = PMAP[anc];
            if (more2) for (var mj = 0; mj < more2.length; mj++) todo.push(more2[mj]);
          }
        });
        var kg = Object.keys(killed);
        if (kg.length) {
          pos = pos.filter(function (t) { return !killed[t]; });
          AUTO.subsumed = killed;                       // {被抑制的上位词: 覆盖它的下位词}
        } else {
          AUTO.subsumed = null;
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      //  ★★★ 2026-10-30：计数标签覆盖泛化主体词（按 GPT 核验意见实现）
      //
      //  问题：37 句真实语料里，autoAssemble 多出 62 个词，
      //        其中 girl 出现 12 次、teen_girl 12 次 —— girl 一条就占 19.4%。
      //
      //  GPT 的判断：
      //    「1girl：明确数量和性别；girl：泛化女性主体。
      //      两者同时存在时，girl 基本没有新增信息。」
      //    「有 1girl 时不输出 girl。但 teen_girl 不要抑制 ——
      //      它增加的是年龄维度，和人数不是同一件事。」
      //    「不要反过来做：有 girl 时不要抑制 1girl —— 数量标签信息量更高。」
      //    「只作用于最终组装列表，不要改底层搜索结果和 SYN。」
      //
      //  规则（对称处理男女）：
      //    有 1girl/2girls/3girls/multiple_girls → 抑制 girl/girls
      //    有 1boy/2boys/3boys/multiple_boys     → 抑制 boy/boys
      //    有 1other/multiple_others             → 抑制 other/others
      //
      //  ★ 完全符合红线：这只是去重，被抑制的词仍可在界面上手动勾选。
      // ══════════════════════════════════════════════════════════════════════
      var COUNT_G = /^(\d+girls?|multiple_girls|no_humans)$/;
      var COUNT_B = /^(\d+boys?|multiple_boys)$/;
      var COUNT_O = /^(\d+others?|multiple_others)$/;
      var _pSet = {};
      pos.forEach(function (t) { _pSet[t] = 1; });
      var _genKill = {};
      var hasG = false, hasB = false, hasO = false;
      for (var _ci = 0; _ci < pos.length; _ci++) {
        var _ct = pos[_ci];
        if (COUNT_G.test(_ct)) hasG = true;
        else if (COUNT_B.test(_ct)) hasB = true;
        else if (COUNT_O.test(_ct)) hasO = true;
      }
      if (hasG) { if (_pSet['girl']) _genKill['girl'] = '1girl 类计数标签'; if (_pSet['girls']) _genKill['girls'] = '1girl 类计数标签'; }
      if (hasB) { if (_pSet['boy']) _genKill['boy'] = '1boy 类计数标签'; if (_pSet['boys']) _genKill['boys'] = '1boy 类计数标签'; }
      if (hasO) { if (_pSet['other']) _genKill['other'] = '1other 类计数标签'; if (_pSet['others']) _genKill['others'] = '1other 类计数标签'; }
      if (Object.keys(_genKill).length) {
        pos = pos.filter(function (t) { return !_genKill[t]; });
        AUTO.genSubsumed = _genKill;   // 供预算提示显示
      } else {
        AUTO.genSubsumed = null;
      }

      // ══════════════════════════════════════════════════════════════════════
      //  ★★★ 2026-10-30：同义组只留首选（alias 归一化）
      //
      //  问题：膨胀测试（86 个多余词）里 alias 占 26 条（30.2%）。
      //        同一概念出现两种写法，浪费 token：
      //          standing + standing_up
      //          short_hair + cropped_hair
      //          facing_back + facing_away
      //
      //  数据来源：window.SYN_LABELS.p —— GPT 2026-10-24 标的全量首选表（4,163 组）
      //    短发 → short_hair     （所以 cropped_hair 不是首选）
      //    站立 → standing       （所以 standing_up 不是首选）
      //    背对镜头 → facing_back
      //    躺着 → lying
      //    草地 → grass
      //
      //  规则（按 GPT 核验意见的「方案 A：只决定同义组中的代表标签」）：
      //    对每个【同组】—— 即 CN2EN[某中文] 这个列表 ——
      //    如果该组的首选 SL.p[中文] 在输出里，就抑制该组里其他的标签。
      //
      //  ★ GPT 明确警告过：「SL.p 只是首选标签，不能独自证明其余是同义」。
      //    所以这里加了两道保险：
      //      ① 只对【确实同组】的标签动手（都来自同一个 CN2EN 键）
      //      ② 首选必须真的在输出里，否则不动
      //
      //  ★ 完全符合红线：只在最终输出里归一化，被抑制的词仍可在界面手动勾选。
      // ══════════════════════════════════════════════════════════════════════
      var SLP = (window.SYN_LABELS && window.SYN_LABELS.p) || null;
      if (SLP && E && E.CN2EN) {
        var _pNow = {};
        pos.forEach(function (t) { _pNow[t] = 1; });
        var _aliasKill = {};
        for (var _acn in E.CN2EN) {
          var _pref = SLP[_acn];
          if (!_pref) continue;                 // 这组没标首选，跳过
          if (!_pNow[_pref]) continue;          // 首选不在输出里，不归一化
          var _grp = E.CN2EN[_acn];
          if (!_grp || _grp.length < 2) continue;
          var _hit = 0;
          for (var _gi = 0; _gi < _grp.length; _gi++) if (_pNow[_grp[_gi]]) _hit++;
          if (_hit < 2) continue;               // 这组在输出里只有一个词，无需归一化
          for (var _gj = 0; _gj < _grp.length; _gj++) {
            var _gt = _grp[_gj];
            if (_gt === _pref) continue;
            if (!_pNow[_gt]) continue;
            if (_aliasKill[_gt]) continue;
            _aliasKill[_gt] = _pref;
          }
        }
        var _akg = Object.keys(_aliasKill);
        if (_akg.length) {
          pos = pos.filter(function (t) { return !_aliasKill[t]; });
          AUTO.aliasMerged = _aliasKill;        // {被抑制的别名: 首选标签}
        } else {
          AUTO.aliasMerged = null;
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      //  ★★★ 2026-10-30：priority（精简安全等级）+ reason
      //
      //  设计依据：GPT 2026-10-30 核验后的方案。
      //
      //  ★ 核心原则（GPT 原话）：
      //    「Priority 0 应表示『有证据说明它适合先删』，不能表示『我们不了解它』。」
      //
      //  ★ 三条硬性要求（GPT 明确指出的）：
      //    ① role=unknown 必须中性（默认 priority 2），不能判 0
      //       —— 否则 5,518 个未分类标签天然被罚
      //    ② parent/narrower 必须按【当前输出集合成对判断】，不能全局降级
      //       —— 只有「当前输出里同时有子词，且父词自己没独立来源」才算冗余
      //    ③ direct_exact 靠 derivation 字段判断，不能只靠 indexOf
      //       —— 否则推断出来但碰巧在原文里有相同子串的会被误判
      //
      //  ★ 用途：只在 token 超预算时列出「建议先删」，绝不自动删。
      //    用户手动锁定的词永远是 priority 3。
      //
      //  决策顺序（按 GPT 给的固定顺序，不覆盖，命中即 return）：
      //    1. 用户手动锁定                    → 3
      //    2. direct_exact / 计数标签         → 3
      //    3. alias_leftover                  → 0
      //    4. redundant_parent                → 0
      //    5. 确认噪音                        → 0
      //    6. canonical / 明确属性            → 2
      //    7. unknown 且无冗余证据            → 2
      //    8. related / 弱推断                → 1
      //    9. 无独立来源的补充                → 1
      // ══════════════════════════════════════════════════════════════════════
      (function computePriority() {
        var out = {};
        if (!pos || !pos.length) { AUTO.priority = out; return; }

        // ── 集合（GPT 要求：一次 build 线性计算，不做 O(n²)）──
        var outSet = {};
        for (var _pi = 0; _pi < pos.length; _pi++) outSet[pos[_pi]] = 1;

        var lockSet = {};
        if (PINNED) for (var _pl in PINNED) if (PINNED[_pl]) lockSet[_pl] = 1;
        if (MANUAL_SEL) for (var _pm in MANUAL_SEL) if (MANUAL_SEL[_pm]) lockSet[_pm] = 1;

        // ── 来源表：标签 → [{frag, derivation}] ──
        var srcByTag = {};
        function addSrc(tag, frag, deriv) {
          (srcByTag[tag] = srcByTag[tag] || []).push({ frag: frag, derivation: deriv || 'direct' });
        }
        // ① 优先用 match() 时记录的候选来源（app.js search() 里存的）
        if (AUTO.candSrc) {
          for (var _ct2 in AUTO.candSrc) {
            var _cl = AUTO.candSrc[_ct2];
            for (var _cj = 0; _cj < _cl.length; _cj++) {
              addSrc(_ct2, _cl[_cj].frag, _cl[_cj].derivation);
            }
          }
        }
        // ② 补充 autoAssemble 的来源（report.list 里也带 derivation）
        if (ASSEMBLE_REPORT && ASSEMBLE_REPORT.list) {
          var _sl = ASSEMBLE_REPORT.list;
          for (var _si = 0; _si < _sl.length; _si++) {
            var _s = _sl[_si];
            if (_s && _s.en) addSrc(_s.en, _s.frag, _s.derivation);
          }
        }

        // 有独立来源 = 至少一个 derivation 是 direct/synonym 的来源
        //   ★ GPT 强调：不能是「因为子词派生而继承的同一来源」
        //     我们的 sources 来自 match/autoAssemble 的直接命中，天然满足。
        function hasIndependent(tag) {
          var ss = srcByTag[tag];
          if (!ss) return false;
          for (var i = 0; i < ss.length; i++) {
            var dv = ss[i].derivation;
            if (dv === 'direct' || dv === 'synonym') return true;
          }
          return false;
        }
        function isExact(tag) {
          var ss = srcByTag[tag];
          if (!ss) return false;
          for (var i = 0; i < ss.length; i++) {
            if (ss[i].derivation === 'direct') return true;
          }
          return false;
        }

        // ── 计数标签正则（和上面抑制用的是同一套）──
        var COUNT_TAG = /^(\d+(girl|boy|other)s?|multiple_(girls|boys|others)|no_humans)$/;

        // ── 系统词（质量词 / rating / 风格 / 保护词）永不参与精简 ──
        //   ★ 这些是工具按模型 profile 自动加的，不是用户内容，
        //     删掉会直接损坏出图质量。所以一律 priority 3。
        //
        //   两层判断（实测 MANIFEST.biz 只是 15 个分类名、profile 里也没有词表，
        //   所以不能靠它们）：
        //     ① promptRole 是 score / quality / rating / source 的
        //     ② 常见质量词硬编码兜底（这些标签非常稳定，不会变）
        var sysSet2 = {};
        // ② 硬编码兜底
        ('masterpiece,best quality,amazing quality,very aesthetic,newest,absurdres,highres,'
         + 'ultra detailed,extremely detailed,detailed,8k,4k,hd,uhd,'
         + 'rating_explicit,rating_questionable,rating_safe,rating_general,'
         + 'explicit,questionable,safe,general'
        ).split(',').forEach(function (w) {
          w = w.trim().toLowerCase();
          if (w) sysSet2[w] = 1;
        });
        // ① 按 role 判断
        var _TR2 = window.TAG_ROLE || null;
        var _RL2 = (window.PROMPT_PROFILES && window.PROMPT_PROFILES.ROLES) || [];
        var SYS_ROLES = { score: 1, quality: 1, rating: 1, source: 1 };
        function isSysByRole(tag) {
          if (!_TR2) return false;
          var ri = _TR2[tag];
          if (ri == null) return false;
          var rn = _RL2[ri];
          return !!(rn && SYS_ROLES[rn]);
        }

        // ── 首选表 ──
        var SLP2 = (window.SYN_LABELS && window.SYN_LABELS.p) || null;
        var prefSet = {};
        if (SLP2) for (var _pk in SLP2) prefSet[SLP2[_pk]] = 1;

        // ── 父词表 ──
        var PM2 = window.PARENT_OF || null;

        // ── 已确认噪音（isCharNoise 判过的，从 AUTO 拿）──
        var noiseSet = {};
        if (AUTO.subsumed) for (var _nk in AUTO.subsumed) noiseSet[_nk] = 1;

        for (var _ci = 0; _ci < pos.length; _ci++) {
          var t = pos[_ci];
          var rec = { priority: 2, reason: 'unknown_neutral', relatedTag: '' };
          var tLow = String(t).toLowerCase();

          // ⓪ 系统词（质量/rating/风格/保护词）→ 3，永不参与精简
          if (sysSet2[tLow] || sysSet2[t] || isSysByRole(t)) {
            rec.priority = 3; rec.reason = 'system_term'; out[t] = rec; continue;
          }

          // ① 用户手动锁定 → 3（最高优先，不可被任何规则降级）
          if (lockSet[t]) { rec.priority = 3; rec.reason = 'user_locked'; out[t] = rec; continue; }

          // ② direct_exact 或 计数标签 → 3
          if (isExact(t)) { rec.priority = 3; rec.reason = 'direct_exact'; out[t] = rec; continue; }
          if (COUNT_TAG.test(t)) { rec.priority = 3; rec.reason = 'count_tag'; out[t] = rec; continue; }

          // ③ alias_leftover → 0（alias 归一化后残留的非首选同义词）
          if (AUTO.aliasMerged && AUTO.aliasMerged[t]) {
            rec.priority = 0; rec.reason = 'alias_leftover'; rec.relatedTag = AUTO.aliasMerged[t];
            out[t] = rec; continue;
          }

          // ④ redundant_parent → 0
          //   条件：当前输出里有它的子词，且它自己没有独立来源
          //   ★ 按 GPT 要求成对判断，不全局降级
          if (PM2 && !hasIndependent(t)) {
            var _pch = PM2[t];   // PM2[子] = [父...]，所以这里要反查
            var _found = '';
            for (var _xi = 0; _xi < pos.length; _xi++) {
              var _child = pos[_xi];
              var _ps = PM2[_child];
              if (!_ps) continue;
              for (var _pj = 0; _pj < _ps.length; _pj++) {
                if (_ps[_pj] === t) { _found = _child; break; }
              }
              if (_found) break;
            }
            if (_found) {
              rec.priority = 0; rec.reason = 'redundant_parent'; rec.relatedTag = _found;
              out[t] = rec; continue;
            }
          }

          // ⑤ 确认噪音 → 0
          if (noiseSet[t]) { rec.priority = 0; rec.reason = 'confirmed_noise'; out[t] = rec; continue; }

          // ⑥ canonical 或 明确属性 → 2
          if (prefSet[t]) { rec.priority = 2; rec.reason = 'canonical'; out[t] = rec; continue; }

          // ⑦ 弱推断（只有 inferred 来源）→ 1
          var _ss = srcByTag[t];
          if (_ss && _ss.length) {
            var _allInferred = true;
            for (var _ii = 0; _ii < _ss.length; _ii++) {
              if (_ss[_ii].derivation !== 'inferred') { _allInferred = false; break; }
            }
            if (_allInferred) { rec.priority = 1; rec.reason = 'direct_inferred'; out[t] = rec; continue; }
            // 有来源但不是精确命中 → 2
            rec.priority = 2; rec.reason = 'explicit_attribute'; out[t] = rec; continue;
          }

          // ⑧ 无来源记录（role=unknown 且无冗余证据）→ 2 中性
          //   ★ GPT 明确要求：unknown 不能判 0
          rec.priority = 2; rec.reason = 'unknown_neutral'; out[t] = rec; continue;
        }

        AUTO.priority = out;
      })();
    }

    if (mode !== 'legacy') {
      // ── 质量词定位（★ 2026-10-23 二轮修复：head 也要显式移动）
      //  GPT 二轮核验指出：
      //    "你只展示了 tail 的删除再追加。head 只是「不做移动」，
      //     只有在模型词原本保证位于头部时才等价于真正前置。"
      //  所以两种位置都要显式 removeAll + 重新放置，不能只处理 tail。
      if (prof) {
        var qWords = (p.pos || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        if (qWords.length) {
          var place = prof.qualityPlacement || 'head';   // 缺省按 head
          if (place === 'tail') {
            pos = removeAll(pos, qWords);
            pos = pos.concat(qWords);
          } else if (place === 'head') {
            pos = removeAll(pos, qWords);
            pos = qWords.concat(pos);
          }
          // 非法值（如 "tails"）→ 不做移动，保持原样，但测试会捕获
        }
      }
    }
    // ══════════════════════════════════════════════════════════════════════
    //  负向提示词（★ 2026-10-24 结构化 + 按 NEG_ORDER 排序）
    //
    //  GPT 核验指出：NEG_ORDER 早就定义在 profiles.js 里，但一直没接入，
    //  负向输出只是字符串拼接后去重 —— 属于「配置存在、功能不存在」。
    //
    //  ★ 现在按「要阻止什么问题」的重要性分层：
    //      ① 模型固定的负向（score_6 / low score / standard 等）
    //      ② 画质与打码类
    //      ③ 解剖与手脚类
    //      ④ 文字水印类
    //      ⑤ 用户主动排除的内容（负向勾选）
    //      ⑥ 保护开关产生的词（放最后，因为它们最可能被用户手动删）
    //
    //  ★ 只对【自动生成部分】排序，用户手工输入的内容完全不动。
    // ══════════════════════════════════════════════════════════════════════
    var negParts = [];      // [{tier: 数字小的先, text: '...'}]
    var NEG_ORDER = (window.PROMPT_PROFILES && window.PROMPT_PROFILES.NEG_TIERS) || {
      modelFixed: 0, quality: 1, anatomy: 2, text: 3, userNeg: 4, protection: 5
    };

    // ① 模型固定负向
    var modelNeg = (p.neg || '').replace(/\bstandard\b/g, C.MODEL_NEG_BASE || '');
    if (modelNeg) negParts.push({ t: NEG_ORDER.modelFixed, s: modelNeg });

    // ② 用户主动排除（负向勾选）
    if (neg.length) negParts.push({ t: NEG_ORDER.userNeg, s: neg.join(', ') });

    // ③ 保护开关产生的词（放最后）
    var protParts = [];
    [['chkHand', C.HAND_FOOT_NEG], ['chkDec', C.DECENSOR],
     ['chkFur', C.FURRY_NEG]].forEach(function (x) {
      if ($(x[0]).checked && x[1]) protParts.push(x[1]);
    });
    if (COLOR_ON) {
      var cw = colorNegWords(pos);
      if (cw.length) protParts.push(cw.join(', '));
    }
    if ($('chkBody') && $('chkBody').checked) {
      var bw = fullBodyNegWords(pos);
      if (bw.length) protParts.push(bw.join(', '));
    }
    if (protParts.length) negParts.push({ t: NEG_ORDER.protection, s: protParts.join(', ') });

    // 按层级排序后合并
    negParts.sort(function (a, b) { return a.t - b.t; });
    var n = negParts.map(function (x) { return x.s; }).join(', ');
    // 去重
    pos = dedupe(pos); n = dedupe(n.split(',').map(function (s) { return s.trim(); }).filter(Boolean));
    // ★★ 风格冲突过滤：正向用正向跳过集，负向用负向跳过集
    var sk = applyStyleSkip(pos, n);
    pos = sk.pos; n = sk.neg;
    // ★ 互斥处理（默认开启，可手动关闭；只提示不删除）
    var mx = resolveMutex(pos);
    pos = mx.list;
    var posTxt = pos.join(', '), negTxt = n.join(', ');

    // ★ 记录自动内容（供「追加新词」做骨架）
    AUTO.pos = posTxt; AUTO.neg = negTxt;

    // ★ 手动模式下不覆盖用户内容
    if (!MANUAL.pos) setBox('pos', posTxt);
    if (!MANUAL.neg) setBox('neg', negTxt);
    updateHints();
    updateSkipLabel();
    $('budget').textContent = budgetTxt(pos);
    // ★★★ 2026-10-30：精简建议（按 GPT 要求，只生成方案，不自动删）
    renderTrimPanel();
    // ★ 悬停显示排序待定的具体词（只是提示，不删除任何标签）
    if (AUTO.unknown && AUTO.unknown.length) {
      $('budget').title = '以下 ' + AUTO.unknown.length + ' 个词的 promptRole 未识别，' +
        '排在提示词末尾的 unknown 段，位置可能不理想：\n\n' + AUTO.unknown.join(', ') +
        '\n\n（仅提示位置，标签不会被删除或隐藏）';
    } else {
      $('budget').title = '';
    }
    // ★ 互斥冲突：只提示，不删除（保证创作自由）
    //   ★★ 无冲突时必须清掉上一次的提醒，否则提示会一直挂着误导用户
    //      只清「互斥提醒」字样，避免误删「追加报告」等其他提示
    if (mx.conflicts.length) {
      $('asinfo').textContent = '⚠ 互斥提醒（未删除）：' + mx.conflicts.map(function (d) {
        return d.other + ' ↔ ' + d.keep;
      }).join(' · ');
      clearTimeout(MUTEX_TIP_T);
      MUTEX_TIP_T = setTimeout(function () {
        if (/互斥提醒/.test($('asinfo').textContent)) $('asinfo').textContent = '';
      }, 8000);
    } else if (/互斥提醒/.test($('asinfo').textContent)) {
      $('asinfo').textContent = '';
    }
    if (opt.report) showReport(opt.report);
  }

  function setBox(id, txt) {
    var el = $(id);
    if (el.value !== txt) el.value = txt;
    $(id + 'zh').textContent = txt
      ? txt.split(',').map(function (w) { return zhWord(w.trim()); }).filter(Boolean).join('、')
      : '';
  }

  function updateHints() {
    $('modeTag').textContent = (MANUAL.pos || MANUAL.neg) ? '手动' : '自动';
    $('modeTag').className = 'modetag' + ((MANUAL.pos || MANUAL.neg) ? ' man' : '');
    $('posHint').textContent = MANUAL.pos ? '✎ 手动编辑中' : '';
    $('negHint').textContent = MANUAL.neg ? '✎ 手动编辑中' : '';
    $('chkManual').checked = (MANUAL.pos || MANUAL.neg);
  }

  function showReport(rep) {
    var parts = [];
    if (rep.pos) parts.push('正向 ' + rep.pos);
    if (rep.neg) parts.push('负向 ' + rep.neg);
    $('asinfo').textContent = parts.length ? parts.join(' · ') : '无需追加';
    setTimeout(function () { $('asinfo').textContent = ''; }, 5000);
  }

  /* ══════════════════════════════════════════════════════════════
     ★ ＋ 追加新词（照搬手动工具的设计）
       ① 以【自动内容顺序】为骨架重建
       ② 补回的词回到它原本的字段位置（不是拼到末尾）
       ③ 用户自己新增的词保留，统一放到末尾
       ④ 只补不删
     ══════════════════════════════════════════════════════════════ */
  function appendWords(which) {
    var box = $(which), cur = box.value;
    var auto = AUTO[which] || '';
    if (!auto) { setStatus('还没有可追加的内容，先点「匹配」'); return; }

    var autoList = auto.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var curList = cur.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var autoSet = {}; autoList.forEach(function (w) { autoSet[w.toLowerCase()] = 1; });
    var curSet = {}; curList.forEach(function (w) { curSet[w.toLowerCase()] = 1; });

    // 缺的自动词（按自动顺序）
    var missing = autoList.filter(function (w) { return !curSet[w.toLowerCase()]; });
    // 用户新增的词（不在自动内容里）
    var extra = curList.filter(function (w) { return !autoSet[w.toLowerCase()]; });

    if (!missing.length && !extra.length) {
      setStatus('无需追加（' + (which === 'pos' ? '正向' : '负向') + '已完整）');
      showReport({}); return;
    }

    // 骨架 = 自动顺序；用户新增接到末尾
    var merged = autoList.concat(extra);
    merged = dedupe(merged);
    setBox(which, merged.join(', '));
    MANUAL[which] = false;   // 追加后回到自动态

    var msg = [];
    if (missing.length) msg.push('补回 ' + missing.length + ' 词');
    if (extra.length) msg.push('保留新增 ' + extra.length + ' 词');
    var rep = {};
    rep[which] = msg.join(' · ') || '无变化';
    showReport(rep);
    setStatus('已按字段顺序补齐：' + (which === 'pos' ? '正向' : '负向') + ' ' + msg.join(' · '));
    updateHints();
  }

  // ↻ 恢复自动：放弃手改，回到自动组装
  function restoreAuto() {
    MANUAL.pos = MANUAL.neg = false;
    $('chkManual').checked = false;
    build();
    setStatus('已恢复自动组装');
    updateHints();
  }

  // ★ 手动编辑检测
  function onEdit(which) {
    var cur = $(which).value;
    var auto = AUTO[which] || '';
    var same = normEq(cur, auto);
    // ★ 应该处于手动态 = 当前内容与自动生成的不一致
    //   注意不能写成 `same !== MANUAL[which]`——那样两种情况都对不上：
    //     改过(same=false) 且 MANUAL=false → 条件 false，永不标记
    //     改回(same=true)  且 MANUAL=true  → 条件 false，永不恢复
    var shouldManual = !same;
    if (shouldManual !== MANUAL[which]) {
      MANUAL[which] = shouldManual;
      updateHints();
    }
    // 中文含义跟着变
    $(which + 'zh').textContent = cur
      ? cur.split(',').map(function (w) { return zhWord(w.trim()); }).filter(Boolean).join('、')
      : '';
  }
  function normEq(a, b) {
    var f = function (s) {
      return s.split(',').map(function (x) { return x.trim().toLowerCase(); })
        .filter(Boolean).join(',');
    };
    return f(a) === f(b);
  }
  function dedupe(a) {
    var seen = {}, out = [];
    // ★ 去重键要归一化（小写 + 空格/下划线视为同一个词）
    //   问题实测：勾选「全身保护」后正向出现两个 full_body ——
    //     开关词表写的是空格形式「full body」（跟手动版工具一致，出图正常）
    //     而自动匹配到的是标签形式「full_body」
    //   旧实现只做 toLowerCase，两种形式被当成不同的词，重复进了提示词。
    //   改成归一化后比较，保留先出现的那个，不改变任何词的书写形式。
    function key(w) {
      return String(w).toLowerCase().replace(/[\s_]+/g, '_').replace(/^_+|_+$/g, '');
    }
    a.forEach(function (w) {
      var l = key(w);
      if (w && !seen[l]) { seen[l] = 1; out.push(w); }
    });
    return out;
  }

  /* ══════════════════════════════════════════════════════════════
     ★ 右键菜单（照搬手动工具）
       任意词条右键 → 加入正向 / 加入负向 / 复制词条 / 搜索
     ══════════════════════════════════════════════════════════════ */
  var CTX = { en: '', cn: '', cat: '' };

  function showCtx(x, y, it, cat) {
    CTX = { en: it.en, cn: it.cn || '', cat: cat };
    var m = $('ctxmenu');
    m.hidden = false;
    var w = m.offsetWidth || 160, h = m.offsetHeight || 140;
    m.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
    m.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
  }
  function hideCtx() { var m = $('ctxmenu'); if (m) m.hidden = true; }

  function ctxAddPositive() {
    var key = CTX.en;
    SEL[key] = true;
    MANUAL_SEL[key] = 1;   // ★ 用户主动加入 → 不被父子抑制剔除
    // 同步界面上的勾选状态
    document.querySelectorAll('.row').forEach(function (r) {
      var e = r.querySelector('.en');
      if (e && e.textContent.replace(/^⚡/, '') === CTX.en) {
        r.classList.add('on'); r.querySelector('.box').textContent = '☑';
      }
    });
    build();
    setStatus('已加入正向：' + CTX.en + (CTX.cn ? '「' + CTX.cn + '」' : ''));
  }
  // ★ 加入负向：切手动模式防覆盖（照搬手动工具）
  function ctxAddNegative() {
    var cur = $('neg').value.trim();
    var list = cur ? cur.split(',').map(function (s) { return s.trim(); }) : [];
    if (list.some(function (w) { return w.toLowerCase() === CTX.en.toLowerCase(); })) {
      setStatus('负向里已有：' + CTX.en); return;
    }
    list.push(CTX.en);
    setBox('neg', list.join(', '));
    MANUAL.neg = true;                    // ★ 防被自动组装覆盖
    updateHints();
    setStatus('已加入负向：' + CTX.en + '（已切手动输入防覆盖）');
  }
  function ctxCopy() {
    copyText(CTX.en).then(function () { setStatus('已复制：' + CTX.en); });
  }
  // ★ 2026-10-25 新增：钉住 / 取消钉住
  function ctxPin() {
    PINNED[CTX.en] = true;
    setStatus('已钉住：' + CTX.en + (CTX.cn ? '「' + CTX.cn + '」' : '') +
      '　点「清空」时会保留它');
    renderPinMarks();
  }
  function ctxUnpin() {
    delete PINNED[CTX.en];
    setStatus('已取消钉住：' + CTX.en);
    renderPinMarks();
  }
  // 在卡片行上显示 / 移除 📌 标记
  function renderPinMarks() {
    document.querySelectorAll('.row').forEach(function (r) {
      var e = r.querySelector('.en');
      if (!e) return;
      var en = e.textContent.replace(/^⚡/, '');
      var mark = r.querySelector('.pinmark');
      var isPinned = !!PINNED[en];
      if (isPinned && !mark) {
        var s = document.createElement('span');
        s.className = 'fr pinmark';
        s.textContent = '📌';
        s.title = '已钉住：清空时会保留这个标签';
        r.appendChild(s);
      } else if (!isPinned && mark) {
        mark.remove();
      }
    });
  }
  function ctxSearch() {
    $('q').value = CTX.en;
    $('q').focus();
    setStatus('已填入搜索框：' + CTX.en);
  }

  /* ══════════════════════════════════════════════════════════════
     ★ 泛称 → 精准推荐（D3，照搬手动工具的 GENERIC_MAP 29 条）
     ══════════════════════════════════════════════════════════════ */
  function showGenericHint(en, x, y) {
    var C = window.C || {}, G = C.GENERIC_MAP || {};
    var alts = G[en] || G[en.toLowerCase()];
    if (!alts || !alts.length) { hideHint(); return; }
    var box = $('hintbox');
    var html = '<b>「' + esc(en) + '」是泛称，用精准词命中率更高：</b><br>';
    html += '<div style="margin-top:6px">';
    alts.forEach(function (a) {
      var zh = zhWord(a);
      html += '<span class="alt" data-en="' + esc(a) + '" data-cat="' + esc(EN2CAT_(a)) +
        '">' + esc(a) + (zh && zh !== a ? '「' + esc(zh) + '」' : '') + '</span>';
    });
    html += '</div>';
    box.innerHTML = html;
    box.hidden = false;
    box.style.left = Math.min(x, window.innerWidth - 470) + 'px';
    box.style.top = (y + 18) + 'px';
    // 点替代词 → 直接勾上
    box.querySelectorAll('.alt').forEach(function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        var aen = el.dataset.en, acat = el.dataset.cat || '';
        if (acat) {
          SEL[aen] = true;
          document.querySelectorAll('.row').forEach(function (r) {
            var e2 = r.querySelector('.en');
            if (e2 && e2.textContent.replace(/^⚡/, '') === aen) {
              r.classList.add('on'); r.querySelector('.box').textContent = '☑';
            }
          });
        } else {
          // 不在候选里 → 直接追加到正向框
          var cur = $('pos').value.trim();
          var list = cur ? cur.split(',').map(function (s) { return s.trim(); }) : [];
          list.push(aen); setBox('pos', dedupe(list).join(', '));
          MANUAL.pos = true; updateHints();
        }
        build();
        setStatus('已采用精准词：' + aen);
        hideHint();
      };
    });
  }
  function hideHint() { var b = $('hintbox'); if (b) b.hidden = true; }
  function EN2CAT_(en) {
    for (var c in DATA) {
      for (var i = 0; i < DATA[c].length; i++) if (DATA[c][i].en === en) return c;
    }
    return '';
  }

  /* ══════════════════════════════════════════════════════════════
     ★ 复制选中行 / 复制全部结果（照搬手动工具）
     ══════════════════════════════════════════════════════════════ */
  function listByOrder(onlySelected) {
    var out = [], byCat = {};
    for (var k in SEL) {
      if (onlySelected && !SEL[k]) continue;
      var c = catOf(k), e = k;
      (byCat[c] = byCat[c] || []).push(e);
    }
    if (byCat['画面质量']) out = out.concat(byCat['画面质量']);
    BIZ.forEach(function (c) {
      if (c === '画面质量') return;
      if (byCat[c]) out = out.concat(byCat[c]);
    });
    return out;
  }
  function copySel() {
    var l = listByOrder(true);
    if (!l.length) { setStatus('还没有勾选任何词'); return; }
    copyText(l.join(', ')).then(function () { setStatus('已复制选中 ' + l.length + ' 词'); });
  }
  function copyAll() {
    var l = listByOrder(false);
    if (!l.length) { setStatus('没有候选词'); return; }
    copyText(l.join(', ')).then(function () { setStatus('已复制全部 ' + l.length + ' 词'); });
  }

  /* ══════════════════════════════════════════════════════════════
     ★ 锁定 / 解锁文本框（照搬手动工具 _set_readonly）
     ══════════════════════════════════════════════════════════════ */
  var LOCKED = { pos: false, neg: false };
  function toggleLock(which, btn) {
    LOCKED[which] = !LOCKED[which];
    $(which).readOnly = LOCKED[which];
    btn.textContent = LOCKED[which] ? '🔓' : '🔒';
    btn.style.opacity = LOCKED[which] ? '0.55' : '';
    if (LOCKED[which]) MANUAL[which] = true;    // 锁定 = 手动模式
    updateHints();
    setStatus((which === 'pos' ? '正向' : '负向') + (LOCKED[which] ? '已锁定' : '已解锁'));
  }

  /* ══════════════════════════════════════════════════════════════
     ★ 框内翻译（照搬手动工具 _translate_box）
     ══════════════════════════════════════════════════════════════ */
  function translateBox(which) {
    var v = $(which).value.trim();
    if (!v) { setStatus('框里没有内容'); return; }
    var words = v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    $(which + 'zh').textContent = words.map(function (w) { return zhWord(w); }).join('、');
    setStatus('已翻译 ' + words.length + ' 个词');
  }

  /* ══════════════════════════════════════════════════════════════
     ★ 互斥处理（借鉴 Anima-Prompt-Writer 的「姿态/情绪互斥」）

     ★★ 设计原则：【最大化创作自由】
        · 默认【关闭】—— 不替用户做决定
        · 开启后也【只标记提示，绝不删除】
        · 互斥轴只保留【物理上不可能共存】的，语义可叠加的一律不列

     ★ 曾删掉的轴（会误伤 NSFW 创作）：
        ✗ 表情基调（smile/crying/angry…）—— 笑中带泪、痛苦又享受都是常见表达
        ✗ 人物朝向（facing_viewer/from_behind）—— 镜子场景可以同时有
        ✗ 裸露细化（topless/bottomless）—— 是 partially_nude 的子类，可共存
     ══════════════════════════════════════════════════════════════ */
  var MUTEX = [
    // 基本姿态：一个人不可能同时站着和躺着（除非多人，多人时不提示）
    { name: '基本姿态', tags: ['standing', 'sitting', 'lying', 'kneeling',
        'squatting', 'crouching', 'on_all_fours'] },
    // 主眼态：同一时刻只能一种
    { name: '眼睛开合', tags: ['closed_eyes', 'one_eye_closed'] },
    // 裸体程度：全裸 vs 半裸 是真互斥
    { name: '裸体程度', tags: ['completely_nude', 'partially_nude'] },
    // 室内外：同一画面基本二选一
    { name: '室内外', tags: ['indoors', 'outdoors'] },
    // 昼夜：同一画面基本二选一
    { name: '昼夜', tags: ['day', 'night'] },
  ];
  // 可共存的组合（例外表）
  var MUTEX_OK = {
    'lying|on_all_fours': 1, 'sitting|on_all_fours': 1,
    'day|outdoors': 1, 'night|outdoors': 1, 'day|indoors': 1, 'night|indoors': 1,
  };
  // ★ 默认关闭 —— 不替用户做决定
  var MUTEX_OFF = true;
  var MUTEX_TIP_T = null;   // 互斥提示的自动清除定时器

  // ★ 只标记，不删除（返回冲突信息，由调用方决定怎么提示）
  function resolveMutex(words) {
    if (MUTEX_OFF) return { list: words, dropped: [], conflicts: [] };
    var conflicts = [];
    MUTEX.forEach(function (ax) {
      var inAxis = [];
      for (var i = 0; i < words.length; i++) {
        if (ax.tags.indexOf(words[i].toLowerCase()) >= 0) inAxis.push({ i: i, w: words[i].toLowerCase() });
      }
      if (inAxis.length < 2) return;
      for (var k = 1; k < inAxis.length; k++) {
        var a = inAxis[0].w, b = inAxis[k].w;
        var key1 = a + '|' + b, key2 = b + '|' + a;
        if (MUTEX_OK[key1] || MUTEX_OK[key2]) continue;
        conflicts.push({ axis: ax.name, keep: words[inAxis[0].i], other: words[inAxis[k].i] });
      }
    });
    // ★★ 不删除任何词 —— 全部保留，只报告冲突
    return { list: words, dropped: [], conflicts: conflicts };
  }
  /* ══════════════════════════════════════════════════════════════
     ★ 风格冲突过滤（照搬手动工具 _style_skip_sets / _apply_style_skip）

     ★★ 数据结构：STYLE_SKIP[风格] = [正向跳过词表, 负向跳过词表]
        monochrome → [[], ["dull colors","greyscale","monochrome","washed-out colors"]]
        realistic  → [["newest"], ["anime coloring"]]

     ★ 三条来源都算「选了这个风格」（否则从候选勾的风格不触发跳过）：
        ① 下拉加入的风格/专属词（STYLES）
        ② 候选里勾上的风格词
        ③ 专属年代词（EXCLUSIVE_SKIP）

     ★★ 统一后处理规则：
        凡正向剔除了 newest（用户要古早/特定年代画风）
        → 负向必须同步放开 old / early，否则正负自相矛盾
     ══════════════════════════════════════════════════════════════ */
  function styleSkipSets() {
    var C = window.C || {}, SK = C.STYLE_SKIP || {}, ES = C.EXCLUSIVE_SKIP || {};
    var sp = {}, sn = {};

    var push = function (set, arr) {
      if (!arr) return;
      // ★ 兼容：可能是数组，也可能是字符串
      var list = Array.isArray(arr) ? arr : [arr];
      list.forEach(function (w) {
        if (w != null && String(w).trim()) set[String(w).trim().toLowerCase()] = 1;
      });
    };

    var merge = function (en) {
      if (!en) return;
      var v = SK[en];
      if (v && Array.isArray(v) && v.length >= 2 && Array.isArray(v[0])) {
        // ★ STYLE_SKIP 结构：[正向跳过, 负向跳过]
        push(sp, v[0]); push(sn, v[1]);
        return;
      }
      // EXCLUSIVE_SKIP / 其他形式：值不是嵌套数组就跳过（数据是 "year" 这类标记）
      var e = ES[en];
      if (e && Array.isArray(e) && e.length >= 2 && Array.isArray(e[0])) {
        push(sp, e[0]); push(sn, e[1]);
      } else if (Array.isArray(v) && v.length && !Array.isArray(v[0])) {
        // 平面数组 → 当作负向跳过
        push(sn, v);
      }
    };

    STYLES.forEach(merge);
    // ★ 来源 ②：候选里勾上的风格词
    for (var k in SEL) {
      if (!SEL[k]) continue;
      merge(k);
    }
    // ★★ 年代放开
    if (sp['newest']) push(sn, C.ERA_RELEASE_NEG || ['early', 'old']);
    return { pos: sp, neg: sn };
  }

  // 按风格冲突过滤：正/负向分别应用其跳过集
  var LAST_SKIPPED = { pos: [], neg: [] };
  function applyStyleSkip(posList, negList) {
    var S = styleSkipSets();
    var dropped = { pos: [], neg: [] };
    var fp = posList.filter(function (w) {
      if (S.pos[w.toLowerCase()]) { dropped.pos.push(w); return false; }
      return true;
    });
    var fn = negList.filter(function (w) {
      if (S.neg[w.toLowerCase()]) { dropped.neg.push(w); return false; }
      return true;
    });
    LAST_SKIPPED = dropped;
    return { pos: fp, neg: fn, dropped: dropped };
  }
  function updateSkipLabel() {
    var el = $('skipinfo'); if (!el) return;
    var all = LAST_SKIPPED.pos.concat(LAST_SKIPPED.neg);
    if (!all.length) { el.textContent = ''; el.title = ''; return; }
    el.innerHTML = '风格跳过 <b>' + all.length + '</b> 词';
    el.title = '被所选风格冲突过滤掉：\n' + all.join(', ');
  }
  // ★ 照搬手动工具：手动模式下，风格跳过的【增量】仍要生效
  function applySkipDelta(which) {
    if (!MANUAL[which]) return;
    var S = styleSkipSets();
    var set = (which === 'pos') ? S.pos : S.neg;
    if (!Object.keys(set).length) return;
    var words = $(which).value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var kept = words.filter(function (w) { return !set[w.toLowerCase()]; });
    if (kept.length !== words.length) {
      setBox(which, kept.join(', '));
      setStatus('已按风格跳过 ' + (words.length - kept.length) + ' 个冲突词');
    }
  }
  // ★ 色彩保护按风格过滤（照搬手动工具 _color_neg_words）
  //   并增加「色彩强化联动避让」：正向已有饱和/高对比等词时，负向不再加冲突词
  function colorNegWords(posList) {
    var C = window.C || {};
    var S = styleSkipSets();
    var src = C.COLOR_NEG || C.NEG_COLOR || '';
    var words = src.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    // ① 风格跳过
    words = words.filter(function (w) { return !S.neg[w.toLowerCase()]; });
    // ② 色彩强化联动：正向有对应词时跳过冲突负向词
    var SKIP = C.COLOR_SKIP || {};
    if (!Object.keys(SKIP).length) return words;
    var norm = function (s) {
      return String(s).toLowerCase().replace(/\s+/g, '_').replace(/_+/g, '_');
    };
    var posSet = {};
    (posList || []).forEach(function (w) { posSet[norm(w)] = 1; });
    for (var k in SEL) {
      if (!SEL[k]) continue;
      posSet[norm(k)] = 1;
    }
    (STYLES || []).forEach(function (s) { posSet[norm(s)] = 1; });
    return words.filter(function (w) {
      var probes = SKIP[w];
      if (!probes) return true;
      for (var i = 0; i < probes.length; i++) {
        if (posSet[norm(probes[i])]) return false;
      }
      return true;
    });
  }
  // ★ 全身保护：排除半身/肖像构图
  //   避让逻辑：正向里已经有的景别，负向就不再加对应的排除词
  //   例：正向选了「特写」，就不加 close-up；选了「全身」，全套都加
  function fullBodyNegWords(posList) {
    var C = window.C || {};
    var SKIP = C.FULLBODY_SKIP || {};
    // 收集正向现有词（归一化：小写、空格转下划线）
    var norm = function (s) {
      return String(s).toLowerCase().replace(/\s+/g, '_').replace(/_+/g, '_');
    };
    var posSet = {};
    (posList || []).forEach(function (w) { posSet[norm(w)] = 1; });
    for (var k in SEL) {
      if (!SEL[k]) continue;
      posSet[norm(k)] = 1;
    }
    (STYLES || []).forEach(function (s) { posSet[norm(s)] = 1; });

    var words = (C.FULLBODY_NEG || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return words.filter(function (w) {
      var probes = SKIP[w] || [w];
      for (var i = 0; i < probes.length; i++) {
        if (posSet[norm(probes[i])]) return false;   // 正向已有 → 跳过这个排除词
      }
      return true;
    });
  }
  // ══════════════════════════════════════════════════════════════════════════
  //  token 预算 + 字段完整度
  //
  //  ★★★ 2026-10-24 重写（GPT 核验指出三个问题）：
  //    ① 原来 tok = 8 + n*1.6 是写死的公式，只按「核心区标签数」估，
  //       完全没算模型质量词、rating、风格词、保护开关词 —— 严重低估。
  //    ② 不管什么模型都显示 /77，但只有 SD1.5 系才受 CLIP 77 限制。
  //       SDXL 系（Pony/Illustrious/NoobAI/Animagine）的文本编码器没这么窄。
  //    ③ 只统计「核心区」9 个字段，用户看不到整条提示词的体积。
  //
  //  ★ 现在的做法：
  //    · 用【最终实际输出的正向提示词】估，不是只算核心区
  //    · 从 MODEL_PROFILES 读当前模型的 soft/warn 阈值
  //    · SD1.5 系显示 65/75 警戒；SDXL 系只显示估算量，不给假的「上限」
  //    · 明确标注「估算」，不伪装成真实 tokenizer 结果
  //
  //  ★ 估算方法（英文标签）：CLIP 的 BPE 对常见英文单词基本 1 词 1 token，
  //    长词会拆成 2 个。经验公式：token ≈ ceil(字符数 / 4) + 2（含起止符）。
  //    这个偏差在 ±10% 以内，足够做「要不要精简」的判断，但不能当精确值。
  // ══════════════════════════════════════════════════════════════════════════
  function estTokens(text) {
    var t = String(text || '');
    if (!t) return 0;
    // 英文标签：约 4 字符 / token；再加 2 个起止符
    return Math.ceil(t.length / 4) + 2;
  }

  function budgetTxt(pos) {
    var core = BIZ.slice(1, 10), nseg = 0;
    var bycat = {};
    for (var k in SEL) {
      if (!SEL[k]) continue;
      var c = catOf(k), e = k;
      (bycat[c] = bycat[c] || []).push(e);
    }
    core.forEach(function (c) { if (bycat[c]) nseg++; });

    // ★ 用最终正向提示词估 token（含模型质量词/rating/风格/保护词）
    //   ★ 注意：build() 里的 pos 是【数组】，必须先 join 成字符串，
    //     否则 finalPos.split 会抛 "is not a function"（实测踩过）。
    var finalPos;
    if (window.AUTO && AUTO.pos) {
      finalPos = AUTO.pos;                                  // build() 里记录的是字符串
    } else if (Object.prototype.toString.call(pos) === '[object Array]') {
      finalPos = pos.join(', ');
    } else {
      finalPos = String(pos || '');
    }
    var tok = estTokens(finalPos);
    var n = finalPos ? finalPos.split(',').map(function (s) { return s.trim(); }).filter(Boolean).length : 0;

    // ★ 从当前模型的 profile 读阈值
    var PP = window.PROMPT_PROFILES;
    var prof = PP ? PP.get($('model') ? $('model').value : '') : null;
    var soft = prof && prof.softTokenLimit ? prof.softTokenLimit : 0;
    var warn = prof && prof.warnTokenLimit ? prof.warnTokenLimit : 0;

    var mark, limitTxt;
    if (soft || warn) {
      // SD1.5 系：有明确警戒线
      limitTxt = (warn ? '/估算上限 ' + warn : '');
      mark = (warn && tok > warn) ? ' ❌超限'
           : (soft && tok > soft) ? ' ⚠建议精简'
           : ' ✅';
    } else {
      // SDXL 系：不给假的上限，只报估算值和「偏长」提示
      limitTxt = '（估算）';
      mark = tok > 200 ? ' ⚠偏长' : '';
    }

    var nAll = 0;
    BIZ.forEach(function (c) { if (bycat[c] && bycat[c].length) nAll++; });

    // ★ 排序待定词提示（unknownTags 以前是死代码，现在真正用上）
    var unkTxt = '';
    if (AUTO && AUTO.unknown && AUTO.unknown.length) {
      unkTxt = ' · ' + AUTO.unknown.length + '词排序待定';
    }

    return '核心区 ' + nseg + '/9段 · ' + nAll + '/15字段 · ' + n + '词 · 约 ' + tok +
      ' token' + limitTxt + mark + unkTxt;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ★★★ 2026-10-30：精简建议（按 GPT 核验后的方案）
  //
  //  GPT 的要求（原文）：
  //    「不要只显示 xxx（priority 0），用户不知道 priority 0 为什么低，
  //      也无法判断系统是否误判。应显示具体理由。」
  //
  //    「按钮叫『生成精简方案』，不叫『一键精简』。
  //      点击后：计算达到预算所需的最小删除集合 → 展示将删除的标签及原因
  //      → 默认只勾选有明确冗余证据的项 → 用户确认后才应用 → 支持一次性撤销」
  //
  //    「默认绝不能删的项：原文直接命中、用户手工添加、用户手工锁定、
  //      数量标签、仅因为 role=unknown 而成为候选的标签、
  //      仅因为『不是 canonical』但尚未证明同义的标签、
  //      只有上下位关系却没有在当前输出中形成冗余的标签」
  //
  //  ★ 本实现：只【展示】建议，不提供一键应用按钮。
  //    理由：红线是「不因不精确而删」，连「点一下确认」都可能被理解成变相自动删。
  //    用户看完理由后可以自己在界面上取消勾选，完全可控。
  // ══════════════════════════════════════════════════════════════════════════

  // reason → 人类可读文案
  function trimReasonText(rec, tag) {
    var r = rec.reason, rel = rec.relatedTag || '';
    switch (r) {
      case 'user_locked':        return '用户已锁定，永不建议删除';
      case 'system_term':        return '工具按模型自动添加的质量词/评级词';
      case 'direct_exact':       return '原文直接出现';
      case 'count_tag':          return '人数标签（信息量高）';
      case 'alias_leftover':     return '非首选同义词，已有 ' + rel;
      case 'redundant_parent':   return '已有更具体的 ' + rel + '，本词没有独立来源';
      case 'confirmed_noise':    return '已确认的专名噪音';
      case 'canonical':          return '规范标签';
      case 'explicit_attribute': return '明确的属性';
      case 'direct_inferred':    return '仅由相关词推断，原文没有直接说';
      case 'unknown_neutral':    return '未分类（中性，不建议仅因未分类就删）';
      default:                   return '未知原因';
    }
  }

  // 生成精简方案：返回 {need, curTok, warn, items}
  function buildTrimPlan() {
    var P = AUTO.priority;
    if (!P) return null;
    var posArr = (AUTO.pos || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!posArr.length) return null;
    var tok = estTokens(AUTO.pos || '');
    var PP2 = window.PROMPT_PROFILES;
    var prof2 = PP2 ? PP2.get($('model') ? $('model').value : '') : null;
    var warn2 = prof2 && prof2.warnTokenLimit ? prof2.warnTokenLimit : 0;
    if (!warn2) return null;                 // 没设上限的模型不做建议
    if (tok <= warn2) return null;           // 没超预算

    // 可建议删除的等级：只取 0 和 1（2、3 一律不动）
    var items = [];
    for (var i = 0; i < posArr.length; i++) {
      var t = posArr[i];
      var rec = P[t];
      if (!rec) continue;
      if (rec.priority > 1) continue;        // 2/3 保留
      items.push({
        tag: t,
        priority: rec.priority,
        reason: rec.reason,
        text: trimReasonText(rec, t),
        tokens: estTokens(t),
        order: i
      });
    }
    // 排序：先 0 后 1；同级按 token 节省量从大到小
    items.sort(function (a, b) {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (b.tokens !== a.tokens) return b.tokens - a.tokens;
      return a.order - b.order;
    });
    return { need: tok - warn2, curTok: tok, warn: warn2, items: items };
  }

  var TRIM_OPEN = false;
  function renderTrimPanel() {
    var panel = $('trimPanel'), title = $('trimTitle'), body = $('trimBody');
    if (!panel || !title || !body) return;
    var plan = buildTrimPlan();
    if (!plan) { panel.style.display = 'none'; return; }

    var sumTok = 0;
    for (var i = 0; i < plan.items.length; i++) sumTok += plan.items[i].tokens;

    panel.style.display = '';
    var h = [];

    if (!plan.items.length) {
      // ── 超预算但没有任何「有证据适合先删」的词 ──
      //
      //  ★ 这是设计上正确的结论，不是 bug。
      //    GPT 明确说：「Priority 0 应表示『有证据说明它适合先删』，
      //                  不能表示『我们不了解它』。」
      //    所有词都来自用户原文的直接描述，所以都不该被判为冗余。
      //
      //  ★ 但用户确实超预算了，还是得给他决策依据 ——
      //    按 promptRole 列出 token 占用分布，让他自己判断删什么。
      title.textContent = '超出预算约 ' + plan.need + ' token · 没有可自动判定的精简项';
      h.push('<div style="color:var(--muted);margin-bottom:6px">' +
        '这个描述里的每个词都能在你写的原文里找到直接依据，' +
        '<b style="color:#6ec06e">工具不会因为「不确定」就建议删除任何一个</b>。<br>' +
        '下面是各维度各占多少 token，你可以自己决定取舍：</div>');

      var byRole = {};
      var P2 = AUTO.priority || {};
      var posArr2 = (AUTO.pos || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      for (var pi = 0; pi < posArr2.length; pi++) {
        var tt = posArr2[pi];
        var rr = P2[tt];
        if (!rr) continue;
        if (rr.priority >= 3) continue;              // 系统词/锁定词不列
        var rn = 'unknown';
        try {
          var tri = window.TAG_ROLE ? window.TAG_ROLE[tt] : null;
          var rl = (window.PROMPT_PROFILES && window.PROMPT_PROFILES.ROLES) || [];
          if (tri != null && rl[tri]) rn = rl[tri];
        } catch (e) { /* 忽略 */ }
        (byRole[rn] = byRole[rn] || []).push(tt);
      }
      var rows = [];
      for (var k2 in byRole) {
        var arr = byRole[k2];
        var tk = 0;
        for (var ai = 0; ai < arr.length; ai++) tk += estTokens(arr[ai]);
        rows.push({ role: k2, tags: arr, tok: tk });
      }
      rows.sort(function (a, b) { return b.tok - a.tok; });
      h.push('<table style="border-collapse:collapse;width:100%">');
      for (var ri = 0; ri < rows.length; ri++) {
        h.push('<tr><td style="padding:3px 6px;color:#9cdcfe;white-space:nowrap">' +
          rows[ri].role + '</td><td style="padding:3px 6px;color:var(--muted);white-space:nowrap">' +
          rows[ri].tok + ' tok</td><td style="padding:3px 6px;color:var(--muted)">' +
          rows[ri].tags.join(', ') + '</td></tr>');
      }
      h.push('</table>');
      h.push('<div style="margin-top:8px;color:var(--muted)">' +
        '要精简的话，在标签卡上取消勾选即可 —— 取消后这里会实时更新。</div>');
    } else {
      var canFix = sumTok >= plan.need;
      title.textContent = '超出预算约 ' + plan.need + ' token · 有 ' + plan.items.length +
        ' 个词可考虑精简（最多省 ' + sumTok + ' token）' +
        (canFix ? ' · 足够降到预算内' : ' · 可能不足以降到预算内');
      h.push('<div style="color:var(--muted);margin-bottom:6px">' +
        '下面只是建议。<b style="color:#e6c07b">工具不会自动删除任何词</b>，' +
        '你看完理由后自己在界面上取消勾选即可。</div>');
      for (var j = 0; j < plan.items.length; j++) {
        var it = plan.items[j];
        var pr = it.priority === 0 ? '#ff8a8a' : '#e6c07b';
        var prTxt = it.priority === 0 ? '优先删除' : '可考虑';
        h.push('<div style="padding:4px 0;border-top:1px dashed var(--line)">' +
          '<span style="color:' + pr + ';font-weight:600">[' + prTxt + ']</span> ' +
          '<code style="color:#9cdcfe">' + it.tag + '</code>' +
          ' <span style="color:var(--muted)">约省 ' + it.tokens + ' token</span>' +
          '<div style="color:var(--muted);margin-left:8px">原因：' + it.text + '</div>' +
          '</div>');
      }
    }
    body.innerHTML = h.join('');
    body.style.display = TRIM_OPEN ? '' : 'none';
    var bs = $('btnTrimShow'), bh = $('btnTrimHide');
    if (bs) bs.style.display = TRIM_OPEN ? 'none' : '';
    if (bh) bh.style.display = TRIM_OPEN ? '' : 'none';
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  catOf(英文标签) → 业务分类（15 字段之一）
  //
  //  ★ 2026-10-27：SEL 的键从 `分类|标签` 改成纯标签后的配套函数。
  //    动机：词库零重复标签，纯标签做键不会冲突；
  //          标签换分类时选择状态不再丢失（16 类界面解耦的前置条件）。
  //
  //  ★★ GPT 核验改进（2026-10-27）：
  //     · 缓存绑定 LIB 引用 —— 如果第一次调用时 LIB 还没加载，
  //       旧实现会把缓存定成空对象，之后即使 LIB 到位也永远不重建。
  //       现在每次比对 LIB 引用，换了库就重建。
  //     · 用 Object.create(null) —— 避免 __proto__ / constructor 等原型键干扰。
  //     · 校验 n 和 b 长度一致，防止分类数组错位产生错误映射。
  //
  //  ★★★ 返回「未分类」时，调用方【必须】保底消费，不能只遍历 BIZ。
  //        否则扩展库标签/用户自定义标签会静默丢失（已在 build() 里修）。
  // ══════════════════════════════════════════════════════════════════════════
  var _CAT_CACHE = null;
  var _CAT_CACHE_LIB = null;
  function catOf(en) {
    var L = window.LIB;
    if (_CAT_CACHE_LIB !== L) {
      _CAT_CACHE = Object.create(null);
      _CAT_CACHE_LIB = L || null;
      if (L && L.n && L.b) {
        var len = Math.min(L.n.length, L.b.length);
        for (var i = 0; i < len; i++) _CAT_CACHE[L.n[i]] = L.b[i];
      }
    }
    var v = _CAT_CACHE ? _CAT_CACHE[en] : null;
    return (v == null || v === '') ? '未分类' : v;
  }

  function clearAll() {
    // ★ 2026-10-25：清空时保留被钉住的标签。
    //   PINNED 是 {英文标签: true}，按标签名判断，与分类无关。
    //   ★ 只是「清空时跳过」，不改动任何标签数据，也不影响搜索和组装逻辑。
    var kept = [];
    for (var k in SEL) {
      if (!SEL[k]) continue;
      var en = k;
      if (PINNED[en]) kept.push(k);
    }
    DATA = {}; SEL = {}; MANUAL_SEL = {};
    kept.forEach(function (k) { SEL[k] = true; });   // 把钉住的恢复回选择状态
    $('cards').innerHTML = ''; $('q').value = '';
    $('cnt').textContent = ''; $('pos').value = ''; $('neg').value = '';
    $('poszh').textContent = ''; $('negzh').textContent = '';
    $('budget').textContent = '';
    if (kept.length) {
      setStatus('已清空；保留了 ' + kept.length + ' 个钉住的标签');
    } else {
      setStatus('');
    }
  }
  function copyBox(id, btn) {
    copyText($(id).value).then(function () {
      var o = btn.textContent; btn.textContent = '已复制';
      setTimeout(function () { btn.textContent = o; }, 1200);
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // ★ ④ 用户自定义映射 + 选择日志（localStorage，纯前端，file:// 可用）
  // ══════════════════════════════════════════════════════════════════
  var USR_SYN = {};       // {中文: [英文标签]}
  var LS_SYN = 'dsh_user_syn';
  var LS_LOG = 'dsh_sel_log';

  function lsGet(k, def) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; }
    catch (e) { return def; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }

  function loadUserSyn() {
    USR_SYN = lsGet(LS_SYN, {}) || {};
    return Object.keys(USR_SYN).length;
  }

  function applyUserSyn() {
    if (!E || !E.SYN) return;
    for (var k in USR_SYN) {
      var vals = USR_SYN[k];
      if (!Array.isArray(vals)) vals = [vals];
      var ok = [];
      for (var i = 0; i < vals.length; i++) {
        var t = String(vals[i]).trim();
        if (t && (E.EN2CN[t] !== undefined || E.CN2EN[t])) ok = ok.concat(
          E.EN2CN[t] !== undefined ? [t] : (E.CN2EN[t] || []));
      }
      if (ok.length) E.SYN[k] = ok;
    }
  }

  function addUserSyn() {
    var s = prompt('添加自定义映射\n格式：中文=英文标签（多个用逗号）\n例：翘臀=ass,top-down_bottom-up', '');
    if (!s) return;
    var p = s.split('=');
    if (p.length < 2) { alert('格式不对，要写成 中文=英文'); return; }
    var cn = p[0].trim();
    var ens = p.slice(1).join('=').split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (!cn || !ens.length) { alert('中文或英文为空'); return; }
    USR_SYN[cn] = (USR_SYN[cn] || []).concat(ens).filter(function (x, i, a) { return a.indexOf(x) === i; });
    if (!lsSet(LS_SYN, USR_SYN)) { alert('保存失败（浏览器不允许本地存储）'); }
    applyUserSyn();
    doMatch();
    setStatus('已添加自定义映射：' + cn + ' → ' + ens.join(', '));
  }

  function listUserSyn() {
    var ks = Object.keys(USR_SYN);
    if (!ks.length) { alert('还没有自定义映射'); return; }
    var s = prompt('自定义映射共 ' + ks.length + ' 条：\n（清空内容并确定 = 全部删除）\n\n' +
      ks.map(function (k) { return k + ' = ' + (USR_SYN[k] || []).join(','); }).join('\n'),
      ks.map(function (k) { return k + '=' + (USR_SYN[k] || []).join(','); }).join('\n'));
    if (s === null) return;
    if (!s.trim()) {
      if (!confirm('确定删除全部 ' + ks.length + ' 条自定义映射？')) return;
      USR_SYN = {};
      lsSet(LS_SYN, {});
      setStatus('已清空自定义映射');
      return;
    }
    // 逐行重建
    var nw = {};
    s.split('\n').forEach(function (line) {
      var q = line.split('=');
      if (q.length < 2) return;
      var c0 = q[0].trim();
      var e0 = q.slice(1).join('=').split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (c0 && e0.length) nw[c0] = e0;
    });
    USR_SYN = nw;
    lsSet(LS_SYN, USR_SYN);
    setStatus('已保存 ' + Object.keys(nw).length + ' 条自定义映射');
  }

  function logSel(action, it, cat, sub) {
    var log = lsGet(LS_LOG, []) || [];
    log.push({
      t: Date.now(),
      q: ($('q').value || '').slice(0, 120),
      en: it.en,
      cn: it.cn || '',
      cat: cat,
      sub: sub || '',
      a: action
    });
    if (log.length > 3000) log = log.slice(-3000);
    lsSet(LS_LOG, log);
  }

  function showLog() {
    var log = lsGet(LS_LOG, []) || [];
    if (!log.length) { alert('还没有选择记录'); return; }
    // 统计：被选次数最多的词
    var cnt = {};
    log.forEach(function (x) { if (x.a === 'add') cnt[x.en] = (cnt[x.en] || 0) + 1; });
    var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 40);
    var d = new Date(log[0].t);
    var msg = '选择记录 ' + log.length + ' 条（从 ' +
      (d.getMonth() + 1) + '/' + d.getDate() + ' 起）\n\n被选最多的词：\n' +
      top.map(function (k, i) { return (i + 1) + '. ' + k + '  ×' + cnt[k]; }).join('\n') +
      '\n\n（确定后【清空】这些记录）';
    if (confirm(msg)) {
      lsSet(LS_LOG, []);
      setStatus('选择记录已清空');
    }
  }

  function exportLog() {
    var log = lsGet(LS_LOG, []) || [];
    if (!log.length) { alert('还没有选择记录'); return; }
    var lines = ['时间,描述,英文标签,中文,字段,小类,动作'];
    log.forEach(function (x) {
      var d = new Date(x.t);
      lines.push([
        d.toLocaleString(),
        '"' + String(x.q || '').replace(/"/g, '""') + '"',
        x.en, '"' + String(x.cn || '').replace(/"/g, '""') + '"',
        x.cat, x.sub, x.a === 'add' ? '选中' : '取消'
      ].join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '选择日志_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setStatus('已导出 ' + log.length + ' 条记录');
  }

  // ── 事件 ──
  window.addEventListener('DOMContentLoaded', function () {
    boot();
    $('btnMatch').onclick = doMatch;
    $('btnClear').onclick = clearAll;
    $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') doMatch(); });
    $('tier').onchange = doMatch;
    $('model').onchange = onModel;
    $('rating').onchange = build;
    // ★★★ 2026-10-23 三轮修复（GPT 指出）：排列下拉框之前【没有绑定】
    //   用户切换「模型推荐 / 旧版兼容顺序 / 普通标签按我的顺序」后，
    //   输出不会立即变化，必须再动别的控件才刷新 —— 这是实测第一件会操作的事。
    //   手动编辑状态下 build() 不会覆盖文本框，这里补一个提示，避免用户以为功能失效。
    // ★ 2026-10-24：界面已移除排列下拉框（只保留「模型推荐」一种模式），
    //   所以这段 onchange 绑定不再需要。$('orderMode') 恒为 null，
    //   整个 if 块变成死代码，直接删掉避免误导后来的人。
    ['chkHand', 'chkDec', 'chkFur', 'chkColor', 'chkBody'].forEach(function (id) {
      if ($(id)) $(id).onchange = build;
    });
    $('btnStyle').onclick = function () { addStyle(false); };
    $('btnExcl').onclick = function () { addStyle(true); };
    $('btnClearStyle').onclick = function () { STYLES = []; renderStyles(); build(); setStatus('已清空风格'); };
    $('btnHi').onclick = function () { setConf('high'); };
    $('btnHiMid').onclick = function () { setConf('high', 'mid'); };
    $('btnNone').onclick = function () { setAll(false); };
    // ★ 接地检查开关：切换后立即重跑（不需要重新点匹配）
    if ($('chkGround')) $('chkGround').onchange = doMatch;
    // ★ 高命中自动组装开关
    if ($('chkAuto')) $('chkAuto').onchange = doMatch;
    // ★ 互斥处理开关
    if ($('chkMutex')) $('chkMutex').onchange = function () {
      MUTEX_OFF = !$('chkMutex').checked;
      build();
    };
    MUTEX_OFF = $('chkMutex') ? !$('chkMutex').checked : false;
    // ★★★ 2026-10-30：16 类视图开关
    //   GPT 要求「切换时断言 SEL 完全不变」—— 这里显式做断言，
    //   开发期一旦发现选择丢失会立即报警。
    if ($('chkLayoutV2')) $('chkLayoutV2').onchange = function () {
      var before = JSON.stringify(SEL);
      var beforeN = 0;
      for (var _k in SEL) if (SEL[_k]) beforeN++;
      LAYOUT_V2 = !!$('chkLayoutV2').checked;
      render();
      var after = JSON.stringify(SEL);
      var afterN = 0;
      for (var _k2 in SEL) if (SEL[_k2]) afterN++;
      if (before !== after || beforeN !== afterN) {
        // 理论上不可能发生 —— 布局只是投影，不碰 SEL
        console.error('[布局切换] SEL 被意外修改！', { beforeN: beforeN, afterN: afterN });
        setStatus('⚠ 布局切换时选择状态异常，请反馈（' + beforeN + ' → ' + afterN + '）');
      } else {
        setStatus(LAYOUT_V2
          ? '已切到 16 类视图 · 勾选 ' + afterN + ' 个（内容不变）'
          : '已切回 15 字段视图 · 勾选 ' + afterN + ' 个（内容不变）');
      }
      build();
    };
    // ★ 组装控制
    if ($('btnAppend')) $('btnAppend').onclick = function () { appendWords('pos'); appendWords('neg'); };
    if ($('btnAppendPos')) $('btnAppendPos').onclick = function () { appendWords('pos'); };
    if ($('btnAppendNeg')) $('btnAppendNeg').onclick = function () { appendWords('neg'); };
    if ($('btnRestore')) $('btnRestore').onclick = restoreAuto;
    // ★★★ 2026-10-30：精简建议区的展开/收起
    //   ★ 只有「查看/收起」，没有「应用」按钮 —— 工具不替用户删任何东西。
    if ($('btnTrimShow')) $('btnTrimShow').onclick = function () {
      TRIM_OPEN = true; renderTrimPanel();
    };
    if ($('btnTrimHide')) $('btnTrimHide').onclick = function () {
      TRIM_OPEN = false; renderTrimPanel();
    };
    // 手动开关：勾上=锁定当前内容不被覆盖
    if ($('chkManual')) $('chkManual').onchange = function () {
      var v = $('chkManual').checked;
      MANUAL.pos = MANUAL.neg = v;
      updateHints();
      setStatus(v ? '已切手动输入：自动组装不再覆盖文本框' : '已切自动输入');
      if (!v) build();
    };
    // ★ 文本框可编辑 → 检测手动改动
    ['pos', 'neg'].forEach(function (w) {
      var el = $(w);
      el.addEventListener('input', function () { onEdit(w); });
      // 统一走 build 逻辑（避免各处手动调 build 造成覆盖）
      el.addEventListener('blur', function () { onEdit(w); });
    });
    // 组装相关控件变化时更新文本框
    ['rating', 'model'].forEach(function (id) {
      var old = $(id).onchange;
      $(id).onchange = function (e) { if (old) old.call(this, e); build(); };
    });
    // ★ 右键菜单
    if ($('ctxmenu')) {
      $('ctxmenu').onclick = function (e) {
        var act = e.target && e.target.dataset ? e.target.dataset.act : '';
        if (act === 'pos') ctxAddPositive();
        else if (act === 'neg') ctxAddNegative();
        else if (act === 'copy') ctxCopy();
        else if (act === 'search') ctxSearch();
        else if (act === 'pin') ctxPin();
        else if (act === 'unpin') ctxUnpin();
        hideCtx();
      };
    }
    document.addEventListener('click', function (e) {
      if ($('ctxmenu') && !$('ctxmenu').hidden && !$('ctxmenu').contains(e.target)) hideCtx();
      if ($('hintbox') && !$('hintbox').hidden && !$('hintbox').contains(e.target)
          && !(e.target.closest && e.target.closest('.row'))) hideHint();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { hideCtx(); hideHint(); }
    });
    window.addEventListener('scroll', function () { hideCtx(); hideHint(); }, true);
    // ★ 复制选中行 / 全部结果
    if ($('btnCopySel')) $('btnCopySel').onclick = copySel;
    if ($('btnCopyAll')) $('btnCopyAll').onclick = copyAll;
    // ★ 锁定 / 翻译
    if ($('btnLockPos')) $('btnLockPos').onclick = function () { toggleLock('pos', this); };
    if ($('btnLockNeg')) $('btnLockNeg').onclick = function () { toggleLock('neg', this); };
    if ($('btnZhPos')) $('btnZhPos').onclick = function () { translateBox('pos'); };
    if ($('btnZhNeg')) $('btnZhNeg').onclick = function () { translateBox('neg'); };
    // ★★ 自定义映射 / 映射管理 / 选择记录 / 导出
    //    这 4 个按钮之前【完全没有绑定】，点了毫无反应，对应功能全部不可用
    if ($('btnUserSyn')) $('btnUserSyn').onclick = addUserSyn;
    if ($('btnUserList')) $('btnUserList').onclick = listUserSyn;
    if ($('btnLog')) $('btnLog').onclick = showLog;
    if ($('btnLogCsv')) $('btnLogCsv').onclick = exportLog;
    // ★ 风格变化时应用跳过增量（手动模式下也生效）
    var oldStyle = window.__afterStyleChange;
    window.__afterStyleChange = function () {
      applySkipDelta('pos'); applySkipDelta('neg');
      if (oldStyle) oldStyle();
    };
    updateHints();
    // ★ 2026-10-24：扩展库的按钮绑定留在这里，但 renderExtra 的定义已移到
    //   IIFE 顶层（见 doMatch 附近）—— 因为 doMatch 在同一层作用域里调用它，
    //   放在 DOMContentLoaded 内部会导致 doMatch 找不到这个函数。
    if ($('btnExtra')) $('btnExtra').onclick = function () {
      if (EXTRA_ON) {
        EXTRA_ON = false;
        this.textContent = '🔎 角色/作品/画师库';
        this.title = '已关闭。再点开启。';
        var b0 = $('extracards'); if (b0) b0.innerHTML = '';
        return;
      }
      var self = this;
      self.disabled = true;
      self.textContent = '⏳ 加载中…';
      window.TagExtra.load().then(function () {
        EXTRA_ON = true;
        self.disabled = false;
        var st = window.TagExtra.stats();
        self.textContent = '🎭 角色/作品/画师库（已开）';
        self.title = '角色 ' + st.chars.toLocaleString() + ' 条 · 作品 ' +
          st.copyrights.toLocaleString() + ' 条 · 画师 ' + (st.artists || 0).toLocaleString() + ' 条\n再点关闭。\n来源：ai-prompt-supermarket（MIT）';
        var q = $('q') ? $('q').value.trim() : '';
        if (q) renderExtra(q);
      }).catch(function (e) {
        self.disabled = false;
        self.textContent = '🔎 角色/作品/画师库';
        setStatus('扩展库加载失败：' + e.message);
      });
    };

    renderStyles();
    updateTierInfo();

    // ══════════════════════════════════════════════════════════════════════
    //  ★★★ 2026-10-23 自动化测试钩子
    //
    //  为什么需要：
    //    SEL / build() 都在 IIFE 作用域里，外部测试拿不到。
    //    靠「模拟点击界面」来测组装顺序既慢又不稳。
    //
    //  安全性（2026-10-23 三轮修正，GPT 指出原文描述不准确）：
    //    · 这个是纯本地离线页，没有鉴权数据/服务端权限，不是安全边界
    //    · setSel/getSel 现在都做浅拷贝，不把内部 SEL 引用交出去，
    //      否则调用方拿到 getSel() 后可以直接改内部状态
    //    · 正常用户路径完全不依赖 __TEST
    //    · 若将来要正式发布，可用 window.__ENABLE_TEST_HOOKS__ 条件化掉
    // ══════════════════════════════════════════════════════════════════════
    function shallowCopy(o) {
      var r = {};
      for (var k in (o || {})) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k];
      return r;
    }
    window.__TEST = {
      setSel: function (obj) { SEL = shallowCopy(obj); build(); },
      getSel: function () { return shallowCopy(SEL); },
      rebuild: function () { build(); },
      pos: function () { var e = $('pos'); return e ? e.value : ''; },
      neg: function () { var e = $('neg'); return e ? e.value : ''; },
      setModel: function (m) { var e = $('model'); if (e) e.value = m; },
      // ★ 2026-10-24：界面已无排列下拉框，setMode 直接改变量（仅供自动化测试）
    setMode: function (m) { ORDER_MODE = m; },
      setRating: function (r) { var e = $('rating'); if (e) e.value = r; },
      chk: function (id, v) { var e = $(id); if (e) e.checked = !!v; },
      // 拆成数组便于断言
      posList: function () {
        return this.pos().split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      },
      // ★ 2026-10-30：暴露 priority 供自动化测试与界面提示
      //   AUTO 是闭包内的局部变量，必须通过这里转发出去。
      priority: function () { return AUTO.priority || null; },
      priorityOf: function (tag) {
        var p = AUTO.priority;
        return (p && p[tag]) ? p[tag] : null;
      },
      // 同时挂到 window.AUTO，修掉 budgetTxt 里 window.AUTO 从未被赋值的潜在问题
      syncAuto: function () { window.AUTO = AUTO; return AUTO; }
    };
  });
})();
