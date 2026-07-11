共识弹幕显示设计

当多条相似弹幕被合并时，合并后的弹幕会放大字号，用视觉权重表达"观众共识强度"。合并越多，字号越大（对数增长）。 我的目标：在自己的弹幕插件中实现同样的"合并放大"功能。 已经实现的部分 1. 弹幕合并：使用 WASM 相似度检测，合并时间接近且内容相似的弹幕 ✓ 2. 合并标记：在合并弹幕后显示 Σ 数量 ✓ 3. 文本预处理：全角转半角、去标点等 ✓ 4. 自己的密度系统：滑块 5-85，数值表示弹幕滑过屏幕宽度的百分比才释放轨道（比如 50 表示滑过一半才释放）✓ 核心问题 当合并弹幕被放大字号后，它需要占用多条轨道（因为高度增加了），但轨道可能已经满了。 具体场景 普通弹幕：height = 25px × 1.125 = 28px 放大 2 倍：height = 50px × 1.125 = 56px（需要 2 条轨道） 放大 3 倍：height = 75px × 1.125 = 84px（需要 3 条轨道） 400px 播放器： - 普通弹幕：最多 14 条同时显示 - 放大 2 倍：最多 7 条同时显示 - 放大 3 倍：最多 4 条同时显示 轨道分配逻辑（worker.js） // 滚动弹幕的轨道分配 // 1. 收集所有现有轨道（每条轨道记录最右边缘位置） const tracks = new Map() rolling.forEach(d => { const rightEdge = d.left + d.width const currentTop = Math.round(d.top) if (!tracks.has(currentTop) || rightEdge > tracks.get(currentTop)) { tracks.set(currentTop, rightEdge) } }) // 2. 查找可用轨道：右边缘 + 最小间距 ≤ 播放器宽度 for (let [trackTop, lastRight] of tracks.entries()) { if (trackTop >= marginTop && (trackTop + target.height) <= maxTop) { if (lastRight + minHorizontalGap <= clientWidth) { availableTracks.push(trackTop) } } } 当所有轨道的右边缘都接近播放器右侧时，返回 undefined（无可用轨道），弹幕不会显示。 讨论过的方案 方案 1：运行时降级（被否定） 思路：当轨道满了，尝试不同的密度参数，或者强制发射。 问题： - 补丁味道太重，越补越复杂 - 强制发射会导致弹幕重叠，体验不好 方案 2：限制放大倍数（cap） 思路：在公式中加一个硬上限，确保放大后的弹幕不会超出垂直容量。 calcEnlargeRate(mergeCount) { if (mergeCount <= 5) return 1 if (mergeCount <= 25) return 2 return 3 // 硬上限 } 问题： - 我（用户）觉得不需要这么精细的控制 - 一个简单的分段函数就能解决，但这不是问题的关键 方案 3：空气墙（反复讨论） 思路：在放大弹幕前插入"空白弹幕"，提前占据轨道，把普通弹幕挤掉。 第一版：插入一条空白弹幕 致命缺陷： - 空白弹幕宽度 ≈ 0，worker 认为轨道"还有空间" - 无法真正占据轨道 第二版：持续发射空白弹幕，形成"链条" // 在 load() 阶段，为每条放大弹幕插入空白弹幕 // 从 T-5s 开始，每秒发射一条空白弹幕，直到 T=0 for (let t = 5; t > 0; t -= 1) { airWalls.push({ text: '\u200B', // 零宽空格 time: enlargedDanmu.time - t, mode: enlargedDanmu.mode, color: 'transparent', }) } 问题： - 需要预计算（知道什么时候开始发射空白弹幕） - 我（用户）不确定预计算具体怎么实现 - 空白弹幕和放大弹幕可能在同一轨道重叠 方案 4：在放大弹幕前加空格 思路：在放大弹幕的文字前面加很多空格，让它更宽，从而"占住"轨道更久。 问题： - 这只是让弹幕更宽（水平方向） - 没有解决高度问题（垂直方向） - 放大弹幕需要多条轨道是因为高度增加，不是宽度 问题的本质 放大弹幕需要更多垂直空间 → 轨道可能不够 → 怎么办？ 所有方案归根结底只有两条路： 路 A：提前计划（预计算） - 知道放大弹幕要来 → 提前清道 → 放大弹幕顺利进入 - 需要在 load() 阶段识别放大弹幕，并插入空白弹幕或标记普通弹幕不显示 路 B：临场反应（运行时） - 放大弹幕来了 → 发现没轨道 → 临时处理 - 问题：被踢的弹幕会闪一下，体验不好 我（用户）倾向于路 A，但不知道具体怎么做。 数学背景 - 一条弹幕从右到左滑过屏幕需要约 20 秒 - 2 小时电影（7200 秒）约能显示 5000 条弹幕 - 50000 条弹幕中约 10% 能显示 - 所以"踢掉几条普通弹幕"不是问题——它们本来就不会显示 我的代码结构 packages/artplayer-plugin-danmuku/src/ ├── danmuku.js # 主逻辑（load、emit、update） ├── merge.js # 弹幕合并逻辑 ├── worker.js # 轨道分配（Web Worker） ├── preprocess.js # 文本预处理 └── wasm/ # WASM 相似度检测 关键流程： 1. load() → 获取弹幕 → 预处理 → 合并 → 入队 2. update() → 每帧检查 → 发射到时间的弹幕 3. worker.js → 计算弹幕的 top 位置（轨道分配） 求助 核心问题：当合并弹幕被放大字号后，需要占用多条轨道。如何确保这些轨道在放大弹幕发射时是空的？ 约束条件： 1. 不希望运行时踢弹幕（会闪） 2. 可以预计算（在 load() 阶段） 3. 不需要精细的密度控制，简单的方案就行 求助方向： - 有没有干净的预计算方案？ - 或者有没有我没想到的第三条路？”


