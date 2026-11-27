/**
 * 离线断言：把 lib/client.js 当经典脚本在 vm 里跑一遍，
 * 通过 window.__DSCES_TEST__ 拿到纯函数，校验几何 / 配色 / 粒子 / 文案兜底。
 *
 *   node test/functions.mjs
 */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(here, '..', 'lib', 'client.js')
const code = fs.readFileSync(src, 'utf8')

let captured = null
const sandbox = {
  console,
  performance: { now: () => Date.now() },
  setTimeout,
  clearTimeout,
  // 宿主在浏览器里提供；这里不给 document，插件会自动跳过 <style> 注入
  window: {
    localStorage: { getItem: () => null, setItem: () => {} },
    __ModuleLoader__: { load: (def) => { captured = def } },
  },
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'client.js' })

let pass = 0
const fails = []
function ok(name, cond, extra) {
  if (cond) { pass += 1; return }
  fails.push(name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)))
}
function near(a, b, eps = 1e-6) { return Math.abs(a - b) < eps }

ok('顶层同步注册了 Loader', captured !== null)
ok('插件 id 与包名一致', captured && captured.id === '@xiami74/dsh-effort-dial', captured && captured.id)

const reactStub = {
  createElement: (...args) => ({ type: 'el', args }),
  useState: (v) => [v, () => {}],
  useRef: (v) => ({ current: v }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}
const req = (id) => {
  if (id === 'react') return reactStub
  if (id === 'react-dom') return { createPortal: (...a) => a }
  return {}
}
const mod = captured.factory(req)
ok('apply 存在', typeof mod.apply === 'function')
ok('inject 声明了 slots/sessions/remote', Array.isArray(mod.inject) && mod.inject.includes('slots'))
ok('没有注册宿主钩子（只声明 inject）', Object.keys(mod).sort().join(',') === 'apply,inject,name', Object.keys(mod))

const T = sandbox.window.__DSCES_TEST__
ok('纯函数出口存在', !!T)
if (!T) { report(); }

const { colorAt, energyAt, countAt, speedAt, textColorAt, buildStarLayout, tierText, isOffEffort, posAt, constants } = T
const { dentInfo } = T
const { addBoost, stripBoost, hasBoost } = T
const BOOST_TEXT = T.constants.BOOST_TEXT
const { isOfficialGroup, isMaxEffort } = T

/* ---------- 1. 颜色曲线 ---------- */
const blue = colorAt(0)
ok('0 档是纯蓝 #4d93f8', blue.join() === '77,147,248', blue)
ok('1/3 以内恒蓝', colorAt(0.2).join() === '77,147,248' && colorAt(1 / 3).join() === '77,147,248', colorAt(0.3))
const mid = colorAt(0.5)
ok('中点介于蓝与紫之间', mid[0] > 77 && mid[0] < 147 && mid[2] > 234, mid)
const max = colorAt(1)
ok('满档是深紫 #4c1d95', max.join() === '76,29,149', max)
ok('2/3 处是紫罗兰 #9333ea', colorAt(2 / 3).join() === '147,51,234', colorAt(2 / 3))
let mono = true
let prev = colorAt(0)
for (let i = 1; i <= 100; i++) {
  const c = colorAt(i / 100)
  /* 蓝 → 紫 → 深紫：蓝通道一路递减（248 → 234 → 149），红通道先升后回落。 */
  if (c[2] > prev[2] + 1) mono = false
  prev = c
}
ok('颜色随位置单调变深（蓝通道不回头）', mono)

/* ---------- 2. 能量曲线 ---------- */
ok('能量 0 档为 0', energyAt(0) === 0)
ok('能量 1/3 仍为 0（左半段干净蓝）', energyAt(1 / 3) === 0)
ok('能量 2/3 是 0.5', near(energyAt(2 / 3), 0.5), energyAt(2 / 3))
ok('能量满档是 1', near(energyAt(1), 1), energyAt(1))
let monoE = true
let prevE = -1
for (let i = 0; i <= 100; i++) {
  const e = energyAt(i / 100)
  if (e < prevE - 1e-9) monoE = false
  prevE = e
}
ok('能量单调不减', monoE)

/* ---------- 3. 粒子数与速度 ---------- */
ok('0 档无粒子', countAt(0) === 0)
ok('1/3 前无粒子', countAt(0.3) === 0)
ok('2/3 是 11 颗', countAt(2 / 3) === 11, countAt(2 / 3))
ok('满档 22 颗', countAt(1) === 22, countAt(1))
ok('粒子数单调不减', (() => { let p = -1; for (let i = 0; i <= 100; i++) { const c = countAt(i / 100); if (c < p) return false; p = c } return true })())
ok('最低速 0.35×', near(speedAt(0), 0.35))
ok('2/3 是 1×', near(speedAt(2 / 3), 1))
ok('满档 2×', near(speedAt(1), 2))
ok('满档星尘 1.5s', near(constants.STAR_BASE / speedAt(1), 1.5))
ok('最低速星尘约 8.6s', near(constants.STAR_BASE / speedAt(0), 3 / 0.35, 1e-6))

/* ---------- 4. 文字色 ---------- */
ok('Off 档不上色（返回空串 = 官方灰）', textColorAt(0) === '')
ok('满档文字是紫罗兰 #8b5cf6', textColorAt(1) === 'rgb(139,92,246)', textColorAt(1))

/* ---------- 5. 星尘布局 ---------- */
const layout = buildStarLayout()
ok('星尘恰好 22 颗', layout.length === 22, layout.length)
ok('相位落在 (0,1)', layout.every((s) => s.phase > 0 && s.phase < 1))
ok('高度落在 [0.08,0.92]', layout.every((s) => s.y >= 0.08 - 1e-9 && s.y <= 0.92 + 1e-9))
ok('亮度落在 [0.5,1]', layout.every((s) => s.bright >= 0.5 && s.bright <= 1))
ok('尺寸只有 1.8/2.8/3.6 三档', layout.every((s) => [1.8, 2.8, 3.6].includes(s.size)))
ok('时长浮动在 ±8% 内', layout.every((s) => s.jitter >= 0.92 - 1e-9 && s.jitter <= 1.08 + 1e-9))
const byPhase = layout.slice().sort((a, b) => a.phase - b.phase)
let minGap = 1
for (let i = 1; i < byPhase.length; i++) {
  const gap = Math.abs(byPhase[i].y - byPhase[i - 1].y)
  if (gap < minGap) minGap = gap
}
ok('相位相邻两颗高度至少差 28%（不并成一坨）', minGap >= 0.279, minGap)
ok('确定性：两次布局完全一致', JSON.stringify(buildStarLayout()) === JSON.stringify(layout))
ok('相位互不相同', new Set(layout.map((s) => s.phase.toFixed(6))).size === 22)

/* 相关系数：高度与相位不该相关（旧版 0.999 会排成斜线） */
{
  const n = layout.length
  const mx = layout.reduce((s, v) => s + v.phase, 0) / n
  const my = layout.reduce((s, v) => s + v.y, 0) / n
  let num = 0, dx = 0, dy = 0
  for (const s of layout) {
    num += (s.phase - mx) * (s.y - my)
    dx += (s.phase - mx) ** 2
    dy += (s.y - my) ** 2
  }
  const r = num / Math.sqrt(dx * dy)
  ok('高度↔相位相关系数 |r| < 0.35', Math.abs(r) < 0.35, r)
}

/* ---------- 6. 档位文案兜底 ---------- */
ok('适配器给了 name 就用它', tierText({ id: 'x', name: '超高' }, 0, 2).short === '超高')
ok('只有 id 时按 id 映射（max → 深入）', tierText({ id: 'max' }, 4, 5).short === '深入')
ok('未知 id 按位置插值', tierText({ id: 'weird' }, 0, 5).short === '轻度')
ok('null effort 不炸', tierText(null, 0, 3).short.length > 0)

/* ---------- 7. Off 判定 ---------- */
ok('off 判定', isOffEffort({ id: 'off' }) === true)
ok('none 判定', isOffEffort({ id: 'none' }) === true)
ok('中文「关闭」判定', isOffEffort({ id: 'x', name: '关闭' }) === true)
ok('大小写与空格不敏感', isOffEffort({ id: ' OFF ' }) === true)
ok('high 不是 off', isOffEffort({ id: 'high', name: 'High' }) === false)

/* ---------- 8. 几何 ---------- */
ok('posAt(0) 是内缩 14px', posAt(0) === 'calc(14px + (100% - 28px) * 0)', posAt(0))
ok('posAt(1) 顶到右端内缩', posAt(1) === 'calc(14px + (100% - 28px) * 1)', posAt(1))
ok('旋钮直径 = 轨道高（圆不会被裁）', constants.KNOB_D === constants.TRACK_H, [constants.KNOB_D, constants.TRACK_H])
ok('轨道内缩 = 半个轨道高', constants.TRACK_INSET === constants.TRACK_H / 2)
ok('菜单宽度够放 25 字符的模型名（340）', constants.MENU_W === 340, constants.MENU_W)
ok('模型入口并进了推理等级行（没有独立模型行）', code.includes("className: 'dsces-modelBtn'") && !/dsces-lab' \}, '模型'/.test(code))
ok('二级菜单有返回入口（新结构）', code.includes("className: 'dsces-pkBack'"))

/* ---------- 9. 样式完整性 ---------- */
for (const cls of [
  '.dsces-pop', '.dsces-row', '.dsces-effortBlock', '.dsces-track', '.dsces-fill',
  '.dsces-energy', '.dsces-stars', '.dsces-star', '.dsces-ticks', '.dsces-dot',
  '.dsces-knob', '.dsces-comet', '.dsces-shock', '.dsces-ink', '.dsces-boost',
  '@keyframes dsces-drift', '@keyframes dsces-nebula', '@keyframes dsces-shock',
]) {
  ok('CSS 含 ' + cls, code.includes(cls))
}
ok('CSS 处理了 prefers-reduced-motion', code.includes('prefers-reduced-motion'))
ok('没有写死 dark 主题（浅色 token 也在）', code.includes('body:not([data-ds-dark-theme])'))

/* ---------- 档位阻尼（磁吸） ---------- */
{
  const inner = 272 /* 与真机弹层同宽的内轨 */
  const r = constants.DENT_R_PX / inner
  const N = 4
  const step = 1 / (N - 1)

  const atTick = dentInfo(step, N, r)
  ok('刻度正中：显示位置就是刻度', near(atTick.shown, step, 1e-9), atTick.shown)
  ok('刻度正中：判定为已吸住', atTick.inDent && atTick.hold > 0.99, atTick.hold)
  ok('刻度正中：索引算回该档', Math.round(atTick.tick * (N - 1)) === 1)

  const far = dentInfo(step / 2, N, r)
  ok('两档正中（吸附圈外）：完全跟手不偏移', far.shown === step / 2 && !far.inDent, far)

  const out = dentInfo(0, N, r)
  ok('零点也吸住（不是只有中间档才吸）', near(out.shown, 0, 1e-9) && out.inDent)

  /* 关键手感：吸附圈内，指针走一段，旋钮只走一小段（压缩比 > 1.5 才够"沉"） */
  const half = r * 0.5
  const compressed = dentInfo(step + half, N, r)
  const knobTravel = compressed.shown - step
  ok('吸附圈内 1/2 处：旋钮行程被压缩到指针的 60% 以下', knobTravel / half < 0.6, {
    pointer: half, knob: knobTravel, ratio: +(knobTravel / half).toFixed(3),
  })
  ok('吸附圈内被压缩时判定为吸住（视觉要亮）', compressed.inDent)

  /* 单调性：指针往前，旋钮绝不能往回走（否则手感是"跳"而不是"沉"） */
  let mono = true
  let prevShown = -1
  for (let i = 0; i <= 400; i++) {
    const s = dentInfo((i / 400) * step, N, r).shown
    if (s < prevShown - 1e-9) mono = false
    prevShown = s
  }
  ok('吸附不破坏单调性（旋钮不会倒退）', mono)

  /* 无漂移：同一指针位置反复求值结果必须一致（纯函数，不累计） */
  const once = dentInfo(step * 1.4, N, r).shown
  const again = dentInfo(step * 1.4, N, r).shown
  ok('纯函数无漂移（同输入同输出）', once === again)

  /* 吸附圈不会互相重叠：半径被档距 49% 卡住 */
  const wide = dentInfo(step * 0.5, N, 99)
  ok('吸附半径被限制在档距 49% 内', wide.radius <= step * 0.49 + 1e-9, wide.radius)
  ok('半径超限时两档之间仍有纯跟手区间', Math.abs(wide.shown - step * 0.5) < 1e-9)

  /* 六档：圈内压缩仍要成立，且半径同比收窄 */
  const r6 = constants.DENT_R_PX / inner
  const s6 = 1 / 5
  const six = dentInfo(s6 + r6 * 0.5, 6, r6)
  ok('六档时同样压缩', (six.shown - s6) / (r6 * 0.5) < 0.6, +( (six.shown - s6) / (r6 * 0.5) ).toFixed(3))
  ok('六档吸附半径不超过半个档距', six.radius <= s6 * 0.49 + 1e-9)

  /* 单档模型：不吸附、不除零 */
  const one = dentInfo(0.3, 1, r)
  ok('单档模型直接跟手且不报错', one.shown === 0.3 && !one.inDent)

  /* 越界指针（拖出轨道外）不能把旋钮送出去 */
  ok('指针越界被夹住', dentInfo(1.6, N, r).shown === 1 && dentInfo(-0.4, N, r).shown === 0)

  /* CSS 层：拖动中 left 不能有过渡，松手才有 */
  ok('拖动中的旋钮 left 无过渡（不掉队的关键）', /\.dsces-track\.is-dragging \.dsces-knob\{[^}]*transition:box-shadow/.test(code))
  ok('松手吸附走 WAAPI（class 会被 React 重渲染抹掉）',
    code.includes('knob.animate(') && !code.includes('.dsces-track.is-settling .dsces-knob'))
  ok('拖动中把 left 零过渡写死在内联样式上（防重渲染抹 class）',
    code.includes("knobRef.current.style.transition = 'box-shadow .2s ease, transform .2s ease'"))
  ok('CSS 有吸住态 is-dent', code.includes('.dsces-track.is-dent .dsces-knob'))
  ok('吸住态改的是旋钮本身（轨道里的高亮会被旋钮盖住）',
    /\.dsces-track\.is-dent \.dsces-knob\{[^}]*radial-gradient/.test(code))
  ok('CSS 有被吸住刻度点 is-near', code.includes('.dsces-dot.is-near'))
  ok('「推理等级」的流光只在 Max 档挂上（条件渲染）',
    /className: 'dsces-lab' \+ \(glowLabel \? ' is-glow' : ''\)/.test(code))

  /* 只有 max / ultra 才算"顶格"，3 档模型的 high 不白嫖 */
  ok('max 档触发流光', isMaxEffort({ id: 'max' }))
  ok('ultra 档也触发', isMaxEffort({ id: 'ultra' }))
  ok('大小写不敏感', isMaxEffort({ id: 'MAX' }) && isMaxEffort({ id: 'Ultra' }))
  ok('high / medium / low 不触发', !isMaxEffort({ id: 'high' }) && !isMaxEffort({ id: 'medium' }) && !isMaxEffort({ id: 'low' }))
  ok('off 档不触发', !isMaxEffort({ id: 'off' }))
  ok('空档位不触发', !isMaxEffort(null) && !isMaxEffort(undefined) && !isMaxEffort({}))
  ok('渐变字用 background-clip:text', /is-glow\{[^}]*background-clip:text/.test(code))
  ok('渐变字必须 color:transparent（否则盖住背景色）', /is-glow\{[^}]*color:transparent/.test(code))
  ok('动画有两段：往返漂移 + 光晕呼吸',
    code.includes('@keyframes dsces-label-drift') && code.includes('@keyframes dsces-label-glow'))
  ok('reduced-motion 下彩色字停动', /.dsces-lab.is-glow\{ animation:none \}/.test(code))
  ok('拖动用 rAF 合帧', code.includes('requestAnimationFrame(flush)'))
}

/* ---------- 提示词增强（闪电开关） ---------- */
{
  ok('增强文案要求子代理', /子代理/.test(BOOST_TEXT))
  ok('增强文案要求更深思考', /思考|拆解/.test(BOOST_TEXT))

  ok('空草稿 → 只有增强前缀', addBoost('') === BOOST_TEXT)
  ok('undefined / null 不炸', addBoost(undefined) === BOOST_TEXT && addBoost(null) === BOOST_TEXT)
  ok('有内容 → 前缀在上、原文在下', addBoost('帮我看看这个 bug') === BOOST_TEXT + '\n帮我看看这个 bug')
  ok('重复加不会叠两遍', addBoost(addBoost('x')) === BOOST_TEXT + '\nx')
  ok('已有前缀时原样返回', addBoost(BOOST_TEXT + '\nx') === BOOST_TEXT + '\nx')

  ok('熄灭时抽掉前缀', stripBoost(BOOST_TEXT + '\n帮我看看这个 bug') === '帮我看看这个 bug')
  ok('多行正文一行不丢', stripBoost(BOOST_TEXT + '\n第一行\n第二行') === '第一行\n第二行')
  ok('没有前缀时不动草稿', stripBoost('第一行\n第二行') === '第一行\n第二行')
  ok('空草稿不变', stripBoost('') === '' && stripBoost(undefined) === '')

  /* 来回一趟必须回到原文（用户点开又关掉，不能吃掉他的字） */
  const src = '一、先跑测试\n二、再改样式'
  ok('点亮→熄灭 完全还原', stripBoost(addBoost(src)) === src)
  ok('多行原文也能还原', stripBoost(addBoost('a\n\nb')) === 'a\n\nb')

  ok('hasBoost 判定', hasBoost(BOOST_TEXT) && !hasBoost('普通草稿') && !hasBoost(''))
  ok('前缀是单行（不会把输入框撑爆）', BOOST_TEXT.indexOf('\n') === -1)
  ok('前缀不像系统提示那样长', BOOST_TEXT.length < 120, BOOST_TEXT.length)
}

/* ---------- 二级菜单：厂牌标签页 + 单列模型卡 ---------- */
{
  const ds = { id: 'deepseek', name: 'DeepSeek' }
  const acct = { id: 'deepseek-account', name: 'DeepSeek Account' }
  const nova = { id: 'nova', name: 'nova' }

  ok('官方 deepseek 被认出来', isOfficialGroup(ds) && isOfficialGroup(acct))
  ok('中转 nova/hanbao 不算官方', !isOfficialGroup(nova) && !isOfficialGroup({ id: 'hanbao' }))
  ok('空分组不报错', isOfficialGroup(null) === false && isOfficialGroup({}) === false)

  ok('二级菜单是单列（真机模型名太长，双列会截断）',
    /\.dsces-pkList\{[^}]*flex-direction:column/.test(code) && !code.includes('grid-template-columns:minmax(0, 1fr) minmax(0, 1fr)'))
  ok('厂牌做成了标签页', code.includes("className: 'dsces-pkTabs'") && code.includes('role: \'tab\''))
  ok('标签页会显示「官网」标记', code.includes("className: 'dsces-pkOff'"))
  ok('模型卡有单选圈（选中才填）', code.includes("className: 'dsces-pkRadio'"))
  ok('二级菜单有返回入口', code.includes("className: 'dsces-pkBack'"))
  ok('进二级会自动停在当前模型所属厂牌', /tabId !== null[\s\S]{0,140}current\.provider/.test(code))
}

/* ---------- 每档都有说明（模型不带 description 时用内置文案兜底） ---------- */
{
  const { tierText } = T
  const cases = [
    [{ id: 'off', name: 'Off' }, 0, '不进行额外思考，响应最快'],
    [{ id: 'low', name: 'Low' }, 1, '针对简单问题快速作答'],
    [{ id: 'medium', name: 'Medium' }, 2, '针对高难度问题提供更深入的分析'],
    [{ id: 'high', name: 'High' }, 3, '面向复杂推理与长链路任务'],
  ]
  for (const [effort, idx, want] of cases) {
    const got = tierText(effort, idx, 5)
    ok('档位 ' + effort.id + ' 有说明（自带 name 也要回落）', got.desc === want, got.desc)
  }
  ok('模型自带 description 时优先用它',
    tierText({ id: 'high', name: 'High', description: '自定义说明' }, 3, 5).desc === '自定义说明')
  ok('有自带 name 时仍显示它的 name',
    tierText({ id: 'high', name: 'High' }, 3, 5).short === 'High')
}

/* ---------- 拖动时实时刷新（不能等松手） ---------- */
{
  ok('paint 里直接写档位名', /const num = effortNumRef\.current[\s\S]{0,120}num\.textContent = live\.short/.test(code))
  ok('paint 里直接写说明行', /noteEl\.textContent !== want\) noteEl\.textContent = want/.test(code))
  ok('paint 里直接切彩色流光', /labRef\.current\.classList\.toggle\('is-glow'/.test(code))
  ok('说明行/档位名都有 ref（不然写不到 DOM）',
    code.includes('ref: noteRef') && code.includes('ref: labRef'))
}

function report() {
  const total = pass + fails.length
  if (fails.length === 0) {
    console.log('\n✅ 全部通过：' + pass + ' / ' + total)
    process.exit(0)
  }
  console.log('\n❌ 失败 ' + fails.length + ' / ' + total)
  for (const f of fails) console.log('   · ' + f)
  process.exit(1)
}
report()
