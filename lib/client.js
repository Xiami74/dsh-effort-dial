/**
 * dsh-effort-dial —— 浏览器半边（browser half）
 * ============================================================================
 * 手写的**经典脚本**，没有任何构建步骤：宿主侧 `@deepseek-ai/dsh-client-modules`
 * 只按 `exports["./client"]` 读文件字节，组合进 combo 后由 shell 以 <script> 执行。
 * 因此：
 *   - 不能用 import/export（会语法错误）；
 *   - 顶层必须同步调用 window.__ModuleLoader__.load({ id, factory })；
 *   - factory 里能 require 的只有平台种子：
 *     react / react-dom / react/jsx-runtime / @deepseek-ai/cordis /
 *     @deepseek-ai/dsh-client-store / dsh-client-ui-slots /
 *     dsh-client-ui-primitives / dsh-client-ui-dockkit。
 *
 * 做的事：**官方模型菜单同款的推理等级滑条**。
 *   - 收起态：composer 里 `模型名 · 档位名 ⌄`（档位文字按位置着色）
 *   - 点开是官方菜单同款两行：模型 / 推理等级，第二行下面铺满整条滑条
 *   - 滑条 = 四层叠加（底轨 / 蓝到紫的填充 / 紫色能量星云 / 整轨横穿的星尘）
 *   - 颜色、能量、粒子数、粒子速度**全部由旋钮位置连续驱动**，不是四档开关
 *
 * 数据全部来自 DSH 真实会话，没有任何假数据：
 *   读 = modelSelection 投影，列 = modelCatalog，写 = remote.session.selectModel。
 *
 * 性能约定：拖动期间**不触发 React 重渲染**，全部走 paint() 直接写 style；
 * 只有提交（松手 / 键盘 / 重置）才改 state。22 颗星尘每帧重渲染会掉帧。
 */