共识弹幕显示设计 - 第二轮讨论总结
一、核心设计决策
采用"候选窗口"方案
朋友提出的方案：竞争发生在进入屏幕之前，而不是进入屏幕后。
普通弹幕 → 滚动轨道（原有逻辑）
合并弹幕（∑ > 5）→ Candidate Window（500ms时间窗口）→ 候选池 → 按 mergeCount 排序 → 选 Top N → 顶部频道展示
三条规则
条件	处理方式
∑ ≤ 5	不放大，保持原始模式（滚动弹幕）
5 < ∑ ≤ 10	放大字号，固定顶部模式
∑ > 10 且 > 现有 ∑ × 2	挤掉现有的大号弹幕（这个规则已废弃，由调度器统一处理）
关键参数
WINDOW_SIZE = 500        // 时间窗口：500ms
ENLARGE_THRESHOLD = 5    // ∑ > 5 进入候选池
MAX_DISPLAY_SLOTS = 2    // 每个窗口最多显示 2 条大号弹幕
二、文件结构
packages/artplayer-plugin-danmuku/src/
├── consensus-scheduler.js   ← 新增：共识弹幕调度器
├── danmuku.js               ← 修改：集成调度器 + 放大逻辑
├── merge.js                 ← 修改：修复时间阈值 bug
└── worker.js                ← 未修改
三、踩过的坑
坑 1：空气墙方案（已废弃）
思路：在大号弹幕前插入空白弹幕，提前占据轨道。
问题：空白弹幕宽度 ≈ 0，worker 认为轨道"还有空间"，无法真正占座。
结论：物理层占座不可行。
坑 2：clearTopSpace 方案（已废弃）
思路：大号弹幕发射前，清除周围的普通顶部弹幕。
问题：清除后大号弹幕总是出现在 marginTop（最顶部），导致：
- 只用了一条轨道
- 普通弹幕被挤掉后又回来，造成"闪现闪隐"
结论：运行时清理体验不好。
坑 3：合并算法的时间阈值 bug（已修复）
现象：∑260、∑229 的大号弹幕，时间分别是 798s 和 1382s（相差 584 秒），但它们被合并了。
根因：merge.js 中 WASM 返回的 idxDiff 可能指向 indexL 之前的弹幕（已超出时间阈值），但代码只检查了 targetIdx >= 0，没有检查 targetIdx >= indexL。
修复：
// 修复前
if (targetIdx >= 0 && targetIdx < storage.length)
// 修复后
if (targetIdx >= indexL && targetIdx < storage.length)
坑 4：大号弹幕时间已过
现象：大号弹幕进入队列（_isBigDanmuku: true），但永远不会显示。
根因：大号弹幕的时间来自原始弹幕。如果用户从视频中间开始播放，之前的大号弹幕时间已过，永远不会被 readys 选中。
当前状态：调度器已增加"只保留未来弹幕"的过滤，但需要用户从头播放视频才能验证。
四、当前实现状态
已完成
1. consensus-scheduler.js：候选窗口调度器，按时间分组，选 Top N
2. danmuku.js 集成：合并后调用调度器，标记 _isBigDanmuku
3. 放大逻辑：_isBigDanmuku 的弹幕放大字号 + mode=1
4. merge.js bug 修复：targetIdx >= indexL 检查
待验证
1. 从视频开头播放，观察大号弹幕是否正常显示
2. 确认合并阈值 30 秒在修复 bug 后是否合理
待讨论
1. MAX_DISPLAY_SLOTS = 2 是否合适？每 500ms 窗口显示 2 条大号弹幕
2. 大号弹幕的显示时长是否需要单独配置？
3. 是否需要大号弹幕的专属颜色/样式？
五、核心代码
consensus-scheduler.js
export function scheduleConsensusDanmuku(danmuku, currentTime = 0) {
  // 1. 分离大号弹幕（∑ > 5）和普通弹幕
  // 2. 只保留未来弹幕（time > currentTime）
  // 3. 按时间分组到 500ms 窗口
  // 4. 每个窗口按 ∑ 排序，选 Top 2
  // 5. 标记选中弹幕 _isBigDanmuku = true
  // 6. 合并返回
}
danmuku.js 核心逻辑
// 合并后调用调度器
danmus = scheduleConsensusDanmuku(danmus, this.art.currentTime)
// update() 中
if (danmu._isBigDanmuku) {
  const enlargeRate = this.calcEnlargeRate(danmu._mergeCount)
  finalFontSize = Math.ceil(baseFontSize * enlargeRate)
  danmu.mode = 1  // 固定顶部
}
merge.js bug 修复
// 必须同时满足：索引有效 + 在时间阈值范围内
if (targetIdx >= indexL && targetIdx < storage.length)



