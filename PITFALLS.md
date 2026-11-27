# PITFALLS

踩过的坑，改这个插件之前先读一遍。

1. **插件 id 必须与包名完全一致（scoped 包除外）。**
   `cordis.patch.yml` 的 `insert.name`、`package.json` 的 `name`、`client.js` 里
   `window.__ModuleLoader__.load({ id })`、`apply()` 返回的 `module.name`，四处必须一致。
   宿主 client-modules 扫描器只在「Loader 条目名 === 包名」时才编入浏览器启动图，
   不一致就**静默跳过**（没有报错，只是没有界面）。
   **scoped 包（`@scope/name`）的例外**：`insert.id` 用短名（`effort-dial`），
   `insert.name` 和其余三处用全称（`@xiami74/dsh-effort-dial`）——
   参照 DSH 自带的 `@liustack/modlens`（`insert.id: modlens`）。
   npm 包名不许大写，scope 必须小写（`xiami74` 不是 `Xiami74`）。

2. **slot 必须先 `inject` 再 `register`。**
   直接 `ctx.slots.register({name:'conversation.input.model'})` 会抛
   `slot "…" is not declared`。正确写法是
   `ctx.slots.inject(SLOT, () => ctx.slots.register(...))`。

3. **portal 到 `document.body` 拿不到祖先的 CSS 变量。**
   卡片是独立 portal，所以 `.dsces-pop` 必须自己声明全套 `--dsces-*` 变量，
   不能指望从 `.dsces-root` 继承。

4. **祖先有 `transform` / `filter` / `contain` 时，`position:fixed` 的包含块会变成祖先。**
   所以卡片一律 portal 到 body，并且每次重定位都用 `getBoundingClientRect()` 现算。

5. **不能写 `import` / `export`。**
   `lib/client.js` 被当作经典 `<script>` 执行，任何 ESM 语法都会直接语法错误，
   导致整个浏览器启动图加载失败。

6. **松手要用「拖动中最后显示的档位」提交，不能 `Math.round()` 重算。**
   否则指针停在边界另一侧时，松手会跳到相邻档，看起来就是「松手抽一下」。

7. **拖动不能走 `setState`。**
   0.2.0 起滑条是连续跟手的：位置每帧都在变。一旦用 `setState` 驱动位置，
   22 颗星尘每帧重渲染会掉帧，而且 React 重渲染会把 `left` 写回档位格的 `calc()` 值，
   跟手的旋钮被「拽回去」——看起来就是拖一下弹一下。
   正确做法：拖动期间只走 `paint()` 直接写 DOM，松手才 `commitIndex` 改 state。

8. **拖动中改文字，必须保证松手能收敛。**
   `paint()` 会直接改档位文字的 `textContent`（为了拖动时名称实时变）。React 的 diff
   认的是 vdom，不会知道 DOM 被改过；所以松手时**必须再 paint 一次最终档位**，
   否则一次失败的提交会把界面永久停在拖动时的文字上。

9. **主题属性可能挂在 `<html>` 也可能挂在 `<body>`。**
   只写 `body:not([data-ds-dark-theme])` 的话，属性若在 `<html>` 上就误判成浅色
   （深色背景配深色文字，直接看不见）。本实现用
   `html:not(...) body:not(...)` 双条件，挂哪层都不会误判。

10. **拖动要带迟滞。**
   纯 `Math.round` 在中点附近会随每个 `pointermove` 反复翻转。0.2.0 的方案是
   **1/3 档距**（`|raw - cur| < 0.34` 时不换档），快速模式直接量化到格。

11. **提交占位必须有三个出口。**
   投影确认 / 提交失败 / 2.5s 兜底，三者都要释放 `pendingIndex`，否则一次失败的提交
   会让界面永久停在假档位上。

12. **与 `dsh-codex-power-slider` 冲突。**
   两者同 slot、同 priority `-1`，同时启用会渲染两条。切换时只留一个。

13. **星尘改时长会让相位跳。**
   改 `animation-duration` 等于把动画从头开始。必须用**负 `animation-delay` 补偿进度**
   （`delay = -当前进度 × 新时长`），否则拖动时星星会集体瞬移。

14. **新插件必须重启 DSH 桌面端。**
    客户端模块的启动图在进程启动时构建；只刷新页面不会加载新插件。
    （已加载插件的文件改动才会走 mtime 变更推送。）