window.__ModuleLoader__.load({
  id: '@xiami74/dsh-effort-dial',
  factory: (require) => {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const PLUGIN_ID = '@xiami74/dsh-effort-dial'
    /**
     * 挂载点：`conversation.input.model` 是 single 槽，原生 ModelSelect 用默认
     * priority 0 注册；slot 语义「priority 越低越优先」，所以 -1 遮蔽它，
     * 由本插件接管「模型 / 推理强度」这一格的入口。
     */
    const SLOT = 'conversation.input.model'
    const SLOT_PRIORITY = -1
    const NAMESPACE = '@xiami74/dsh-effort-dial'
    const SETTINGS_KEY = '@xiami74/dsh-effort-dial:settings'

    /* ---------- 几何：CSS 与拖拽计算共用同一组数字 ---------- */
    const MENU_W = 340
    /** 轨道高 = 旋钮直径：圆心只在 [14px, 宽 − 14px] 之间走，圆永远是完整的圆。 */
    const TRACK_H = 28
    const KNOB_D = 28
    const TRACK_INSET = TRACK_H / 2

    /* ---------- 色彩与粒子（位置连续驱动） ---------- */
    const COLOR_BLUE = [77, 147, 248]      /* #4d93f8 */
    const COLOR_PURPLE = [147, 51, 234]    /* #9333ea */
    const COLOR_DEEP = [76, 29, 149]       /* #4c1d95 */
    const COLOR_TEXT_BLUE = [77, 147, 248]
    const COLOR_TEXT_VIOLET = [139, 92, 246] /* #8b5cf6 —— 白底 4.23:1 / 深底 4.02:1 */
    const STAR_MAX = 22
    /** 星尘横穿基准时长（秒）：speed=1 时 3s，MAX(2×) 1.5s，最低速(0.35×) 8.6s。 */
    const STAR_BASE = 3
    const STAR_SPREAD = 0.08
    /** 最高档副标题位置显示的额度提醒（Codex 原文）。 */
    const QUOTA_HINT = '使用额度消耗更快'

    /** 第 ratio 档时，拖柄圆心 / 刻度点相对轨道的 left 值（两端各留半个轨道高）。 */
    const posAt = (ratio) =>
      'calc(' + TRACK_INSET + 'px + (100% - ' + TRACK_H + 'px) * ' + ratio + ')'

    /* ======================================================================
     * 一、纯函数：位置 → 颜色 / 能量 / 粒子数 / 速度
     *   全部按**位置**算，与档位数无关（2 档和 6 档看到的是同一条曲线）。
     * ==================================================================== */
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
    const smooth = (t) => {
      const x = clamp(t, 0, 1)
      return x * x * (3 - 2 * x)
    }
    const mix = (a, b, t) => [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ]
    const rgbStr = (c) => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'

    /** 确定性伪随机（不用 Math.random）：重渲染不跳变，且可离线断言。 */
    function hash01(x) {
      const s = Math.sin(x * 127.1 + 311.7) * 43758.5453
      return s - Math.floor(s)
    }

    /** 填充层右端色：1/3 前恒蓝 → 2/3 紫罗兰 → 满档深紫。 */
    function colorAt(p) {
      if (p <= 1 / 3) return COLOR_BLUE.slice()
      if (p <= 2 / 3) return mix(COLOR_BLUE, COLOR_PURPLE, smooth((p - 1 / 3) / (1 / 3)))
      return mix(COLOR_PURPLE, COLOR_DEEP, smooth((p - 2 / 3) / (1 / 3)))
    }

    /** 能量层强度：1/3 前恒 0（左半段是干净的蓝），2/3 是 0.5，满档 1。 */
    function energyAt(p) {
      if (p <= 1 / 3) return 0
      if (p <= 2 / 3) return 0.5 * smooth((p - 1 / 3) / (1 / 3))
      return 0.5 + 0.5 * smooth((p - 2 / 3) / (1 / 3))
    }

    /** 星尘数量：0 → 11（2/3）→ 22（满档）。 */
    function countAt(p) {
      if (p <= 1 / 3) return 0
      if (p <= 2 / 3) return Math.round(11 * smooth((p - 1 / 3) / (1 / 3)))
      return Math.round(11 + 11 * smooth((p - 2 / 3) / (1 / 3)))
    }

    /** 星尘速度倍率：0.35×（慢悠悠）→ 1×（2/3，就该这么快）→ 2×（满档）。 */
    function speedAt(p) {
      if (p <= 1 / 3) return 0.35
      if (p <= 2 / 3) return 0.35 + 0.65 * smooth((p - 1 / 3) / (1 / 3))
      return 1 + smooth((p - 2 / 3) / (1 / 3))
    }

    /* ---------------- 档位阻尼（磁吸） ---------------- */

    /** 吸附半径（像素）：旋钮离刻度这么近就开始被"吸"。 */
    const DENT_R_PX = 20
    /** 吸力（0~1）：1 = 刻度正中完全钉住，0.95 留一点点活气，不至于发死。 */
    const DENT_STRENGTH = 0.95

    /**
     * 指针位置 → 实际显示位置，在档位刻度附近做磁吸。
     *
     * 衰减曲线 u = (1 − (d/r)²)²：刻度正中吸力最强，到半径 r 处归零。
     * 因为吸力**只在 r 内**存在，r 外是 1:1 跟手，所以：
     *   · 慢拖 → 每格都被"钉"一下，有逐档阻尼感；
     *   · 快拖 → 指针事件一步跨过整个吸附圈，吸力≈0，旋钮直接贴指针，不会掉队；
     *   · 它是纯函数（位置只由当前指针决定，不累加），所以永远不会漂移。
     *
     * @returns {{shown:number, tick:number, radius:number, hold:number, inDent:boolean}}
     */
    function dentInfo(pct, total, radiusPct) {
      const p = clamp(pct, 0, 1)
      const n = Math.max(1, Math.round(total) || 1)
      if (n <= 1) return { shown: p, tick: 0, radius: 0, hold: 0, inDent: false }
      const step = 1 / (n - 1)
      /* 吸附圈最大不超过档距的 49%，否则相邻两格会互相拉扯出"粘住不动"的区间。 */
      const r = clamp(radiusPct > 0 ? radiusPct : 0.07, 0, step * 0.49)
      const k = clamp(Math.round(p / step), 0, n - 1)
      const tick = k * step
      const d = Math.abs(p - tick)
      if (r <= 0 || d >= r) return { shown: p, tick: tick, radius: r, hold: 0, inDent: false }
      const u = d / r
      const t = 1 - u * u
      const hold = t * t
      return {
        shown: p + (tick - p) * DENT_STRENGTH * hold,
        tick: tick,
        radius: r,
        hold: hold,
        inDent: hold >= 0.5,
      }
    }

    /** 官方那一行的数值文字：蓝 → 靛 → 紫罗兰；Off 档返回空串（不写内联色 = 官方灰）。 */
    function textColorAt(p) {
      if (p <= 0.001) return ''
      return rgbStr(mix(COLOR_TEXT_BLUE, COLOR_TEXT_VIOLET, smooth(p)))
    }

    /* ---------------- 厂牌标识 ----------------
     * 二级菜单改成"标签页 + 模型卡"后，厂牌本身就是标签页，不再需要彩色胶囊了。
     * 只剩一件事要做：把官方 API 那两条和第三方中转区分开（都叫 deepseek）。
     * ------------------------------------------------------------------ */
    /** 官方 API 分组（DSH 自带账号那条路），和第三方中转区分开。 */
    function isOfficialGroup(group) {
      const id = String((group && group.id) || '').toLowerCase()
      const name = String((group && group.name) || '').toLowerCase()
      return id === 'deepseek' || id === 'deepseek-account' || name === 'deepseek'
    }


    /** 星尘布局：相位用哈希铺开；高度是确定性随机排列，且相位相邻两颗至少差 28%。 */
    function buildStarLayout() {
      const raw = []
      for (let i = 0; i < STAR_MAX; i++) {
        raw.push({ i: i, p: hash01(i * 1.37 + 0.5) * 0.98 + 0.01 })
      }
      const sorted = raw.slice().sort((a, b) => a.p - b.p)
      const slots = STAR_MAX
      const out = []
      for (let k = 0; k < sorted.length; k++) {
        const item = sorted[k]
        /* 高度槽间隔 7：相邻相位（会一直并排走）差 7 槽 = 28% 轨道高（0.84 / 21 × 7），
           星尘最大直径只占轨道高 12.9%，所以永远不会并成一坨。 */
        const slot = (k * 7 + 3) % slots
        const y = 0.08 + 0.84 * (slot / Math.max(1, slots - 1))
        const b = 0.5 + 0.5 * hash01(item.i * 3.71 + 1.3)
        const band = item.i % 3
        out.push({
          key: item.i,
          phase: item.p,
          y: y,
          bright: b,
          size: band === 0 ? 1.8 : band === 1 ? 2.8 : 3.6,
          color: band === 0 ? '#dce5ff' : band === 1 ? '#e6dbff' : '#ffffff',
          jitter: 1 + (hash01(item.i * 5.19 + 2.7) - 0.5) * 2 * STAR_SPREAD,
          seed: hash01(item.i * 9.13 + 4.1),
        })
      }
      return out
    }

    /* ======================================================================
     * 二、档位文案兜底
     *   优先用适配器给的 effort.name；只有 id 时按 id 映射到 Codex 五档文案。
     * ==================================================================== */
    const CODEX_TIERS = [
      { short: '轻度', full: '快速思考', desc: '不进行额外思考，响应最快' },
      { short: '标准', full: '思考中', desc: '针对简单问题快速作答' },
      { short: '深度', full: '进阶思考', desc: '针对高难度问题提供更深入的分析' },
      { short: '极高', full: '极高 Thinking', desc: '面向复杂推理与长链路任务' },
      { short: '深入', full: '深度思考', desc: '使用额度消耗更快' },
    ]
    const CODEX_TIER_BY_ID = {
      none: 0, min: 0, minimal: 0, minimal_effort: 0, off: 0,
      low: 1, light: 1,
      standard: 2, medium: 2, normal: 2, default: 2,
      high: 3, extended: 3, xhigh: 3, 'x-high': 3,
      max: 4, ultra: 4, deepest: 4,
    }

    /** 档位显示文案：DSH 给了 name 就用 DSH 的，否则回落到 Codex 文案。 */
    function tierText(effort, index, total) {
      const id = String((effort && effort.id) || '')
      const lower = id.toLowerCase()
      const hasOwnName =
        effort && typeof effort.name === 'string' && effort.name.length > 0 && effort.name !== id
      /* 档位对应的内置文案（按 id 认，认不出就按位置推）。 */
      let presetTier = CODEX_TIER_BY_ID[lower]
      if (presetTier === undefined) {
        presetTier = clamp(total <= 1 ? 2 : Math.round((index / Math.max(1, total - 1)) * 4), 0, 4)
      }
      const presetDesc = CODEX_TIERS[presetTier].desc
      if (hasOwnName) {
        /* DSH 给每档都带了 name（Low/Medium/High…），所以这里以前直接拿
           effort.description —— 大多数模型根本没有 description，说明行就空了。
           现在没有就用内置描述兜底。 */
        return { short: effort.name, full: effort.name, desc: effort.description || presetDesc }
      }
      const preset = CODEX_TIERS[presetTier]
      return {
        short: preset.short,
        full: preset.full,
        desc: (effort && effort.description) || preset.desc,
      }
    }

    /**
 * 只有「最贵那一档」才配的彩蛋档位：max / ultra。
 * 注意用 id 判，不用 index —— 3 档模型的顶格叫 high，不该白嫖这个效果。
 */
function isMaxEffort(effort) {
  const id = String((effort && effort.id) || '').toLowerCase()
  return id === 'max' || id === 'ultra'
}

/** Off / 关闭 / 无 这类档位：不上色、也不点亮能量，保持官方灰。 */
    function isOffEffort(effort) {
      if (!effort) return false
      const words = [String(effort.id || ''), String(effort.name || '')]
      return words.some((w) => {
        const s = w.trim().toLowerCase()
        return s === 'off' || s === 'none' || s === '关闭' || s === '无' || s === '不思考'
      })
    }

    /* ======================================================================
     * 三、样式
     *   触发器与浮层共用一套变量：菜单 portal 到 document.body，
     *   不再是 .dsces-root 的后代，所以两处都必须声明 token（PITFALLS 第 3 条）。
     * ==================================================================== */
    const CSS = `
.dsces-root,.dsces-pop{
  --dsces-card:#2a2b2e; --dsces-line:rgba(255,255,255,.08);
  --dsces-sub:#9a9aa2; --dsces-sub-hover:#e8e8ea;
  --dsces-track:#3f3f44; --dsces-dot:#63636b; --dsces-knob:#ffffff;
  --dsces-accent:#4d93f8; --dsces-accent-2:#7c6ae9;
  --dsces-dim:#6f6f78;
  /* 「推理等级」彩色动画字：深色底用亮一档的三色 */
  --dsces-lg1:#38bdf8; --dsces-lg2:#a78bfa; --dsces-lg3:#fb7185;
  --dsces-glow:rgba(139,92,246,.55);
  --dsces-shadow:0 18px 48px rgba(0,0,0,.5),0 2px 8px rgba(0,0,0,.4);
}
/* 浅色只在「html 与 body 都没有深色标记」时启用：属性挂哪一层都不会误判。 */
html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) .dsces-root,
html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) .dsces-pop{
  --dsces-card:#ffffff; --dsces-line:rgba(0,0,0,.08);
  --dsces-sub:#6b6b73; --dsces-sub-hover:#1b1c20;
  --dsces-track:#e6e6ea; --dsces-dot:#c0c0c8;
  --dsces-dim:#8a8a92;
  /* 浅色底要压深，否则白底上读不出来；光晕也跟着减弱，免得起雾 */
  --dsces-lg1:#2563eb; --dsces-lg2:#7c3aed; --dsces-lg3:#db2777;
  --dsces-glow:rgba(124,58,237,.3);
  --dsces-shadow:0 18px 48px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.08);
}

/* ---------- composer 入口：贴官方 ModelSelect 的样子 ---------- */
.dsces-root{
  display:inline-flex; align-items:center; min-width:0;
  font-family:var(--dsw-font-family,system-ui,sans-serif);
}
.dsces-chip{
  display:inline-flex; align-items:center; gap:5px; height:28px;
  padding:0 7px 0 9px; border:1px solid transparent; border-radius:8px; background:transparent;
  color:var(--dsw-alias-label-caption,var(--dsces-sub)); font-size:13px; line-height:1;
  cursor:pointer; font-family:inherit; max-width:100%; min-width:0;
  transition:background .14s ease,border-color .14s ease;
}
.dsces-chip:hover:not(:disabled),
.dsces-chip.is-open{
  background:color-mix(in srgb,var(--dsw-alias-label-caption,#9a9aa2) 12%,transparent);
  border-color:var(--dsces-line);
}
.dsces-chip:disabled{ cursor:default; opacity:.55; }
.dsces-chipLabel{
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:150px;
  color:var(--dsw-alias-label-primary,var(--dsces-sub-hover));
}
.dsces-chipEffort{
  font-size:13px; color:var(--dsw-alias-label-caption,var(--dsces-sub));
  transition:color .18s ease; flex:none;
}
.dsces-chev{ width:12px; height:12px; flex:none; opacity:.75; }

/* ---------- 菜单（官方同款两行 + 第二行下面的滑条） ---------- */
.dsces-pop{
  position:fixed; z-index:2147483000; box-sizing:border-box;
  width:${MENU_W}px; padding:6px;
  display:flex; flex-direction:column; overflow:hidden;
  background:var(--dsces-card); color:var(--dsces-sub-hover);
  box-shadow:var(--dsces-shadow);
  border:1px solid var(--dsces-line);
  border-radius:14px;
  font-family:var(--dsw-font-family,system-ui,sans-serif);
  animation:dsces-in .16s cubic-bezier(.22,1.1,.36,1);
  transform-origin:bottom right;
}
@keyframes dsces-in{ from{opacity:0; transform:translateY(8px) scale(.985)} to{opacity:1; transform:none} }

.dsces-row{
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  min-height:36px; padding:7px 10px;
}
.dsces-row .dsces-lab{ color:var(--dsces-sub); font-size:13px; flex:none; }
.dsces-labRow{ display:inline-flex; align-items:center; gap:5px; min-width:0; }
/* 「推理等级」彩色动画字：渐变缓慢往返 + 光晕呼吸。
   为什么不是匀速跑：滑条里已经有星尘在飘、能量在扫，标签再匀速流动就成了第三个"动的东西"，
   而且匀速的渐变字很容易被读成"正在加载"。往返 + 呼吸更像字本身在发光。
   注意 color:transparent 必须压过 .dsces-row .dsces-lab 的 color，所以这里带上了行选择器。 */
.dsces-row .dsces-lab.is-glow{
  font-weight:500;
  background-image:linear-gradient(90deg,var(--dsces-lg1),var(--dsces-lg2),var(--dsces-lg3),var(--dsces-lg2),var(--dsces-lg1));
  background-size:200% 100%;
  -webkit-background-clip:text; background-clip:text;
  color:transparent;
  animation:dsces-label-drift 9s ease-in-out infinite,dsces-label-glow 4s ease-in-out infinite;
}
@keyframes dsces-label-drift{
  0%{ background-position:0% 50% }
  50%{ background-position:100% 50% }
  100%{ background-position:0% 50% }
}
@keyframes dsces-label-glow{
  0%,100%{ filter:drop-shadow(0 0 0 transparent) }
  50%{ filter:drop-shadow(0 0 5px var(--dsces-glow)) }
}
/* 模型入口并入「推理等级」这一行：整块可点，点开是模型列表。 */
.dsces-modelBtn{
  display:inline-flex; align-items:center; gap:4px; min-width:0; max-width:100%;
  margin-left:auto; padding:3px 4px; border:0; border-radius:7px;
  background:transparent; color:var(--dsces-sub-hover); font:inherit; font-size:13px;
  cursor:pointer; transition:background .14s ease;
}
.dsces-modelBtn:hover:not(:disabled){ background:color-mix(in srgb,var(--dsces-sub-hover) 9%,transparent); }
.dsces-modelBtn:disabled{ cursor:default; opacity:.6; }
.dsces-modelBtn:focus-visible{ outline:none; box-shadow:0 0 0 2px rgba(139,92,246,.45); }
.dsces-modelName{
  flex:0 1 auto; min-width:0; max-width:152px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:12px; color:var(--dsces-sub);
}
/* 闪电开关：不要方框、不要底、不要文字标签，只剩一个图标靠颜色区分开/关。 */
.dsces-boost{
  display:inline-flex; align-items:center; justify-content:center;
  width:18px; height:18px; padding:0; flex:none;
  border:0; background:none; box-shadow:none; cursor:pointer;
  color:var(--dsces-sub);
  transition:color .16s ease,filter .16s ease,transform .12s ease;
}
.dsces-boost:hover{ color:var(--dsces-sub-hover); }
.dsces-boost:active{ transform:scale(.9); }
.dsces-boost.is-on{ color:#8b5cf6; filter:drop-shadow(0 0 5px rgba(139,92,246,.5)); }
.dsces-boost.is-on:hover{ color:#7c3aed; }
.dsces-boost[disabled]{ cursor:default; opacity:.35; }
.dsces-boostGlyph{ display:block; width:12px; height:12px; }
html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) .dsces-boost.is-on{ color:#7c3aed; }
.dsces-row .dsces-val{
  color:var(--dsces-sub-hover); font-size:13px;
  display:inline-flex; align-items:center; gap:5px; min-width:0;
}
.dsces-valText{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:200px; }
.dsces-valNum{ transition:color .18s ease; flex:none; }

.dsces-effortBlock{
  padding:2px 10px 10px; border-radius:11px; transition:box-shadow .28s ease;
}

/* ---------- 滑条四层 ---------- */
.dsces-track{
  position:relative; height:${TRACK_H}px; border-radius:999px;
  background:var(--dsw-alias-border-l1,var(--dsces-track));
  cursor:pointer; touch-action:none; outline:none; overflow:hidden;
  user-select:none; -webkit-user-select:none;
}
.dsces-track:focus-visible{ box-shadow:0 0 0 2px var(--dsw-alias-ring,#4d93f8); }
.dsces-track.is-disabled{ cursor:default; opacity:.55; }
.dsces-fill{
  position:absolute; left:0; top:0; bottom:0; width:0; border-radius:999px;
  background:linear-gradient(90deg,#4d93f8,#4d93f8);
  will-change:width;
}
.dsces-energy{
  position:absolute; left:0; top:0; bottom:0; width:0; border-radius:999px;
  opacity:0; overflow:hidden;
  background:linear-gradient(90deg,rgba(147,51,234,.06),rgba(147,51,234,.42));
  transition:opacity .28s ease;
  pointer-events:none;
}
/* 星云要用「边缘透明的瓦片」平铺：光斑自己完整落在瓦片内，接缝处两边都是透明，
   所以看不出缝。旧版是 linear-gradient + background-size:220% + 默认 repeat，
   在真机上会露出瓦片边界 —— 左段突然变深紫、中间一道硬竖缝，就是这个。 */
.dsces-neb{
  position:absolute; inset:0;
  background-image:
    radial-gradient(closest-side at 50% 50%,rgba(147,51,234,.55),rgba(147,51,234,0) 72%),
    radial-gradient(closest-side at 22% 42%,rgba(99,102,241,.34),rgba(99,102,241,0) 70%);
  background-size:33.3334% 100%,66.6667% 100%;
  background-repeat:repeat-x;
  animation:dsces-nebula 9s linear infinite;
  will-change:background-position;
}
@keyframes dsces-nebula{
  from{ background-position:0 0,0 0 }
  to{ background-position:33.3334% 0,66.6667% 0 }
}
.dsces-energy::after{
  content:''; position:absolute; inset:0;
  background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,.26) 42%,rgba(255,255,255,.04) 58%,transparent 100%);
  background-size:55% 100%; background-repeat:no-repeat;
  animation:dsces-sweep 3.4s linear infinite;
}
@keyframes dsces-sweep{ from{background-position:-70% 0} to{background-position:170% 0} }

.dsces-stars{ position:absolute; inset:0; pointer-events:none; }
.dsces-star{
  position:absolute; opacity:0; transition:opacity .22s ease;
  animation-name:dsces-drift; animation-timing-function:linear;
  animation-iteration-count:infinite; animation-play-state:paused;
  will-change:transform;
}
.dsces-star.is-on{ opacity:1; animation-play-state:running; }
.dsces-star > i{ display:block; border-radius:50%; }
@keyframes dsces-drift{
  from{ transform:translate3d(calc(var(--dsces-tw,240px) * -.62),0,0) }
  to  { transform:translate3d(calc(var(--dsces-tw,240px) * .62),0,0) }
}

.dsces-ticks{ position:absolute; inset:0; pointer-events:none; }

.dsces-dot{
  position:absolute; top:50%; width:3px; height:3px; margin:-1.5px 0 0 -1.5px;
  border-radius:50%; background:var(--dsces-dot);
  transition:background .18s ease,box-shadow .18s ease,transform .16s ease;
}
.dsces-dot.is-passed{ background:rgba(255,255,255,.55); box-shadow:0 0 4px rgba(255,255,255,.5); }
.dsces-dot.is-same{ background:rgba(255,255,255,.28); box-shadow:none; }
.dsces-dot.is-flash{ background:#fff; box-shadow:0 0 6px rgba(255,255,255,.95); }

.dsces-knob{
  position:absolute; top:50%; width:${KNOB_D}px; height:${KNOB_D}px;
  margin:-${KNOB_D / 2}px 0 0 -${KNOB_D / 2}px; border-radius:50%;
  background:var(--dsces-knob); pointer-events:none;
  box-shadow:0 1px 4px rgba(0,0,0,.45),0 0 0 0 rgba(147,51,234,0);
  transition:left .12s cubic-bezier(.22,1,.36,1),box-shadow .2s ease,transform .2s ease;
  will-change:left,transform;
}
/* 拖动中 left 必须**零过渡**：旧版挂了 .04s linear，看着只是"一点点软"，
   但 40ms ≈ 2~3 帧，指针甩快了旋钮就是拖在后面追，这是掉队的直接原因。 */
.dsces-track.is-dragging .dsces-knob{
  transform:scale(1.08);
  box-shadow:0 2px 10px rgba(0,0,0,.5),0 0 0 6px rgba(147,51,234,.16);
  transition:box-shadow .2s ease,transform .2s ease;
}
/* 松手吸附不走 CSS：见 onUp 里那段注释（class 会被 React 重渲染抹掉，改用 WAAPI）。 */
/* 被刻度吸住：旋钮鼓一圈 + 边缘泛紫 + 换个"凹槽里"的白。
   为什么改旋钮本身：28px 的旋钮正好把同位置的刻度点整个盖住，
   任何画在轨道里的高亮都会被它遮掉，唯一看得见的地方就是圆本身。 */
.dsces-track.is-dent .dsces-knob{
  transform:scale(1.13);
  background:radial-gradient(circle at 50% 36%,#fff 42%,#e8dfff 74%,#b9a2ff 100%);
  box-shadow:0 2px 12px rgba(0,0,0,.45),
             0 0 0 2px rgba(147,51,234,.8),
             0 0 0 6px rgba(147,51,234,.18),
             0 0 18px rgba(147,51,234,.55);
}
.dsces-dot.is-near{
  background:#fff;
  transform:scale(1.8);
  box-shadow:0 0 7px rgba(255,255,255,.92),0 0 2px rgba(255,255,255,.85);
}
/* 浅色主题：白旋钮压在接近白色的轨道上会糊掉，补一道极细暗边。
   注意要把拖动态一起覆盖，否则拖动时光晕会被这条规则顶掉。 */
html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) .dsces-knob{
  box-shadow:0 1px 5px rgba(0,0,0,.26),0 0 0 1.5px rgba(60,30,140,.32),0 0 0 0 rgba(147,51,234,0);
}
html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) .dsces-track.is-dragging .dsces-knob{
  box-shadow:0 2px 10px rgba(0,0,0,.3),0 0 0 1.5px rgba(60,30,140,.32),0 0 0 6px rgba(147,51,234,.16);
}
/* 浅色下"被吸住"要一起覆盖，否则会被上面那条更具体的选择器顶掉 */
html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) .dsces-track.is-dent .dsces-knob{
  background:radial-gradient(circle at 50% 36%,#fff 44%,#eee7ff 74%,#c4b0ff 100%);
  box-shadow:0 2px 10px rgba(0,0,0,.26),
             0 0 0 2px rgba(110,60,220,.55),
             0 0 0 6px rgba(147,51,234,.14),
             0 0 14px rgba(147,51,234,.32);
}
/* 浅色下刻度点本身很浅，"正在被吸住"那一颗需要更实的颜色才看得出来 */
html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) .dsces-dot.is-near{
  background:#31206e;
  box-shadow:0 0 6px rgba(90,50,190,.55),0 0 2px rgba(90,50,190,.45);
}
/* 浅色主题：白色星尘落在亮蓝/亮紫填充上对比不足，加一圈极淡的暗晕把颗粒托出来 */
html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) .dsces-star > i{
  box-shadow:0 0 3px rgba(49,20,120,.45);
}
.dsces-track.is-fast .dsces-knob{ transition:left .078s cubic-bezier(.3,.9,.2,1),box-shadow .2s ease,transform .2s ease; }
.dsces-track.is-dragging.is-fast .dsces-knob{ transition:left .078s cubic-bezier(.3,.9,.2,1),box-shadow .2s ease,transform .2s ease; }

.dsces-comet{
  position:absolute; top:50%; height:6px; width:0; border-radius:3px;
  transform:translateY(-50%); opacity:0; pointer-events:none;
  transition:opacity .2s ease;
}
.dsces-comet.is-left{
  right:100%; margin-right:2px;
  background:linear-gradient(90deg,transparent,rgba(147,51,234,.6));
}
.dsces-comet.is-right{
  left:100%; margin-left:2px;
  background:linear-gradient(270deg,transparent,rgba(147,51,234,.6));
}

.dsces-shock{
  position:absolute; top:50%; width:${KNOB_D}px; height:${KNOB_D}px;
  margin-top:-${KNOB_D / 2}px; margin-left:-${KNOB_D / 2}px;
  border-radius:50%; border:2px solid rgba(147,51,234,.85); pointer-events:none;
  animation:dsces-shock .52s cubic-bezier(.2,.7,.3,1) forwards;
}
@keyframes dsces-shock{ from{transform:scale(.3); opacity:.95} to{transform:scale(2.1); opacity:0} }
.dsces-ink{
  position:absolute; top:50%; width:4px; height:4px; border-radius:50%;
  background:#20204f; pointer-events:none;
  animation:dsces-ink .5s cubic-bezier(.2,.6,.4,1) forwards;
}
@keyframes dsces-ink{
  from{ transform:translate(-50%,-50%) scale(1); opacity:.95 }
  to  { transform:translate(calc(-50% + var(--ix,0px)),calc(-50% + var(--iy,0px))) scale(.4); opacity:0 }
}
.dsces-note{
  margin:6px 10px 2px; font-size:11px; line-height:1.35; color:var(--dsces-dim);
  min-height:14px;
}
.dsces-error{
  margin:2px 10px 6px; font-size:11px; line-height:1.35; color:#e5484d;
}

/* ---------- 模型行（可点开列表） ---------- */
.dsces-rowBtn{
  display:flex; width:100%; align-items:center; justify-content:space-between; gap:10px;
  min-height:36px; padding:7px 10px; margin:0;
  border:0; border-radius:9px; background:transparent; color:inherit;
  font:inherit; text-align:left; cursor:pointer;
  transition:background .14s ease;
}
.dsces-rowBtn:hover:not(:disabled),
.dsces-rowBtn.is-open{ background:color-mix(in srgb,var(--dsces-sub-hover) 9%,transparent); }
.dsces-rowBtn:disabled{ cursor:default; opacity:.6; }
.dsces-rowBtn:focus-visible{ outline:none; box-shadow:0 0 0 2px rgba(139,92,246,.45); }

/* ---------- 二级菜单：选择模型 ----------
 * 布局照用户给的手机端底部弹层：返回 + 标题 → 厂牌标签页 → 单列模型卡片。
 * 单列（不是参考图的双列）是实测决定的：真机模型名长（deepseek-v4.1-flash-1017），
 * 双列 147px 装不下，deepseek-v4-pro 会被截成 "deepseek-v4-…"，和隔壁同名版本分不清。
 * ------------------------------------------------------------------ */
.dsces-pk{ display:flex; flex-direction:column; min-height:0; flex:1 1 auto; animation:dsces-pkIn .2s cubic-bezier(.22,.8,.3,1); }
@keyframes dsces-pkIn{ from{ opacity:0; transform:translateX(10px) } to{ opacity:1; transform:none } }

.dsces-pkHead{ display:flex; align-items:center; gap:6px; padding:12px 18px 10px; flex:none; }
.dsces-pkTitle{ margin:0; font-size:17px; font-weight:600; color:var(--dsces-sub-hover); letter-spacing:.01em; }
.dsces-pkBack{
  flex:none; width:26px; height:26px; margin-left:-6px; padding:0;
  display:grid; place-items:center; border:0; border-radius:8px;
  background:transparent; color:var(--dsces-sub); cursor:pointer;
  transition:background .14s ease,color .14s ease;
}
.dsces-pkBack:hover{ background:color-mix(in srgb,var(--dsces-sub-hover) 10%,transparent); color:var(--dsces-sub-hover); }
.dsces-pkBack svg{ width:16px; height:16px; }

/* 厂牌标签页：横向滚动，选中态"浮起"。右侧渐隐提示还能继续滑。 */
.dsces-pkTabs{
  display:flex; gap:8px; overflow-x:auto; flex:none;
  padding:2px 18px 12px; scrollbar-width:none;
  mask-image:linear-gradient(to right,#000 calc(100% - 26px),transparent 100%);
  -webkit-mask-image:linear-gradient(to right,#000 calc(100% - 26px),transparent 100%);
}
.dsces-pkTabs::-webkit-scrollbar{ display:none; }
.dsces-pkTab{
  flex:none; display:inline-flex; align-items:center; gap:5px;
  height:34px; padding:0 15px; border:1px solid transparent; border-radius:17px;
  background:color-mix(in srgb,var(--dsces-sub-hover) 8%,transparent);
  color:var(--dsces-sub); font:inherit; font-size:13px; white-space:nowrap;
  cursor:pointer; transition:background .16s ease,color .16s ease,box-shadow .16s ease;
}
.dsces-pkTab:hover{ color:var(--dsces-sub-hover); }
.dsces-pkTab.is-on{
  background:var(--dsces-card); color:var(--dsces-sub-hover); font-weight:500;
  box-shadow:0 2px 8px rgba(20,20,45,.16), 0 0 0 1px var(--dsces-line);
}
html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) .dsces-pkTab.is-on{
  box-shadow:0 2px 8px rgba(20,20,45,.10), 0 0 0 1px rgba(0,0,0,.06);
}
.dsces-pkTab .dsces-pkOff{
  font-size:10px; line-height:1; padding:2px 4px; border-radius:4px;
  background:rgba(139,92,246,.18); color:#8b5cf6;
}
html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) .dsces-pkTab .dsces-pkOff{ color:#6d28d9; }

/* 单列模型卡 */
.dsces-pkList{
  display:flex; flex-direction:column; gap:8px;
  flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain;
  padding:0 18px 4px;
}
.dsces-pkList::-webkit-scrollbar{ width:8px; }
.dsces-pkList::-webkit-scrollbar-thumb{ background:var(--dsces-line); border-radius:8px; }
.dsces-pkCard{
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  flex:none; min-height:46px; padding:9px 12px; min-width:0;
  background:var(--dsces-card); border:1px solid var(--dsces-line); border-radius:12px;
  color:var(--dsces-sub-hover); font:inherit; font-size:13px; text-align:left;
  cursor:pointer; transition:background .16s ease,border-color .16s ease,transform .1s ease;
}
.dsces-pkCard:hover:not(:disabled){ border-color:rgba(139,92,246,.55); }
.dsces-pkCard:active:not(:disabled){ transform:scale(.988); }
.dsces-pkCard:disabled{ cursor:default; opacity:.55; }
.dsces-pkCard.is-on{ background:rgba(139,92,246,.10); border-color:rgba(139,92,246,.62); }
html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) .dsces-pkCard.is-on{ background:#f5f2ff; border-color:#b9a3ff; }
.dsces-pkName{ min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsces-pkRadio{
  flex:none; width:19px; height:19px; border-radius:50%;
  border:1.5px solid var(--dsces-dot); display:grid; place-items:center;
  transition:background .16s ease,border-color .16s ease;
}
.dsces-pkCard.is-on .dsces-pkRadio{ background:#8b5cf6; border-color:#8b5cf6; }
.dsces-pkCheck{ width:11px; height:11px; color:#fff; }
.dsces-empty{ padding:14px 18px; font-size:12px; color:var(--dsces-dim); }

@media (prefers-reduced-motion: reduce){
  .dsces-pop{ animation:none }
  .dsces-energy{ animation-duration:18s }
  .dsces-energy::after{ animation:none; opacity:.5 }
  .dsces-shock,.dsces-ink{ display:none }
  .dsces-comet{ display:none }
  .dsces-knob{ transition:left .1s linear }
  .dsces-star{ animation-duration:14s !important }
  /* 彩色字保留渐变，但不再流动/呼吸（静止的彩字仍然好看，动起来才是负担） */
  .dsces-row .dsces-lab.is-glow{ animation:none }
}
`

    if (typeof document !== 'undefined' && !document.querySelector('style[data-dsces]')) {
      const style = document.createElement('style')
      style.dataset.dsces = '2'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /* ======================================================================
     * 四、动效档位（固定值）
     *   右键设置面板已按需求移除：动画固定「完整」、刻度固定亮白。
     *   保留这个对象是为了 paint/拖动链路里那几处 `ref.mode` 判断不用大改。
     * ==================================================================== */
    const SETTINGS = Object.freeze({ mode: 'full', ticks: 'lit' })

    /* ======================================================================
     * 四·五、提示词增强（闪电开关）
     *   宿主把输入框的正文放在 `conversation.input.shell(id)` 的 state.draft 里，
     *   `actions.setDraft(text)` 能写回去。所以这个开关不是"装个样子"——
     *   点亮时真把这段要求塞进草稿，熄灭时再抽掉；不点亮则草稿一个字节都不动。
     * ==================================================================== */
    const BOOST_KEY = '@xiami74/dsh-effort-dial:boost'
    /** 增强前缀：一行说明它要什么。用户能在输入框里看见，也删得掉。 */
    const BOOST_TEXT =
      '【增强】请最大化这一轮的思考深度：先拆解目标再动手，能并行就并行；' +
      '主动、多轮地调用子代理分头干活（检索、读码、验证各派一路），' +
      '自己只负责拆解、汇总与交叉核对；结论要有独立证据，不够就再派一轮。'

    const hasBoost = (draft) => typeof draft === 'string' && draft.indexOf(BOOST_TEXT) !== -1

    /** 把增强前缀放到草稿最前面（已经在了就不重复加）。 */
    function addBoost(draft) {
      const d = typeof draft === 'string' ? draft : ''
      if (hasBoost(d)) return d
      return d ? BOOST_TEXT + '\n' + d : BOOST_TEXT
    }

    /** 把增强前缀抽掉，用户自己写的内容一行不动。 */
    function stripBoost(draft) {
      const d = typeof draft === 'string' ? draft : ''
      if (!hasBoost(d)) return d
      const kept = d
        .split('\n')
        .filter((line) => line.trim() !== BOOST_TEXT)
        .join('\n')
      return kept.replace(/^\n+/, '')
    }

    function readBoost() {
      try {
        return window.localStorage.getItem(BOOST_KEY) === '1'
      } catch (error) {
        return false
      }
    }

    function writeBoost(on) {
      try {
        window.localStorage.setItem(BOOST_KEY, on ? '1' : '0')
      } catch (error) {}
    }

    /* ======================================================================
     * 五、小工具
     * ==================================================================== */
    function flattenModels(catalog) {
      const out = []
      if (!catalog || !Array.isArray(catalog.groups)) return out
      for (const group of catalog.groups) {
        if (!group || !Array.isArray(group.models)) continue
        for (const model of group.models) out.push({ provider: group.id, group, model })
      }
      return out
    }

    function findEntry(entries, selection) {
      if (!selection) return null
      return (
        entries.find(
          (e) => e.provider === selection.provider && e.model.id === selection.model,
        ) || null
      )
    }

    function effortIndexOf(model, effortId) {
      const efforts = (model && model.reasoning && model.reasoning.efforts) || []
      if (!efforts.length) return -1
      const found = efforts.findIndex((e) => e.id === effortId)
      return found >= 0 ? found : 0
    }

    function ChipChevron() {
      return h(
        'svg',
        {
          className: 'dsces-chev',
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
        },
        h('path', {
          d: 'M4.5 6.5 8 10l3.5-3.5',
          stroke: 'currentColor',
          strokeWidth: '1.6',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function RowChevron() {
      return h(
        'svg',
        { className: 'dsces-chev', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M6 4.5 9.5 8 6 11.5',
          stroke: 'currentColor',
          strokeWidth: '1.6',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** 二级菜单的返回箭头。 */
    function BackChevron() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M10 3.5 5.5 8 10 12.5',
          stroke: 'currentColor',
          strokeWidth: '1.8',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** 闪电：提示词增强开关的图标。 */
    function BoltIcon() {
      return h(
        'svg',
        {
          className: 'dsces-boostGlyph',
          viewBox: '0 0 16 16',
          'aria-hidden': 'true',
        },
        h('path', {
          d: 'M9.4 1 3.2 8.9h3.3L6.4 15l6.2-7.9H9.3L9.4 1Z',
          fill: 'currentColor',
        }),
      )
    }

    function CheckIcon(props) {
      return h(
        'svg',
        {
          className: (props && props.className) || 'dsces-check',
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
        },
        h('path', {
          d: 'M3.5 8.5 6.5 11.5 12.5 5',
          stroke: 'currentColor',
          strokeWidth: '1.8',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /* ======================================================================
     * 六、数据钩子：读投影 + 拉目录
     * ==================================================================== */
    function useModelSelection(ctx, sessionId) {
      const [projection, setProjection] = React.useState(null)
      React.useEffect(() => {
        if (!sessionId) return undefined
        let face = null
        try {
          const binding = ctx.sessions.binding(sessionId)
          face =
            binding && binding.session && binding.session.projections
              ? binding.session.projections.faceOf('modelSelection')
              : null
        } catch (error) {
          face = null
        }
        if (!face || typeof face.getSnapshot !== 'function') return undefined
        const sync = () => setProjection(face.getSnapshot() || null)
        sync()
        const dispose = typeof face.subscribe === 'function' ? face.subscribe(sync) : null
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      }, [ctx, sessionId])
      return projection
    }

    function useModelCatalog(ctx) {
      const [catalog, setCatalog] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const load = () => {
          Promise.resolve()
            .then(() => ctx.remote.session.modelCatalog())
            .then((result) => {
              if (!alive) return
              if (result && result.ok) setCatalog(result.value)
            })
            .catch(() => {})
        }
        load()
        const disposers = []
        try {
          if (ctx.remote.$on) disposers.push(ctx.remote.$on('llm/adapters-updated', load))
        } catch (error) {}
        try {
          if (ctx.on) disposers.push(ctx.on('connection/reset', load))
        } catch (error) {}
        return () => {
          alive = false
          for (const dispose of disposers) {
            try {
              if (typeof dispose === 'function') dispose()
            } catch (error) {}
          }
        }
      }, [ctx])
      return catalog
    }

    /* ======================================================================
     * 七、主组件
     * ==================================================================== */
    function EffortSlider(props) {
      const { sessionId, locked } = props
      const ctx = props.__ctx

      const [open, setOpen] = React.useState(false)
      /** 弹层视图：'dial' = 推理等级 + 滑条；'models' = 模型列表。 */
      const [view, setView] = React.useState('dial')
      /** 二级菜单当前停在哪个厂牌页；null = 跟着当前模型走。 */
      const [tabId, setTabId] = React.useState(null)
      const tabsRef = React.useRef(null)
      /** 提交占位：松手 → RPC 回来 → 投影更新 之间保持显示档位，避免画面回跳。 */
      const [pendingIndex, setPendingIndex] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [pos, setPos] = React.useState(null)
      /** 提示词增强开关（闪电）。真值先读持久化，写进草稿由下面两个 effect 负责。 */
      const [boost, setBoost] = React.useState(readBoost)
      const settings = SETTINGS

      const anchorRef = React.useRef(null)
      const popRef = React.useRef(null)
      const openedAtRef = React.useRef(0)
      const trackRef = React.useRef(null)
      const fillRef = React.useRef(null)
      const energyRef = React.useRef(null)
      const knobRef = React.useRef(null)
      const blockRef = React.useRef(null)
      /* 拖动时要实时改的三处：档位名 / 说明行 / 「推理等级」的彩色流光 */
      const labRef = React.useRef(null)
      const noteRef = React.useRef(null)
      const cometRef = React.useRef(null)
      const starsRef = React.useRef(null)
      const effortNumRef = React.useRef(null)
      const seatNumRef = React.useRef(null)
      const starNodes = React.useRef([])
      const starMeta = React.useRef([])
      const dotNodes = React.useRef([])
      const dragPctRef = React.useRef(null)
      const dragIdxRef = React.useRef(null)
      const lastIdxRef = React.useRef(-1)
      const velRef = React.useRef(0)
      const lastXRef = React.useRef(null)
      const lastTRef = React.useRef(0)
      const speedPctRef = React.useRef(-1)
      /* 拖动合帧：pointermove 可能 125Hz，每帧只允许画一次。 */
      const rafRef = React.useRef(null)
      const pendingPctRef = React.useRef(null)
      const nearIdxRef = React.useRef(-1)
      /** 星尘上次写过的 (轨道宽, 颗数, 速度)，用来跳过无变化的重复写入。 */
      const starCacheRef = React.useRef({ w: -1, count: -1, speed: -1 })
      const settingsRef = React.useRef(settings)
      settingsRef.current = settings

      /* 卸载时收掉还没跑完的合帧，别在组件外面改 DOM。 */
      React.useEffect(
        () => () => {
          if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
          }
        },
        [],
      )

      const projection = useModelSelection(ctx, sessionId)
      const catalog = useModelCatalog(ctx)
      const entries = React.useMemo(() => flattenModels(catalog), [catalog])
      const groups = React.useMemo(
        () => (catalog && Array.isArray(catalog.groups) ? catalog.groups : []),
        [catalog],
      )

      const fallback = catalog && catalog.default ? catalog.default : null
      const current = (projection && (projection.next || projection.lastUsed)) || fallback
      const entry = findEntry(entries, current)

      const model = entry ? entry.model : null
      const efforts = (model && model.reasoning && model.reasoning.efforts) || []
      const defaultEffortId =
        (model && model.reasoning && model.reasoning.defaultEffort) ||
        (efforts[0] && efforts[0].id)
      const activeEffortId = (current && current.reasoningEffort) || defaultEffortId
      const realIndex = effortIndexOf(model, activeEffortId)
      const total = efforts.length
      const index = pendingIndex !== null ? pendingIndex : realIndex
      const effort = total ? efforts[clamp(index, 0, total - 1)] : null
      const text = effort ? tierText(effort, index, total) : null
      const isUltra = total >= 3 && index === total - 1
      /** 只有停在 Max/Ultra 档时，「推理等级」才流光。 */
      const glowLabel = isMaxEffort(effort)
      /**
       * 渲染落点：档位格上。拖动中的连续位置**不走 state** —— 由 paint() 直接写 DOM，
       * 这样 22 颗星尘不会每帧重渲染（也不会因为重渲染把跟手的旋钮拽回格位）。
       */
      const ratio = total > 1 ? clamp(index, 0, total - 1) / (total - 1) : 0

      const starLayout = React.useMemo(() => buildStarLayout(), [])
      React.useEffect(() => {
        starMeta.current = starLayout.map((s) => ({
          jitter: s.jitter,
          seed: s.seed,
          dur: STAR_BASE / Math.max(0.2, speedAt(ratio)),
          delay: -s.seed * (STAR_BASE / Math.max(0.2, speedAt(ratio))),
          started: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        }))
      }, [starLayout, ratio])

      /* ---------- 占位释放：投影确认 / 失败 / 2.5s 兜底 ---------- */
      React.useEffect(() => {
        if (pendingIndex !== null && realIndex === pendingIndex) setPendingIndex(null)
      }, [pendingIndex, realIndex])
      React.useEffect(() => {
        if (pendingIndex !== null && error) setPendingIndex(null)
      }, [pendingIndex, error])
      React.useEffect(() => {
        if (pendingIndex === null) return undefined
        const timer = setTimeout(() => setPendingIndex(null), 2500)
        return () => clearTimeout(timer)
      }, [pendingIndex])

      /* ---------- 位置：右对齐触发器上方，越界翻到下方 ---------- */
      const place = React.useCallback(() => {
        const anchor = anchorRef.current
        const pop = popRef.current
        if (!anchor || !pop) return
        const rect = anchor.getBoundingClientRect()
        const width = pop.offsetWidth || MENU_W
        /* 量"自然高度"时先清掉封顶，否则每次量到的都是上一次封顶后的值，会和 top 互相追着跑 */
        pop.style.maxHeight = ''
        const height = pop.offsetHeight || 130
        const left = clamp(
          rect.right - width,
          8,
          Math.max(8, window.innerWidth - width - 8),
        )
        let top = rect.top - 8 - height
        if (top < 8) top = Math.min(window.innerHeight - height - 8, rect.bottom + 8)
        /* 只封顶、不移动：位置按自然高度算定，之后内容再多也只是内部滚动，
           绝不让弹层下半截跑到窗口外面（那样最后几张卡点不到）。 */
        const cap = Math.max(160, Math.round(window.innerHeight - top - 8))
        pop.style.maxHeight = cap + 'px'
        setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }))
      }, [])

      /* 厂牌标签页是横向的，鼠标滚轮（竖直）在上头默认什么都不会发生 ——
         把它翻译成横向滚动，这是用户唯一顺手的"滑一下换家"动作。 */
      React.useEffect(() => {
        const el = tabsRef.current
        if (!el || view !== 'models') return undefined
        const onWheel = (event) => {
          if (el.scrollWidth <= el.clientWidth + 1) return
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
          event.preventDefault()
          el.scrollLeft += event.deltaY
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
      }, [view])

      /* 选中那一页要能看见（厂牌多的时候它可能在右边看不见的地方） */
      React.useEffect(() => {
        const el = tabsRef.current
        if (!el || view !== 'models') return
        const on = el.querySelector('.dsces-pkTab.is-on')
        if (!on) return
        const over = on.offsetLeft + on.offsetWidth - el.clientWidth + 18
        if (over > 0) el.scrollLeft = Math.max(0, el.scrollLeft + over)
        else if (on.offsetLeft < el.scrollLeft) el.scrollLeft = Math.max(0, on.offsetLeft - 12)
      }, [view, tabId])

      React.useLayoutEffect(() => {
        openedAtRef.current =
          typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
        if (!open) {
          setPos(null)
          return undefined
        }
        place()
        const onChange = (event) => {
          const t = event && event.target
          if (t && t !== document && t !== window) {
            const pop = popRef.current
            if (pop && pop.contains(t)) return
          }
          place()
        }
        window.addEventListener('resize', onChange)
        window.addEventListener('scroll', onChange, true)
        return () => {
          window.removeEventListener('resize', onChange)
          window.removeEventListener('scroll', onChange, true)
        }
      }, [open, place, total, view, groups.length])

      /* ---------- 关闭行为：点外部 / Esc ---------- */
      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          const x = event.clientX
          const y = event.clientY
          const hits = (node) => {
            if (!node) return false
            if (typeof node.contains === 'function' && event.target && node.contains(event.target)) {
              return true
            }
            if (typeof node.getBoundingClientRect !== 'function') return false
            const r = node.getBoundingClientRect()
            return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
          }
          if (hits(popRef.current)) return
          if (hits(anchorRef.current)) return
          /* 宽限期：刚打开时 portal 可能正在挂载，ref 会短暂为 null，纯 ref 判定会误关。 */
          if (
            typeof performance !== 'undefined' &&
            performance.now &&
            performance.now() - openedAtRef.current < 120
          ) {
            return
          }
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          if (view === 'models') {
            setView('dial')
            return
          }
          setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [open, view])

      /* 弹层收起后回到主视图，下次打开不会停在上次的模型列表上 */
      React.useEffect(() => {
        if (!open) setView('dial')
      }, [open])

      /* ---------- 写入 ---------- */
      /** 同步读一次投影的当前选择（只用于提交后核对，不订阅）。 */
      const readSelection = React.useCallback(() => {
        try {
          const binding = ctx.sessions.binding(sessionId)
          const face =
            binding && binding.session && binding.session.projections
              ? binding.session.projections.faceOf('modelSelection')
              : null
          const snap = face && typeof face.getSnapshot === 'function' ? face.getSnapshot() : null
          return (snap && (snap.next || snap.lastUsed)) || null
        } catch (cause) {
          return null
        }
      }, [ctx, sessionId])

      /**
       * 提交后核对：宿主的投影真的变成我们请求的值了吗？
       * RPC 返回 ok 只代表「请求被接受」，不代表会话真的切换了；
       * 这里最多等 1.6s 轮询投影，没跟上就如实报，不谎报成功。
       */
      const confirmApplied = React.useCallback(
        async (request) => {
          const deadline = Date.now() + 1600
          for (;;) {
            const now = readSelection()
            if (
              now &&
              (!request.provider || now.provider === request.provider) &&
              (!request.model || now.model === request.model) &&
              (!request.reasoningEffort || now.reasoningEffort === request.reasoningEffort)
            ) {
              return { ok: true, actual: now }
            }
            if (Date.now() > deadline) return { ok: false, actual: now }
            await new Promise((resolve) => setTimeout(resolve, 120))
          }
        },
        [readSelection],
      )

      const commit = React.useCallback(
        async (next) => {
          if (!sessionId) {
            setError('没有会话，无法修改思考强度')
            return false
          }
          if (!next || !next.provider || !next.model) {
            setError('模型参数不完整，请求未发出')
            return false
          }
          setBusy(true)
          setError('')
          try {
            const request = { sessionId, provider: next.provider, model: next.model }
            if (
              next.reasoningEffort !== undefined &&
              next.reasoningEffort !== null &&
              next.reasoningEffort !== ''
            ) {
              request.reasoningEffort = next.reasoningEffort
            }
            const result = await ctx.remote.session.selectModel(request)
            if (!result || !result.ok) {
              const code = result && result.error ? result.error.code : ''
              const message = result && result.error ? result.error.message : '模型选择失败'
              const friendly =
                code === 'session/writer-held'
                  ? '会话被其他 DSH 进程占用，请退出后重试。'
                  : /owned by subagent routing|subagent routing/i.test(message)
                    ? '当前会话由子代理路由接管，不能修改模型或思考强度。'
                    : message
              setError(friendly)
              return false
            }
            const applied = await confirmApplied(request)
            if (!applied.ok) {
              const actual = applied.actual
              if (actual) {
                setError(
                  '请求已发出，但会话仍停在「' +
                    (actual.model || '未知模型') +
                    ' · ' +
                    (actual.reasoningEffort || '默认档') +
                    '」，可能是该模型不支持这个档位。',
                )
              } else {
                setError('请求已发出，但读不到会话状态，无法确认是否生效。')
              }
              return false
            }
            return true
          } catch (cause) {
            setError(String((cause && cause.message) || cause))
            return false
          } finally {
            setBusy(false)
          }
        },
        [ctx, sessionId, confirmApplied],
      )

      const setEffortAt = React.useCallback(
        (nextIndex) => {
          if (!total || locked || busy) return
          const target = efforts[clamp(nextIndex, 0, total - 1)]
          if (!target || !current) return
          if (target.id === activeEffortId) return
          commit({ provider: current.provider, model: current.model, reasoningEffort: target.id })
        },
        [total, locked, busy, efforts, current, activeEffortId, commit],
      )

      const commitIndex = React.useCallback(
        (nextIndex) => {
          const safe = clamp(nextIndex, 0, Math.max(0, total - 1))
          setPendingIndex(safe)
          setEffortAt(safe)
        },
        [setEffortAt, total],
      )

      const resetEffort = React.useCallback(() => {
        if (!current || !defaultEffortId) return
        commit({
          provider: current.provider,
          model: current.model,
          reasoningEffort: defaultEffortId,
        })
      }, [current, defaultEffortId, commit])

      /**
       * 换模型：档位跟着模型走。
       * 新模型如果支持当前档位 id 就保留，否则退回它自己的 defaultEffort / 第一档
       * —— 不同模型的档位集合不一样，硬套会写出宿主不认的 id。
       */
      const pickModel = React.useCallback(
        (nextEntry) => {
          if (!nextEntry || !nextEntry.model) return
          const nextModel = nextEntry.model
          const nextEfforts = (nextModel.reasoning && nextModel.reasoning.efforts) || []
          const keep = nextEfforts.some((e) => e.id === activeEffortId)
          const nextEffort =
            (keep ? activeEffortId : undefined) ||
            (nextModel.reasoning && nextModel.reasoning.defaultEffort) ||
            (nextEfforts[0] && nextEfforts[0].id)
          const same =
            !!current &&
            current.provider === nextEntry.provider &&
            current.model === nextModel.id &&
            (!nextEffort || current.reasoningEffort === nextEffort)
          setView('dial')
          if (same) return
          /* 换了模型，旧的提交占位必须作废，否则滑条会停在不对的格子上 */
          setPendingIndex(null)
          commit({
            provider: nextEntry.provider,
            model: nextModel.id,
            reasoningEffort: nextEffort,
          })
        },
        [activeEffortId, current, commit],
      )

      /* ---------- 绘制：拖动期间唯一的热路径（不经过 React） ---------- */
      const paint = React.useCallback(
        (pct, opts) => {
          const p = clamp(pct, 0, 1)
          const track = trackRef.current
          const w = track ? track.clientWidth : 0
          const inner = Math.max(1, w - TRACK_H)
          const cx = TRACK_INSET + p * inner
          const energy = energyAt(p)
          const mode = (opts && opts.mode) || settingsRef.current.mode
          const count = mode === 'clean' ? 0 : countAt(p)
          const speed = speedAt(p)

          if (fillRef.current) {
            fillRef.current.style.width = cx + 'px'
            fillRef.current.style.background =
              'linear-gradient(90deg,#4d93f8,' + rgbStr(colorAt(p)) + ')'
          }
          if (energyRef.current) {
            energyRef.current.style.width = cx + 'px'
            energyRef.current.style.opacity = energy.toFixed(3)
          }
          if (knobRef.current) knobRef.current.style.left = cx + 'px'
          if (blockRef.current) {
            blockRef.current.style.boxShadow =
              energy > 0.01
                ? 'inset 0 0 0 1px rgba(147,51,234,' + (0.1 + 0.26 * energy).toFixed(2) + ')'
                : ''
          }

          /* 星尘：数量按位置，速度按位置，改时长时用负 delay 补偿当前进度，相位不跳。
             拖动时如果这几项都没变就整段跳过 —— 22 个元素 ×2 个样式写入 ×125Hz 会把主线程
             吃满，旋钮再"零过渡"也会被挤得掉帧。 */
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
          const cache = starCacheRef.current
          const hard = !!(opts && opts.hard)
          const wChanged = cache.w !== w
          const countChanged = cache.count !== count
          const speedChanged = Math.abs(cache.speed - speed) > 0.015
          if (hard || wChanged || countChanged || speedChanged) {
            const nodes = starNodes.current
            const metas = starMeta.current
            for (let i = 0; i < nodes.length; i++) {
              const node = nodes[i]
              if (!node) continue
              if (hard || wChanged || countChanged) {
                node.classList.toggle('is-on', i < count)
                if (hard || wChanged) node.style.setProperty('--dsces-tw', w + 'px')
              }
              const meta = metas[i]
              if (!meta) continue
              const dur = STAR_BASE / Math.max(0.2, speed) * meta.jitter
              let delay
              if (hard) {
                delay = -meta.seed * dur
              } else {
                const elapsed = (now - meta.started) / 1000
                let prog = (elapsed - meta.delay) / Math.max(0.05, meta.dur)
                if (!isFinite(prog)) prog = 0
                prog = ((prog % 1) + 1) % 1
                delay = -(prog * dur)
              }
              meta.dur = dur
              meta.delay = delay
              meta.started = now
              node.style.animationDuration = dur.toFixed(3) + 's'
              node.style.animationDelay = delay.toFixed(3) + 's'
            }
            cache.w = w
            cache.count = count
            cache.speed = speed
          }

          /* 刻度点 */
          const dots = dotNodes.current
          const passedIdx = Math.round(p * Math.max(0, total - 1))

          /* 档位名 / 说明行 / 彩色流光：跟着旋钮当前所在档实时变。
             以前这几样只由 React 渲染，拖动时不重渲染 —— 所以拖的时候文字纹丝不动，
             非要松手提交后才刷新，看着像"没反应"。这里直接写 DOM，和填充、旋钮同一帧。 */
          const liveEffort = efforts[passedIdx]
          if (liveEffort !== undefined) {
            const live = tierText(liveEffort, passedIdx, total)
            const num = effortNumRef.current
            if (num) {
              if (num.textContent !== live.short) num.textContent = live.short
              num.style.color = textColorAt(p)
            }
            const noteEl = noteRef.current
            if (noteEl) {
              const want = isMaxEffort(liveEffort) ? QUOTA_HINT : live.desc || ''
              if (noteEl.textContent !== want) noteEl.textContent = want
            }
            if (labRef.current) {
              labRef.current.classList.toggle('is-glow', isMaxEffort(liveEffort))
            }
          }
          const tickMode = settingsRef.current.ticks
          for (let i = 0; i < dots.length; i++) {
            const dot = dots[i]
            if (!dot) continue
            dot.style.display = tickMode === 'hide' ? 'none' : ''
            dot.classList.toggle('is-passed', tickMode === 'lit' && i <= passedIdx)
            dot.classList.toggle('is-same', tickMode === 'same' && i <= passedIdx)
          }

          /* 那一行与收起态的数值文字：颜色按位置，文字跟着拖动即时变（松手后归 React） */
          const idxNow = total
            ? clamp(Math.round(p * Math.max(0, total - 1)), 0, total - 1)
            : 0
          const curEffort = total ? efforts[idxNow] : null
          const color = total && !isOffEffort(curEffort) ? textColorAt(p) : ''
          if (effortNumRef.current) {
            effortNumRef.current.style.color = color
            if (total) {
              const label = tierText(curEffort, idxNow, total).short
              if (effortNumRef.current.textContent !== label) {
                effortNumRef.current.textContent = label
              }
            }
          }
          if (seatNumRef.current) seatNumRef.current.style.color = color

        },
        [efforts, total],
      )

      React.useLayoutEffect(() => {
        paint(ratio, { hard: true })
      }, [paint, ratio, settings.mode, settings.ticks, open, total, view])

      /* ---------- 冲击波 + 墨点 ---------- */
      const burst = React.useCallback((cx) => {
        const host = starsRef.current
        if (!host) return
        if (settingsRef.current.mode !== 'full') return
        const shock = document.createElement('div')
        shock.className = 'dsces-shock'
        shock.style.left = cx + 'px'
        host.appendChild(shock)
        setTimeout(() => {
          if (shock.parentNode) shock.parentNode.removeChild(shock)
        }, 560)
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + 0.3
          const d = 16 + hash01(i * 2.3) * 14
          const ink = document.createElement('div')
          ink.className = 'dsces-ink'
          ink.style.left = cx + 'px'
          ink.style.setProperty('--ix', (Math.cos(a) * d).toFixed(1) + 'px')
          ink.style.setProperty('--iy', (Math.sin(a) * d * 0.55).toFixed(1) + 'px')
          host.appendChild(ink)
          setTimeout(() => {
            if (ink.parentNode) ink.parentNode.removeChild(ink)
          }, 560)
        }
        if (trackRef.current && trackRef.current.animate) {
          trackRef.current.animate(
            [{ filter: 'brightness(1)' }, { filter: 'brightness(1.22)' }, { filter: 'brightness(1)' }],
            { duration: 400, easing: 'ease-out' },
          )
        }
      }, [])

      /* ---------- 指针 → 位置 ---------- */
      const pctFromClientX = React.useCallback((clientX) => {
        const track = trackRef.current
        if (!track) return 0
        const rect = track.getBoundingClientRect()
        const usable = Math.max(1, rect.width - TRACK_INSET * 2)
        return clamp((clientX - rect.left - TRACK_INSET) / usable, 0, 1)
      }, [])

      /**
       * 位置 → 档位。完整/简洁跟手，但换档带 1/3 档距离的滞回（指针停在边界附近不抽搐）；
       * 快速模式直接量化到格（复刻 Codex 桌面版：旋钮不跟手、停格上）。
       */
      const indexFromPct = React.useCallback(
        (pct) => {
          if (total <= 1) return 0
          const raw = pct * (total - 1)
          const mode = settingsRef.current.mode
          if (mode === 'fast') return clamp(Math.round(raw), 0, total - 1)
          const cur = dragIdxRef.current
          if (cur === null || cur === undefined) return clamp(Math.round(raw), 0, total - 1)
          if (Math.abs(raw - cur) < 0.34) return cur
          return clamp(Math.round(raw), 0, total - 1)
        },
        [total],
      )

      const flashDot = React.useCallback((idx) => {
        const dots = dotNodes.current
        const dot = dots[idx]
        if (!dot) return
        dot.classList.add('is-flash')
        setTimeout(() => dot.classList.remove('is-flash'), 220)
      }, [])

      const updateComet = React.useCallback((velocity, dragging) => {
        const comet = cometRef.current
        if (!comet) return
        if (!dragging || settingsRef.current.mode !== 'full') {
          comet.style.opacity = '0'
          return
        }
        const w = clamp(Math.abs(velocity) * 22, 0, 46)
        comet.style.opacity = w > 2 ? '1' : '0'
        comet.style.width = w.toFixed(1) + 'px'
        comet.classList.toggle('is-left', velocity >= 0)
        comet.classList.toggle('is-right', velocity < 0)
      }, [])

      /** 高亮"正被吸住"的那颗刻度（只改 class，-1 表示清空）。 */
      const setNearDot = React.useCallback((idx) => {
        if (nearIdxRef.current === idx) return
        nearIdxRef.current = idx
        const dots = dotNodes.current
        for (let i = 0; i < dots.length; i++) {
          if (dots[i]) dots[i].classList.toggle('is-near', i === idx)
        }
      }, [])

      /* ---------- 拖拽 ---------- */
      const onTrackDown = React.useCallback(
        (event) => {
          if (!sessionId || locked || total <= 0 || busy) return
          event.preventDefault()
          const track = trackRef.current
          if (!track) return
          try {
            track.setPointerCapture(event.pointerId)
          } catch (cause) {}
          const startPct = pctFromClientX(event.clientX)
          dragPctRef.current = startPct
          const startIdx = indexFromPct(startPct)
          dragIdxRef.current = startIdx
          lastIdxRef.current = startIdx
          lastXRef.current = event.clientX
          lastTRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now()
          velRef.current = 0
          speedPctRef.current = startPct
          /* 上一次松手的吸附动画还没走完就又按下了：立刻收尾，不然这一段会拖着过渡走。 */
          track.classList.remove('is-settling')
          track.classList.add('is-dragging')
          if (settingsRef.current.mode === 'fast') track.classList.add('is-fast')
          /* 再上一层保险：class 有可能被 React 重渲染重写（轨道的 className 是动态拼的），
             但内联 transition 不在 JSX 的 style 对象里，React 不会碰它。
             拖动期间 left 必须零过渡，这一条直接写死在内联上。 */
          if (knobRef.current) {
            knobRef.current.style.transition = 'box-shadow .2s ease, transform .2s ease'
          }
          paint(startPct, { hard: false, drag: true })
          if (startIdx === total - 1) {
            burst(TRACK_INSET + startPct * Math.max(1, track.clientWidth - TRACK_H))
          }

          const flush = () => {
            rafRef.current = null
            const p = pendingPctRef.current
            if (p === null) return
            paint(p, { hard: false, drag: true })
            updateComet(velRef.current, true)
          }

          const onMove = (moveEvent) => {
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
            const raw = pctFromClientX(moveEvent.clientX)
            const dt = now - lastTRef.current
            if (dt > 0 && lastXRef.current !== null) {
              const v = (moveEvent.clientX - lastXRef.current) / dt
              velRef.current = velRef.current * 0.7 + v * 0.3
            }
            lastXRef.current = moveEvent.clientX
            lastTRef.current = now

            const mode = settingsRef.current.mode
            const inner = Math.max(1, track.clientWidth - TRACK_H)
            let shown = raw
            if (mode === 'fast') {
              /* 快速模式：不跟手、直接停格上（复刻 Codex 桌面版），磁吸没有意义 */
              track.classList.remove('is-dent')
              setNearDot(-1)
            } else {
              const info = dentInfo(raw, total, DENT_R_PX / inner)
              shown = info.shown
              track.classList.toggle('is-dent', info.inDent)
              setNearDot(info.inDent ? Math.round(info.tick * Math.max(0, total - 1)) : -1)
            }

            const idx = indexFromPct(shown)
            if (idx !== lastIdxRef.current) {
              flashDot(idx)
              if (idx === total - 1 && lastIdxRef.current !== total - 1) {
                burst(TRACK_INSET + shown * inner)
              }
              lastIdxRef.current = idx
              dragIdxRef.current = idx
            }

            const pos = mode === 'fast' ? idx / Math.max(1, total - 1) : shown
            dragPctRef.current = pos

            /* 旋钮先同步写到位（单个属性、无过渡，代价极低）：即使这一帧被星尘/能量层
               挤掉了，旋钮也永远贴在指针下面，不会出现"追不上"的观感。 */
            if (knobRef.current) knobRef.current.style.left = TRACK_INSET + pos * inner + 'px'

            /* 填充/能量/星尘合到下一帧，125Hz 的指针事件不会变成 125 次重算。 */
            pendingPctRef.current = pos
            if (rafRef.current === null && typeof requestAnimationFrame === 'function') {
              rafRef.current = requestAnimationFrame(flush)
            } else if (rafRef.current === null) {
              flush()
            }
          }

          const onUp = () => {
            document.removeEventListener('pointermove', onMove)
            document.removeEventListener('pointerup', onUp)
            document.removeEventListener('pointercancel', onUp)
            try {
              track.releasePointerCapture(event.pointerId)
            } catch (cause) {}
            if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
              cancelAnimationFrame(rafRef.current)
            }
            rafRef.current = null
            pendingPctRef.current = null
            track.classList.remove('is-dragging', 'is-fast', 'is-dent')
            setNearDot(-1)
            updateComet(0, false)
            /* 松手沿用拖动中最后显示的那一档，不用 round() 重算 —— 否则边界处会「松手抽一下」。 */
            const lastShown = dragIdxRef.current
            const finalIndex =
              lastShown === null || lastShown === undefined
                ? indexFromPct(dragPctRef.current || 0)
                : lastShown
            dragIdxRef.current = null
            dragPctRef.current = null
            /**
             * 松手吸附：走 WAAPI 直接驱动旋钮，不用 class。
             * 原因（真机踩到的）：提交会 setState → React 重渲染，而轨道的 className 是
             * 动态拼的（含 is-fast），React 一重写就把命令式加的 is-settling 抹掉，
             * 过渡当场失效、直接硬跳。WAAPI 动画不挂在 class 上，重渲染抹不掉。
             */
            const knob = knobRef.current
            const fromPx = knob ? parseFloat(knob.style.left) : NaN
            const toPx = TRACK_INSET + clamp(finalIndex, 0, Math.max(0, total - 1)) / Math.max(1, total - 1) * Math.max(1, track.clientWidth - TRACK_H)
            if (knob) knob.style.transition = ''
            paint(finalIndex / Math.max(1, total - 1), { hard: true })
            if (knob && knob.animate && isFinite(fromPx) && Math.abs(fromPx - toPx) > 0.5) {
              try {
                knob.animate(
                  [{ left: fromPx + 'px' }, { left: toPx + 'px' }],
                  { duration: 220, easing: 'cubic-bezier(.22,1.28,.36,1)' },
                )
              } catch (cause) {}
            }
            commitIndex(finalIndex)
          }

          document.addEventListener('pointermove', onMove)
          document.addEventListener('pointerup', onUp)
          document.addEventListener('pointercancel', onUp)
        },
        [
          sessionId, locked, total, busy, pctFromClientX, indexFromPct, paint,
          burst, flashDot, updateComet, commitIndex, setNearDot,
        ],
      )

      const onTrackKeyDown = React.useCallback(
        (event) => {
          if (!sessionId || locked || total <= 0 || busy) return
          const key = event.key
          const forward = key === 'ArrowRight' || key === 'ArrowUp'
          const backward = key === 'ArrowLeft' || key === 'ArrowDown'
          if (!forward && !backward) return
          event.preventDefault()
          const next = clamp(index + (forward ? 1 : -1), 0, Math.max(0, total - 1))
          if (next === index) return
          flashDot(next)
          if (next === total - 1) {
            const track = trackRef.current
            const w = track ? track.clientWidth : 0
            burst(TRACK_INSET + (next / Math.max(1, total - 1)) * Math.max(1, w - TRACK_H))
          }
          commitIndex(next)
        },
        [sessionId, locked, total, busy, index, flashDot, burst, commitIndex],
      )

      /* 子代理路由接管的会话：宿主禁止改模型/思考强度（原生 ModelSelect 同样判断）。 */
      const subagentOwned = (() => {
        try {
          const sessions = ctx && ctx.sessions
          if (!sessions || typeof sessions.subagentAddress !== 'function') return false
          return sessions.subagentAddress(sessionId) !== undefined
        } catch (cause) {
          return false
        }
      })()

      /**
       * 说明行：最高档**常驻**额度提醒（以前是 1.6s 后淡回模型名，用户要它一直在），
       * 其余档位显示模型自己的描述，都没有就不占地方。
       */
      const noteText = error
        ? ''
        : isUltra
          ? QUOTA_HINT
          : text && text.desc
            ? text.desc
            : ''
      const canUse = !!model && total > 0 && !locked && !subagentOwned && !busy
      const canOpen = !!model || !!catalog

      /* ---------- 提示词增强：拿到宿主这个会话的输入框 ---------- */
      /**
       * 宿主把输入框正文放在 `conversation.input.shell(sessionId)` 上：
       *   shell.state.getSnapshot().draft  读正文
       *   shell.actions.setDraft(text)     写正文（提交中会被拒，靠 phase 判断）
       * 拿不到就返回 null —— 按钮变成禁用态并说明原因，绝不假装生效。
       */
      const boostShell = React.useMemo(() => {
        try {
          if (!ctx || typeof ctx.get !== 'function') return null
          let conversation = ctx.get('conversation')
          if (!conversation && ctx.sessions && typeof ctx.sessions.scope === 'function') {
            const scope = ctx.sessions.scope(sessionId)
            conversation = scope && typeof scope.get === 'function' ? scope.get('conversation') : null
          }
          const input = conversation && conversation.input
          if (!input || typeof input.shell !== 'function') return null
          const shell = input.shell(sessionId)
          if (!shell || !shell.state || typeof shell.state.getSnapshot !== 'function') return null
          if (!shell.actions || typeof shell.actions.setDraft !== 'function') return null
          return shell
        } catch (cause) {
          return null
        }
      }, [ctx, sessionId])

      /* 调试出口：离线断言/真机排查用，暴露当前会话的输入框壳与草稿快照。 */
      React.useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const box = window.__DSCES_TEST__ || (window.__DSCES_TEST__ = {})
        box.shell = boostShell
        box.snapshot = () => {
          try {
            return boostShell ? boostShell.state.getSnapshot() : null
          } catch (cause) {
            return { error: String(cause) }
          }
        }
        box.boostGet = () => boost
        return () => {
          delete box.shell
          delete box.snapshot
          delete box.boostGet
        }
      }, [boostShell, boost])

      const toggleBoost = React.useCallback(() => {
        const next = !boost
        setBoost(next)
        writeBoost(next)
        if (!boostShell) return
        try {
          const snap = boostShell.state.getSnapshot()
          const draft = snap && typeof snap.draft === 'string' ? snap.draft : ''
          if (next) {
            /* 有内容就立刻加上；空草稿先"待命"，等用户开始打字再补（见下面的 watcher）。 */
            if (draft.trim()) boostShell.actions.setDraft(addBoost(draft))
          } else {
            const stripped = stripBoost(draft)
            if (stripped !== draft) boostShell.actions.setDraft(stripped)
          }
        } catch (cause) {
          if (typeof console !== 'undefined') console.warn('[@xiami74/dsh-effort-dial] 增强写入失败', cause)
        }
      }, [boost, boostShell])

      /**
       * 点亮期间盯着草稿：用户清空后重新输入、或手动删掉了那段要求，都要续上，
       * 否则会出现"灯亮着但这次没增强"的假象。提交中不动，等它发完。
       */
      React.useEffect(() => {
        if (!boost || !boostShell) return undefined
        let timer = null
        let disposed = false
        const check = () => {
          if (disposed) return
          let snap = null
          try {
            snap = boostShell.state.getSnapshot()
          } catch (cause) {
            return
          }
          if (!snap) return
          if (snap.phase === 'submitting' || snap.phase === 'adjudicating') return
          const draft = typeof snap.draft === 'string' ? snap.draft : ''
          if (!draft.trim() || hasBoost(draft)) return
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            timer = null
            if (disposed) return
            try {
              const ok = boostShell.actions.setDraft(addBoost(draft))
              if (ok === false && typeof console !== 'undefined') {
                console.warn('[@xiami74/dsh-effort-dial] 写入草稿被宿主拒绝（可能正在提交）')
              }
            } catch (cause) {
              if (typeof console !== 'undefined') console.warn('[@xiami74/dsh-effort-dial] 写入草稿失败', cause)
            }
          }, 220)
        }
        let unsubscribe = null
        try {
          unsubscribe = boostShell.state.subscribe(check)
        } catch (cause) {}
        check()
        return () => {
          disposed = true
          if (timer) clearTimeout(timer)
          if (typeof unsubscribe === 'function') {
            try {
              unsubscribe()
            } catch (cause) {}
          }
        }
      }, [boost, boostShell])


      /* ---------- 渲染 ---------- */
      const chip = h(
        'button',
        {
          ref: anchorRef,
          type: 'button',
          className: 'dsces-chip' + (open ? ' is-open' : ''),
          disabled: !canOpen,
          title: canUse ? '选择推理强度' : '当前会话不可修改思考强度',
          'aria-haspopup': 'dialog',
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => setOpen((v) => !v),
        },
        h('span', { className: 'dsces-chipLabel' }, model ? model.name : '选择模型'),
        text
          ? h('span', { className: 'dsces-chipEffort', ref: seatNumRef }, text.short)
          : null,
        h(ChipChevron, null),
      )

      /* 模型列表：分组照目录来，当前选中的打勾，其它显示它自己的档位数
         —— 顺手把「这个模型到底能不能调档」摊开给爸爸看。 */
      /* ---------- 二级菜单：选择模型 ---------- */
      /** 当前要显示的厂牌页；null = 跟着当前模型走（进列表时默认停在它所属的厂牌）。 */
      const tabGroup =
        (tabId !== null && groups.find((g) => g.id === tabId)) ||
        (current && groups.find((g) => g.id === current.provider)) ||
        groups[0] ||
        null

      const modelsView =
        view === 'models'
          ? h(
              'div',
              {
                key: 'models',
                className: 'dsces-pk',
                role: 'group',
                'aria-label': '选择模型',
              },
              h(
                'div',
                { className: 'dsces-pkHead' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsces-pkBack',
                    title: '返回推理等级',
                    'aria-label': '返回',
                    onClick: () => setView('dial'),
                  },
                  h(BackChevron, null),
                ),
                h('h2', { className: 'dsces-pkTitle' }, '选择模型'),
              ),
              groups.length === 0
                ? h(
                    'div',
                    { className: 'dsces-empty' },
                    catalog ? '模型目录为空' : '模型目录加载中…',
                  )
                : h(
                    'div',
                    { className: 'dsces-pkTabs', role: 'tablist', ref: tabsRef },
                    groups.map((group) =>
                      h(
                        'button',
                        {
                          key: group.id,
                          type: 'button',
                          role: 'tab',
                          'aria-selected': tabGroup && tabGroup.id === group.id ? 'true' : 'false',
                          className:
                            'dsces-pkTab' + (tabGroup && tabGroup.id === group.id ? ' is-on' : ''),
                          onClick: () => setTabId(group.id),
                        },
                        group.name || group.id,
                        isOfficialGroup(group)
                          ? h('span', { className: 'dsces-pkOff' }, '官网')
                          : null,
                      ),
                    ),
                  ),
              groups.length === 0
                ? null
                : h(
                    'div',
                    { className: 'dsces-pkList', role: 'listbox', 'aria-label': '选择模型' },
                    ((tabGroup && tabGroup.models) || []).map((item) => {
                      const active =
                        !!current &&
                        !!tabGroup &&
                        current.provider === tabGroup.id &&
                        current.model === item.id
                      return h(
                        'button',
                        {
                          key: tabGroup.id + '/' + item.id,
                          type: 'button',
                          role: 'option',
                          'aria-selected': active ? 'true' : 'false',
                          title: item.name || item.id,
                          className: 'dsces-pkCard' + (active ? ' is-on' : ''),
                          disabled: busy,
                          onClick: () => pickModel({ provider: tabGroup.id, model: item }),
                        },
                        h('span', { className: 'dsces-pkName' }, item.name || item.id),
                        h(
                          'span',
                          { className: 'dsces-pkRadio' },
                          active ? h(CheckIcon, { className: 'dsces-pkCheck' }) : null,
                        ),
                      )
                    }),
                  ),
            )
          : null

      const menu =
        open && typeof document !== 'undefined'
          ? ReactDOM.createPortal(
              h(
                'div',
                {
                  ref: popRef,
                  className: 'dsces-pop',
                  role: 'dialog',
                  'aria-label': '模型与推理等级',
                  style: {
                    left: pos ? pos.left : -9999,
                    top: pos ? pos.top : -9999,
                    visibility: pos ? 'visible' : 'hidden',
                  },
                },
                view === 'models'
                  ? modelsView
                  : h(
                  'div',
                  { key: 'dial', className: 'dsces-effortBlock', ref: blockRef },
                  h(
                    'div',
                    { className: 'dsces-row' },
                    h(
                      'span',
                      { className: 'dsces-labRow' },
                      h(
                        'span',
                        { className: 'dsces-lab' + (glowLabel ? ' is-glow' : ''), ref: labRef },
                        '推理等级',
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsces-boost' + (boost ? ' is-on' : ''),
                          disabled: !boostShell,
                          'aria-pressed': boost ? 'true' : 'false',
                          'aria-label': '增强提示词',
                          title: !boostShell
                            ? '拿不到输入框，无法启用提示词增强'
                            : boost
                              ? '已开启：发送时会带上「深度思考 + 多派子代理」的要求，再点关闭'
                              : '增强提示词：想得更深、多派子代理分头干活（点亮才生效）',
                          /* 这个按钮在滑条区块里，别让 pointerdown 冒到轨道上变成"开始拖动" */
                          onPointerDown: (event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          },
                          onClick: (event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            toggleBoost()
                          },
                        },
                        h(BoltIcon, null),
                      ),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsces-modelBtn',
                        'aria-haspopup': 'listbox',
                        'aria-expanded': view === 'models' ? 'true' : 'false',
                        disabled: !canOpen || busy,
                        title: model
                          ? '当前模型：' + model.name + ' · 点这里切换'
                          : '切换模型',
                        onClick: () => {
                          setTabId(null)
                          setView((v) => (v === 'models' ? 'dial' : 'models'))
                        },
                      },
                      h(
                        'span',
                        { className: 'dsces-modelName' },
                        model ? model.name : catalog ? '未选择模型' : '模型目录加载中…',
                      ),
                      h(
                        'span',
                        { className: 'dsces-valText dsces-valNum', ref: effortNumRef },
                        text ? text.short : '—',
                      ),
                      h(RowChevron, null),
                    ),
                  ),
                  total > 0
                    ? h(
                        'div',
                        {
                          ref: trackRef,
                          className:
                            'dsces-track' +
                            (canUse ? '' : ' is-disabled') +
                            (settings.mode === 'fast' ? ' is-fast' : ''),
                          role: 'slider',
                          tabIndex: canUse ? 0 : -1,
                          'aria-label': '推理等级',
                          'aria-valuemin': 0,
                          'aria-valuemax': Math.max(0, total - 1),
                          'aria-valuenow': clamp(index, 0, Math.max(0, total - 1)),
                          'aria-valuetext': text ? text.short : undefined,
                          'aria-disabled': canUse ? undefined : 'true',
                          onPointerDown: onTrackDown,
                          onKeyDown: onTrackKeyDown,
                        },
                        h('div', { className: 'dsces-fill', ref: fillRef }),
                        h(
                          'div',
                          { className: 'dsces-energy', ref: energyRef },
                          h('div', { className: 'dsces-neb' }),
                        ),
                        h(
                          'div',
                          { className: 'dsces-stars', ref: starsRef },
                          starLayout.map((star, i) =>
                            h(
                              'div',
                              {
                                key: star.key,
                                className: 'dsces-star',
                                ref: (node) => {
                                  starNodes.current[i] = node
                                },
                                style: {
                                  left: star.phase * 100 + '%',
                                  top: star.y * 100 + '%',
                                  marginTop: -star.size / 2 + 'px',
                                  '--dsces-tw': '240px',
                                },
                              },
                              h('i', {
                                style: {
                                  width: star.size + 'px',
                                  height: star.size + 'px',
                                  background: star.color,
                                  opacity: star.bright.toFixed(2),
                                },
                              }),
                            ),
                          ),
                        ),
                        h(
                          'div',
                          { className: 'dsces-ticks' },
                          efforts.map((dot, i) =>
                            h('span', {
                              key: dot.id,
                              className: 'dsces-dot',
                              ref: (node) => {
                                dotNodes.current[i] = node
                              },
                              style: { left: posAt(i / Math.max(1, total - 1)) },
                            }),
                          ),
                        ),
                        h(
                          'div',
                          { className: 'dsces-knob', ref: knobRef, style: { left: posAt(ratio) } },
                          h('div', { className: 'dsces-comet is-left', ref: cometRef }),
                        ),
                      )
                    : null,
                  noteText
                    ? h(
                        'div',
                        { className: 'dsces-note' + (error ? ' is-error' : ''), ref: noteRef },
                        noteText,
                      )
                    : null,
                  error ? h('div', { className: 'dsces-error' }, error) : null,
                ),
              ),
              document.body,
            )
          : null

      return h('div', { className: 'dsces-root' }, chip, menu)
    }

    /* ======================================================================
     * 八、插件挂载
     * ==================================================================== */
    function apply(ctx) {
      const Bound = (props) => h(EffortSlider, Object.assign({}, props, { __ctx: ctx }))
      Bound.displayName = 'CodexEffortSlider'

      try {
        ctx.slots.inject(SLOT, () =>
          ctx.slots.register({ name: SLOT, priority: SLOT_PRIORITY, locale: NAMESPACE }, Bound),
        )
      } catch (cause) {
        // 挂载点尚未声明时 inject 会等；真正的异常只记录，不影响其它插件。
        if (typeof console !== 'undefined') {
          console.warn('[@xiami74/dsh-effort-dial] 挂载失败：', cause)
        }
      }
    }

    const module = {
      name: PLUGIN_ID,
      inject: ['slots', 'sessions', 'remote', 'remote.session'],
      apply,
    }
    /* 离线断言用的纯函数出口：只挂一个全局对象，不注册任何宿主钩子、不发消息。 */
    if (typeof window !== 'undefined') {
      window.__DSCES_TEST__ = {
        colorAt, energyAt, countAt, speedAt, textColorAt, buildStarLayout,
        hash01, tierText, isOffEffort, posAt, dentInfo,
        addBoost, stripBoost, hasBoost, isOfficialGroup, isMaxEffort,
        constants: {
          STAR_MAX, TRACK_H, KNOB_D, TRACK_INSET, MENU_W, STAR_BASE,
          DENT_R_PX, DENT_STRENGTH, BOOST_TEXT,
        },
      }
    }
    void NAMESPACE
    return module
  },
})