共识弹幕显示设计 - 第三轮讨论总结

共识弹幕（Consensus Danmuku）显示详细设计
一、 核心设计理念
竞争前置：所有“谁能放大”的竞争发生在弹幕进入屏幕之前，避免运行时的闪烁与轨道重排。
空间透视：滚动弹幕（前景）遮挡顶部大号弹幕（背景），营造社区的厚度感。
随机错落：打破“大号弹幕必在最上方”的死板逻辑，通过随机槽位映射实现视觉上的错落感。
不遗漏共识：竞选失败的大号弹幕降级显示，而非直接消失。
二、 核心模块流程
1. 共识调度器（Consensus Scheduler）
这是整个系统的“交警”，负责在 load() 阶段或 seek 之后进行全量/局部调度。
时间窗口（Candidate Window）：设定为 500ms。
候选规则：合并数
Σ
>
5
Σ>5
 的弹幕进入候选池。
排序算法：按
Σ
Σ
 降序排序。
准入名额（Top N）：
每个窗口最多选出 2 条 大号弹幕。
全屏同时存在的大号弹幕总数上限设为 5 条（防止过度遮挡画面）。
标记与分流：
Selected（入选者）：标记 _isBigDanmuku: true，设定 mode: 1（顶部）。
Fallback（降级者）：标记 _isBigDanmuku: false，设定 mode: 0（回归滚动），保留其
Σ
Σ
 标记。
2. 视觉层级（Visual Hierarchy）
通过 CSS 明确定义前后景关系：
前景（Z-index: 10）：普通滚动弹幕（Mode 0）。
背景（Z-index: 5）：顶部/底部固定弹幕（Mode 1/2），包括大号共识弹幕。
视觉效果：当文字在屏幕飞过时，会从巨大的“庸主啊”字样上方飘过，产生极强的空间感。
三、 轨道与槽位分配（Layout Strategy）
为了实现“错落有致”，我们引入**逻辑槽位（Logical Slots）**概念。
1. 逻辑槽位映射
不直接将大号弹幕死板地挂载到 track[0]。
Slot 划分：将播放器上半部分（如 0% - 50% 高度）划分为 10 条虚拟轨道。
随机选择：
当调度器选出一条大号弹幕时，在其适用的垂直范围内（如 Top 0px 到 PlayerHeight/2）随机选择一个起始位置。
碰撞检查：仅检查当前位置是否会被已有的 mode: 1 弹幕重叠。完全忽略滚动弹幕。
2. 放大倍数公式（对数压缩）
F
o
n
t
S
i
z
e
=
B
a
s
e
S
i
z
e
×
ln
⁡
(
Σ
)
ln
⁡
(
5
)
FontSize=BaseSize×
ln(5)
ln(Σ)
​