15. **`background-size` + 默认 `repeat` 会露出瓦片接缝。**
    0.2.0 的能量层是 `linear-gradient(...)` + `background-size:220% 100%` + 动画
    `background-position`，想让它「横流」。但渐变图比容器宽又默认平铺，动画走到
    某个相位时，**瓦片边界会落在可视区内** —— 真机上是「左段突然变深紫 + 中间一条硬竖缝」。
    修法：星云必须用**边缘透明的瓦片**（径向光斑，`radial-gradient(...,0 72%)` +
    `background-size` 为 1/N + `repeat-x`），接缝两边都是透明，平铺就看不见缝；
    或者干脆动 `transform` 不动 `background-position`。
    教训：渐变 + 平铺 + 位移，这三件事凑一起必炸。

16. **`selectModel` 返回 `ok` 不等于生效。**
    RPC 成功只代表请求被接受。必须读回投影核对（本实现最多轮询 1.6s），
    再决定是否报成功；否则会出现「提示已切换，实际没变」的假成功。

17. **DSH 的模型/档位切换是「下一轮消息生效」。**
    写进的是 `modelSelection.pending`，`lastUsed` 要等下一轮才变。
    这是官方语义，不是写入失败 —— 联调时别把它当 bug 去「修」，
    否则会误判成没生效而反复重发。

18. **换模型必须重算档位。**
    不同模型的 `efforts` 集合不同（有的 5 档含 off，有的 4 档，部分模型 0 档）。
    直接把旧档位 id 写进新模型会得到宿主不认的值。规则：新模型有同 id 就保留，
    否则退回 `defaultEffort` / 第一档；0 档的模型不画滑条。

19. **浅色主题下「白」会互相吃掉。**
    白旋钮压在 `rgba(0,0,0,.04)` 的浅轨上、白星尘压在亮蓝填充上，都会糊掉。
    浅色必须补暗边：旋钮加 1.5px 冷紫描边，星尘加一圈 `rgba(49,20,120,.45)` 暗晕。

20. **空 description 会留一行空白。**
    很多模型的 effort 没有 `description`，直接渲染 `text.desc` 会得到 14px 空行。
    v0.5.0 起按需求只显示「模型自己的描述」和「到最高档的额度提醒」：
    两者都没有就**整行不渲染**（不再兜底成「第 N / M 档」）。

21. **`dsh.profile.bundles` 才是唯一开关，而且会被别的工具改。**
    `dependencies` 里有 ≠ 会加载；`cordis.yml` 是**运行时自动生成**的，改了没用。
    真机上踩过：本插件已进 bundles，20 分钟后被另一处操作「switchback」换成了
    `dsh-codex-power-slider`，于是界面渲染的是别的插件，两边样式完全不同。
    排查顺序：`bundles` → `node_modules` 链接 → 进程启动时间 → 才怀疑代码。

22. **拖动时旋钮的 `left` 绝对不能带过渡。**
    旧版是 `transition: left .04s linear`，看着只是「一点点软」，但 40ms ≈ 2~3 帧，
    指针甩快了旋钮就是拖在后面追 —— 用户的原话是「拖快了他跟不上指针」。
    正确做法：`.is-dragging` 只留 `box-shadow/transform` 的过渡，`left` 零过渡；
    而且位置要在 `pointermove` 里**同步**写（单属性、无过渡，代价极低），
    填充/能量/星尘再合到 `requestAnimationFrame` 里画一次。

23. **别让 React 管拖动态的 class。**
    轨道的 `className` 是动态拼的（含 `is-fast`），任何一次重渲染 React 都会把
    命令式加的 `is-dragging` / `is-settling` / `is-dent` 一起抹掉：
    - `is-dragging` 被抹 → `left` 恢复 0.12s 过渡 → 又开始掉队；
    - `is-settling` 被抹 → 松手吸附动画当场失效（真机上量到 `settle=false`）。
    对策：拖动中把 `transition` 写进**内联样式**（不在 JSX 的 style 对象里，React 不会碰）；
    松手吸附改用 **WAAPI**（`knob.animate`），跟 class 彻底解耦。

24. **画在轨道里的「档位高亮」多半是白做的。**
    旋钮直径 = 轨道高 = 28px，正好把同位置的 3px 刻度点整个盖住。
    试过「过档脉冲圆环」：节点确实生成了，但被 `overflow:hidden` 裁掉、又被旋钮遮住，
    屏幕上什么也没有。能看见的只有旋钮本身、填充边缘、轨道两侧和那一行文字 ——
    所以「被吸住」只能改旋钮（放大 / 泛紫 / 换底色）。