Σ
=
5
→
1.0
x
Σ=5→1.0x
Σ
=
25
→
2.0
x
Σ=25→2.0x
Σ
=
125
→
3.0
x
Σ=125→3.0x
硬上限：最大字号不超过 3 倍，避免遮挡过多画面。
四、 详细逻辑实现（ consensus-scheduler.js ）
code
JavaScript
/**
 * 共识弹幕调度逻辑
 * @param {Array} danmus 所有的弹幕数据
 * @param {Number} currentTime 当前视频时间
 * @returns 处理后的弹幕数组
 */
export function scheduleConsensusDanmuku(danmus, currentTime = 0) {
  const WINDOW_SIZE = 0.5; // 500ms 窗口
  const MAX_PER_WINDOW = 2; // 每个窗口选2个

  // 1. 桶排序：按 500ms 将弹幕分组
  const buckets = {};
  danmus.forEach(d => {
    if (d._mergeCount > 5) {
      const windowId = Math.floor(d.time / WINDOW_SIZE);
      if (!buckets[windowId]) buckets[windowId] = [];
      buckets[windowId].push(d);
    }
  });

  // 2. 窗口内竞争
  Object.values(buckets).forEach(bucket => {
    // 按合并数降序
    bucket.sort((a, b) => b._mergeCount - a._mergeCount);

    bucket.forEach((d, index) => {
      if (index < MAX_PER_WINDOW) {
        // 竞选成功：作为大号顶部弹幕
        d._isBigDanmuku = true;
        d.mode = 1;
      } else {
        // 竞选失败：降级为普通滚动，保持百花齐放
        d._isBigDanmuku = false;
        d.mode = 0;
      }
    });
  });

  return danmus;
}
五、 关键细节补充
1. 关于“遮挡”的哲学
顶部不挡顶部：在分配轨道时，大号弹幕之间必须有 1.2倍 的高度间距，确保文字不重叠。
滚动横穿大号：由于滚动弹幕层级高，它们会自然穿过大号弹幕的缝隙或身体。这种动态感是社区活力的体现。
2. 性能与 Seek 优化
预计算：在 load 时运行一次调度。
Seek 补丁：当用户点击进度条时，立即清理当前 states.emit 队列中不符合新时间点的大号标记，保证跳转后的即时感。
3. 样式微调
大号弹幕阴影：增加 text-shadow: 2px 2px 4px rgba(0,0,0,0.8)，确保在复杂的滚动弹幕背景下依然清晰可见。
Σ 标识：在文字末尾保留 (Σ数量)。
六、 方案优势总结
审美达标：完全复刻了你截图中那种“庸主啊”不拘一格、错落有致的社区氛围。
逻辑健壮：没有复杂的运行时物理碰撞计算，只有简单的准入调度。
体验流畅：因为竞争在进入屏幕前已完成，渲染压力极小，且绝无闪烁。



共识弹幕显示设计 - 第四轮（最终方案）：英雄选拔制

核心设计理念

大号弹幕是即时情绪的顶点，它必须精准，但不能廉价。
不能为了冷却而让弹幕"挪位"，而是在弹幕出现的原定时间点，去判定它是否有资格"登顶"成为那个英雄。
30 秒周期里只出一个视觉中心，其余时间顶部完全干净，让普通弹幕尽情飞。

一、算法：时效性英雄选拔（Timely Hero Selection）

1. 分桶

将全片弹幕按 30 秒一段进行分桶：
[0-30s] [30-60s] [60-90s] ...

2. 英雄资格筛选

在每个 30s 桶内，筛选 ∑ > 10 的弹幕作为候选。
∑ ≤ 10 的弹幕没有资格当英雄，直接走普通逻辑。

3. 王中王选拔

在候选中按 ∑ 降序排列，取前 3 名，从中随机选一个作为英雄：
_isHero = true
mode = 1（顶部固定）

随机选择的原因：XML 数据是固定的，如果每次总是展示 ∑ 最大的那个，
观众会感到疲惫。从前 3 名中随机挑选，增加新鲜感。

4. 降级制度

该桶内其余所有 ∑ > 5 的弹幕，强制降级为 mode = 0（滚动模式）。
即使它们的 ∑ 也很大，也不能当英雄——30 秒里只有一个王。

5. 无英雄周期

如果某个 30s 桶内没有任何 ∑ > 10 的弹幕，该周期没有英雄。
顶部完全留空，给普通弹幕呼吸感。

二、关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| BUCKET_SIZE | 30 | 30 秒一个考核周期 |
| HERO_THRESHOLD | 10 | ∑ > 10 才有资格当英雄 |
| 降级阈值 | 5 | ∑ > 5 但没当英雄的强制滚动 |