25. **拖动时说明行不会自己更新。**
    档位文字是 `paint()` 直接写 DOM 的，说明行是 React 渲染的。
    不一起管就会出现「右上角 Medium、下面写着第 5 / 5 档」的错位（真机截图露过）。
    拖动中让 `paint` 接管说明行，松手交回 React（那边还要处理额度提醒和错误）。

26. **右键设置面板不能靠 state 里的坐标，已整体移除。**
    v0.5.0 按需求去掉：`onContextMenu` + 设置弹层 + 诊断复制 + `settings` state 全删，
    动画固定「完整」、刻度固定亮白。留下来的只有 `SETTINGS` 这个冻结常量，
    因为 paint/拖动链路里有几处 `ref.mode` 判断，改动面越小越不容易碰坏手感。

27. **想影响"发出去的内容"，只有草稿这一条路。**
    客户端插件拿不到请求体：`composer block` 是"拦住发送"的闸（`{blocked, reason}`），
    不是注入；`messageSubmitted` 也没有对外事件。唯一能读能写的是
    `conversation.input.shell(sessionId)`：
      · 读 `shell.state.getSnapshot().draft`
      · 写 `shell.actions.setDraft(text)`
      · `phase` 是 `submitting`/`adjudicating` 时会拒绝写入，必须先判断
    拿不到就返回 null 让按钮变禁用 —— 不要假装生效。

28. **增强前缀必须是"用户看得见的普通文字"，而且能原样还原。**
    暗改请求体那种做法在这里既做不到也不该做。规则：
    · 前缀单行、带【增强】标记、长度可控（<120 字），不把输入框撑爆；
    · 点亮 = `前缀 + \n + 原文`，熄灭 = 只删掉那一行，用户正文逐字不动
      （断言里做了 `stripBoost(addBoost(x)) === x` 的往返校验，含多行与空行）；
    · 空草稿时不塞字，先"待命"（否则用户一开开关就被灌一屏字）。

29. **开关的"亮"必须跟草稿的"真有"一致。**
    只写一次会有假象：发完消息草稿清空、前缀没了，灯却还亮着 —— 下一条就是没增强。
    所以点亮期间要订阅 `shell.state`，草稿重新有内容且没有标记时补上（220ms 防抖）。
    订阅要放在**始终挂载**的组件里：弹层 unmount 了监听还得活着，否则关掉菜单就失效。

30. **别在测试脚本里假设开关状态。**
    真机联调时踩过：上一轮把灯点着了，下一轮脚本没确认就打字，结果"没生效"是假的。
    脚本里每次先读一次状态再操作，别信上一轮留下的 localStorage。

31. **闪电的"开着"只能靠颜色表达，别再堆文字。**
    用户的反馈是连续的：先要「已增强」三个字，再把方框删掉、把「第几档」删掉、
    把「已增强」删掉、把下面那行提示也删掉。最后只剩：**紫色 = 开，灰色 = 关**。
    教训：这类小控件不要自带一大套标签和提示，先做最安静的版本，不够再加。

32. **改 CSS 时别用「从 A 切片到 B」的暴力替换。**
    本轮就翻车了一次：用 `s[s.index('/* 推理等级旁边 */'):s.index('.dsces-dot{')]`
    替换，把中间整段（填充/能量/星云/星尘/刻度）一起切掉了 —— 断言立刻报了 6 条失败，
    星尘全没了。改样式块要用「精确匹配整段原文」的方式，切完立刻跑断言。

33. **合并成一行时，flex 会把短的那个也压掉。**
    `推理等级 ⚡ + 模型名 + 档位 + ›` 挤进一行后，第一版直接出现 `DeepSeek-V41-Fla…` 和
    `M…` —— 两个都带 `overflow:hidden`，flex-shrink:1 就按比例一起缩。
    正解：档位名 `flex:none`（它是短的有色强调，绝不能缩），只让模型名让位
    （`flex:0 1 auto; min-width:0` + ellipsis）。

34. **宽度 320 放不下 25 个字符的模型名。**
    实测 `deepseek-v4.1-flash-1017` 在 12px 下要 148px；这一行扣掉标签(52)+闪电(18)+
    档位(24)+箭头(12)+间距只剩 ~126 → 必然截断。`MENU_W` 320 → 340 刚好放得下，
    再长就靠 ellipsis，别再加宽（弹层还得贴得住输入框）。

35. **入口从"独立一行"并进"行内按钮"时，列表视图会失去返回路径。**
    原来的模型行兼任"打开/关闭列表"的开关；合并后必须补一个 `‹ 返回` 行，
    否则进了列表回不去（真机验证：`listCount=33 / hasBack=true / backToDial=true`）。

36. **分组名和模型名同色同字重时，肉眼分不清是哪一层。**
    原样式：分组 11px 灰字 + 模型 13px 深字，真机上看着像一串模型名。
    v0.6.0 改成彩色小胶囊（`.dsces-groupPill`），颜色写在内联的
    `--g-dark / --g-light` 两个变量上，主题切换时只换取哪个变量 —— 不能把颜色算死在内联
    `color` 上，否则浅色主题会拿到给深色配的亮色。

37. **给分组配色不能只写死几个 key。**
    真机有多个分组：若干中转厂牌 + `deepseek / deepseek-account`，
    以及各自的 `(modlens vision)` 变体。第一版只认全名，变体全落到哈希兜底，
    结果多组撞同一个绿色、多组撞同一个橙色。
    正解：先取厂牌（`vendorKey`：`'<厂牌> (modlens vision)' → '<厂牌>'`）走固定色，
    同一家的变体共用一色；认不出的才用 `hsl(hash%360)` 取色相，天然不撞。

38. **「官网」要用 id 判，不要用显示名猜。**
    官方那两组 id 是 `deepseek` 和 `deepseek-account`（`DeepSeek Account` 也是官方账号体系）。
    判据同时认 id 和 name，但以 id 为主 —— 中转里也有叫 deepseek 的分组。

39. **定时淡出的提示，用户可能想让它常驻。**
    `QUOTA_HINT` 原来是进最高档时亮 1.6s 再淡回描述（复刻 Codex 的动效），
    用户要求"常驻"。现在 `noteText` 直接用 `isUltra` 判断，不再有 `showQuota` state 和定时器 ——
    少一个 state 也少一类"定时器没清干净"的坑。

40. **`background-clip:text` 的 `color:transparent` 会被更具体的选择器打回原形。**
    预览页里深色主题四个候选全变成"灰蓝一坨"，查了半天以为是渐变算错了 ——
    实际是另有一条 `body[data-theme=dark] .lab{color:var(--sub)}`（权重 0,1,1）
    压过了 `.lab-a{color:transparent}`（0,1,0），字用的是实色，背景被实色盖住看不见。
    正解：把渐变规则写成 `.dsces-row .dsces-lab.is-glow`（带上行选择器 = 0,3,1），
    或者直接用 `.lab.lab-a` 这种双类提高权重。改完记得读一次 `getComputedStyle().color`
    确认是 `rgba(0,0,0,0)`，别靠肉眼猜。

41. **彩色字别用匀速流动。**
    第一版候选 A 是 6s 匀速循环，实测在真弹层里和滑条的星尘/能量抢注意力，
    而且匀速跑渐变字会被读成 loading。最终选 D：9s `ease-in-out` 往返（两端会停），
    加 4s 光晕呼吸 —— 像字在发光，而不是字在跑。

42. **渐变文字在 13px / 400 字重下会"发虚"。**
    四个汉字宽度只有 ~52px，渐变窗口 320% 时整段只看到一种颜色、像脏字。
    两条一起调：字重 500、`background-size` 收到 200%（四个字里能看到完整过渡）。

43. **"只有最高档才有的效果"要用档位 id 判，别用 index。**
    `isUltra = total >= 3 && index === total - 1` 这种写法对 3 档模型（Off/Low/High）
    会把 High 也当成"顶格"。彩蛋类效果（流光、额度提醒）如果用户说的是"max"，
    就该判 `id === 'max' || id === 'ultra'` —— 名字是契约，序号不是。
    真机逐档验过：Off/Low/Medium/High 的 `color` 都是灰色实色，只有 Max 是 `transparent`（渐变接管）。