三、视觉层级（CSS Z-index）

通过 CSS 明确定义前后景关系：

| 层级 | z-index | 内容 |
|------|---------|------|
| 前景 | 10 | 普通滚动弹幕（mode=0） |
| 背景 | 5 | 英雄弹幕（mode=1）+ 顶部/底部固定弹幕 |

视觉效果：普通弹幕从巨大的英雄弹幕上方飘过，产生空间纵深感。

补充说明：同屏展示与错落轨道
- 英雄弹幕（mode=1）在顶部区域内随机选择一条轨道展示
- 顶部区域被划分为多条虚拟轨道（marginTop 到 maxTop 之间的空隙）
- 英雄弹幕随机选一个空隙放置，不会永远在最顶端
- 其他 mode=1 的弹幕（如用户手动发的顶部弹幕）由 Worker 放在英雄下方的空隙
- 所有 mode=0 的滚动弹幕 z-index 更高，会从英雄弹幕前方飘过
- 降级的 ∑ 弹幕（mode=0）也作为普通滚动弹幕，带着 ∑ 标记飞过

四、字号放大公式（对数压缩）

FontSize = BaseSize x ln(Σ) / ln(5)

| Σ | 放大倍数 |
|----|---------|
| 5 | 1.0x |
| 10 | 1.4x |
| 25 | 2.0x |
| 125 | 3.0x |

硬上限：最大字号不超过 3 倍，避免遮挡过多画面。

六、触发时机

1. load() 阶段

所有弹幕 emit 入 states.wait 后，运行一次调度：
scheduleConsensusDanmuku(this.states.wait, this.art.currentTime)

2. seek 后

用户拖动进度条后重新调度：
- 对 states.wait 中的弹幕重新标记
- 清理 states.emit 中已过时间的英雄弹幕

七、文件结构与修改清单

packages/artplayer-plugin-danmuku/src/
  consensus-scheduler.js   <- 重写：英雄选拔调度器
  danmuku.js               <- 修改：集成调度器 + 英雄渲染逻辑
  style.less               <- 修改：z-index 分层
  merge.js                 <- 未修改（已有 bug 修复）
  worker.js                <- 未修改

具体修改：

consensus-scheduler.js（完全重写）
- 30 秒分桶
- 每桶选 ∑ 最大的一个当英雄
- 同桶其余 ∑ > 5 强制降级滚动

danmuku.js
- load() 中调度器改为原地标记（不再返回新数组）
- 新增 video:seeked 监听
- update() 中英雄弹幕：放大字号 + mode=1 + z-index:5 + 强阴影
- 英雄弹幕 restTime / 4（快速闪隐）
- 英雄弹幕通过 Worker 放置（height x 1.5 + randomTrack=true 让 Worker 随机选轨道）
- 删除旧的 calcEnlargeRate、getBigDanmukuSlot 方法

worker.js
- mode=1 逻辑重写：收集所有可用空隙，英雄弹幕随机选一个，普通顶部弹幕从上到下选第一个

style.less
- [data-mode='0'] -> z-index: 10（前景）
- [data-mode='1'], [data-mode='2'] -> z-index: 5（背景）

八、调试日志

调度器输出（consensus-scheduler.js）：
[Hero] 周期 0 | 英雄弹幕: 庸主啊 | ∑: 46 | time: 12.3s
[Hero] 降级: 太好了 | ∑: 12 | -> 滚动
[Hero] 调度完成 | 桶数: 15 | 英雄数: 5

渲染输出（danmuku.js）：
[Danmuku] 英雄显示: 庸主啊 | ∑: 46 | 字号: 60 | time: 12.3s

九、效果预期

| 时间段 | 顶部状态 | 滚动区域 |
|--------|---------|---------|
| 0-30s 无英雄 | 空 | 全部弹幕自由飞 |
| 0-30s 有英雄 | 1 个大号 ∑46 闪现 5s | 其余弹幕 + 降级的 ∑12 滚动 |
| 30-60s 无英雄 | 空 | 全部弹幕自由飞 |
| 30-60s 有英雄 | 1 个大号 ∑38 闪现 5s | 其余弹幕滚动 |

核心体验：30 秒里只有 5 秒可能出现英雄，其余 25 秒顶部完全干净。
英雄在它该出现的时间点精准出现，不挪位，不延迟。
降级的 ∑ 弹幕化作带标记的小字，从英雄面前刷刷滚过。