44. **同位置、同类型的两个视图，React 会复用 DOM 节点 —— ref 不会解绑。**
    一级（`.dsces-effortBlock`）和二级（`.dsces-pk`）都是 `div`，都在 `.dsces-pop` 的第一个位置，
    切过去时 React 只改了 className，**没有换节点**，`blockRef.current` 仍然指着它。
    结果 `paint()` 继续把「能量光环」（`inset 0 0 0 1px rgba(147,51,234,.36)`）
    写到二级菜单上 —— 屏幕上是一条说不清来历的紫色细线。
    排查过程：先怀疑 `[role=dialog]` 的宿主样式（不是），再遍历所有元素的
    outline/box-shadow（找不到），最后发现是**内联 style** 被写到了别的节点上。
    修法：两个视图都加 `key`（`'dial'` / `'models'`），React 就会换真节点、ref 正常解绑。
    教训：ref 指向的节点如果不在了，写 style 不会报错，只会静默写错地方。

45. **二级菜单的宽度是硬约束。**
    弹层 340 → 内容 326 → 卡片 290（扣掉两侧 18）。这个宽度放得下
    `deepseek-v4.1-flash-1017`（约 150px @12.5px），放不下双列。
    真要双列就得把弹层加宽到 420+，那又和输入框对不齐了 —— 所以选单列。

46. **`hasOwnName` 那条分支把 description 一起吃掉了。**
    DSH 给每个档位都带 `name`（Off/Low/Medium/High/Max），和 id 只差大小写 →
    `effort.name !== id` 成立 → 走"有自己的名字就用它自己的描述"分支，
    而 `effort.description` 大多数模型根本没有 → 说明行整行空白。
    用户看到的是"只有 Max 有字（那是 QUOTA_HINT），其它档位光秃秃"。
    修法：先按 id 算出内置档位（`CODEX_TIER_BY_ID[lower]`，认不出按位置推），
    在 hasOwnName 分支里用 `effort.description || preset.desc` 兜底。

47. **弹层"往上弹"会晃眼，但"往下长"会被窗口切掉。**
    折中做法：位置按**自然高度**算定（先 `maxHeight=''` 再量，否则量到的是上次封顶值、
    和 top 互相追），然后 `maxHeight = 窗口底 - top - 8` 只做封顶不移动。
    切厂牌只影响内部列表滚动，弹层一步都不挪。真机：`top` 恒 589、`bottom` 816 < 窗口 824。

48. **只靠 React 渲染的文字，拖动时不会变。**
    填充、能量、旋钮、星尘都在 `paint()` 里直接写 DOM，所以拖动是跟手的；
    而档位名 / 说明行 / 「推理等级」的彩色流光走的是 React 渲染 ——
    拖动期间不触发重渲染，于是**松手提交后才刷新**，体感像"卡住了"。
    修法：在 `paint()` 里用 `efforts[passedIdx]`（旋钮当前所在档）同步写这三样，
    和填充同一帧。写之前先比对字符串，避免 125Hz 下无谓的样式失效。

49. **改名要一次改齐六处，漏一处就静默不挂载。**
    从 `dsh-codex-effort-silder` 改成 `dsh-effort-dial`，涉及：
    ① 插件目录名 ② `package.json` 的 `name` ③ 插件自带 `cordis.patch.yml` 的 `insert.id/name`
    ④ `client.js` 的 `id` / `PLUGIN_ID` / `NAMESPACE` / `SETTINGS_KEY` / `BOOST_KEY` / console 前缀
    ⑤ profile `package.json` 的 `dependencies` 键 + `dsh.profile.bundles` 条目
    ⑥ `node_modules` 软链接 + `pnpm-lock.yaml`。
    另外：`git bash` 的 `ln -s` 在这台机器上没权限，得用 PowerShell 的
    `New-Item -ItemType Junction` 建目录联接（pnpm 原来建的是符号链接，改名后断链）。
    验证不能只跑离线断言（那测的是源码字符串），必须真机 CDP 看 `.dsces-*` 节点。

50. **从 WorkBuddy 会话里直接启动 DSH 会带 `ELECTRON_RUN_AS_NODE=1`。**
    这个环境变量让 Electron 的 `DeepSeek Harness.exe` 退化成纯 Node：
    `--remote-debugging-port=9333` 会被当成 Node 选项报 `bad option`，
    加 `--` 分隔又会变成「找不到模块 --remote-debugging-port=9333」。
    正确启动：`env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "D:/DEEPSEEK/DeepSeek Harness.exe" --remote-debugging-port=9333`。
    启动后约 10 秒内 slot 才挂载，太早查 DOM 会误判成"插件没加载"。
