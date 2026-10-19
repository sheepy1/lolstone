# 招牌卡专属特效

配合 [spec.md](spec.md) 3.4 的 fxId 和 [m4-storyboard.md](m4-storyboard.md) 的约定（缓动代号、震屏档、粒子预设、声音层都沿用）。

原则：只给最有记忆点的招式做专属特效，其余卡按 fx 类型兜底。招牌卡的分量允许到"重"，时长允许到 1500ms；每局里重档的招牌特效不会太频繁，所以不受 1.4 的震屏频率限制，但同一回合里两张招牌卡连放时第二张降一档。

fxId 命名：小写字母、数字、点、下划线，写成"英雄 key 小写.招式英文"。数据里写在对应动作的 fxId 字段；脚本卡和 on_kill 卡的触发没有动作字段，导演按 (cardId, trigger 时机) 映射，表里注明。导演查不到 fxId 时按 fx 类型兜底，所以这些卡的 fx 字段照常填。

## 清单

| 卡 | 触发 | fxId | fx 兜底 | 时长 | 档 |
| --- | --- | --- | --- | --- | --- |
| 狂风绝息斩 | cast | yasuo.last_breath | physical | 1400ms | 重 |
| 暴风雪 | cast | anivia.glacial_storm | frost | 1300ms | 重 |
| 丽桑卓 | battlecry | lissandra.frozen_tomb | frost | 1200ms | 重 |
| 卡特琳娜 | battlecry | katarina.death_lotus | physical | 1000ms | 中 |
| 审判 | cast | garen.judgment | physical | 1100ms | 重 |
| 德玛西亚正义 | cast | garen.demacian_justice | holy | 1200ms | 重 |
| 泰达米尔 | script 触发，按 (freljord.tryndamere, script) 映射 | tryndamere.undying_rage | fire | 900ms | 中 |
| 易 | on_kill 触发，按 (ionia.masteryi, on_kill) 映射 | masteryi.highlander | physical | 600ms | 中 |
| 劫 | battlecry 的 summon | zed.living_shadow | shadow | 800ms | 中 |
| 李青 | combo 的 bounce | leesin.dragons_rage | physical | 900ms | 中 |
| 纳什男爵 | turn_end 的 buff | baron.hand_of_baron | shadow | 1000ms | 中 |

挑选理由：每个职业至少两张，加两张中立；选的是在 LoL 里一看就认得出的招式，而且在牌桌上是关键时刻（清场、斩杀、翻盘、滚雪球）。候选但没选、以后可以补的：沃利贝尔的雷霆（volibear.thunder）、艾尼维亚的蛋重生（anivia.rebirth）、瑟庄妮的极冻（sejuani.glacial_prison）。

## 分镜

每张卡：触发前的通用部分照常走（E07 出随从、E09 的展示段），下面只写专属部分；命中帧之后接通用的 damage、freeze、death 等事件。

### yasuo.last_breath 狂风绝息斩 · 1400ms · 重

| 阶段 | 时长 | 缓动 | 画面 |
| --- | --- | --- | --- |
| 展示 | 300 | E09 | 卡在中央，边缘白青色风纹 |
| 起风 | 300 | 线 | 一道旋风（stealth_smoke 变体，color 白青，螺旋，count 60）从我方一侧横扫敌方整排 |
| 抬起 | 150 | 起 | 所有敌方随从被抬到 0.6 底座高，悬空抖动 |
| 连斩 | 200 | 线 | slash_trail count 40 横向扫过悬空的随从，三道 |
| 砸回 | 250 | 砸 | 随从砸回底座，命中帧；每个 dust_land count 8，错开 40ms |
| 收尾 | 200 | 飘 | 风散 |

粒子：stealth_smoke 变体、slash_trail、dust_land。声音：magic 风声从起风到收尾；action 连斩 whoosh 三声；impact 落地重一次。镜头：砸回命中帧 S2，棋盘闪白。
分量：重。记忆点是"抬起来再砸下去"，抬起的悬空 150ms 不能省。

### anivia.glacial_storm 暴风雪 · 1300ms · 重

| 阶段 | 时长 | 缓动 | 画面 |
| --- | --- | --- | --- |
| 展示 | 300 | E09 | |
| 压暗 | 200 | 落 | 环境光 -20%，敌方半场上空出现冰雾 |
| 风雪 | 600 | 线 | frost_spread 变体 dir down count 80 覆盖敌方半场落下；每个目标被雪到的瞬间是它的命中帧，从左到右错开 60ms：伤害飘字 + E17 覆冰 |
| 收尾 | 200 | 落 | 环境光恢复，雪停 |

粒子：frost_spread 变体、ice 常驻。声音：magic 风雪持续到收尾；impact 冰击取一次重。镜头：第一个命中帧 S2，棋盘闪冰色。
分量：重。和通用群体法术的区别是"持续落下"而不是一下子炸开。

### lissandra.frozen_tomb 丽桑卓 · 1200ms · 重

| 阶段 | 时长 | 缓动 | 画面 |
| --- | --- | --- | --- |
| 举手 | 200 | 起 | 丽桑卓底座后仰并抬 0.1 底座高 |
| 蔓延 | 350 | 线 | 冰从她脚下沿地面向敌方半场蔓延（地面冰材质裁切推进），frost_spread dir toward 敌方 |
| 冰棺 | 每个 300，错开 40 | 落 | 冰到达每个敌方随从时冰棺从下往上包住：E17 的覆冰放大到 1.2 倍、带棺形轮廓 |
| 收尾 | 250 | 飘 | 地面冰退去，冰棺留下（它就是冻结的常驻冰层，只是大一号） |

粒子：frost_spread。声音：magic 冰蔓延持续；impact 每个冰棺合上一声轻，取一次重在第一个。镜头：S1，棋盘闪冰色。
分量：重。记忆点是冰从她脚下爬过去。

### katarina.death_lotus 卡特琳娜 · 1000ms · 中

| 阶段 | 时长 | 缓动 | 画面 |
| --- | --- | --- | --- |
| 起手 | 150 | 起 | 落地后底座下沉 0.05 |
| 旋转 | 500 | 线 | 底座绕 y 轴转两圈，slash_trail 环形 count 48 向四周 |
| 飞刀 | 150 | 线 | fire_bolt 变体（小、物理色、count 12）同时射向每个敌方随从 |
| 命中 | 错开 40 | | 每个目标 spark_light，接 damage |
| 收尾 | 200 | 落 | 转停 |

粒子：slash_trail、fire_bolt 变体、spark_light。声音：action 旋转 whoosh 持续；impact 命中一次轻。镜头：S1。
分量：中。1 点群体伤害不该比群体法术重，但旋转要够快才像她。

### garen.judgment 审判 · 1100ms · 重

| 阶段 | 时长 | 缓动 | 画面 |
| --- | --- | --- | --- |
| 展示 | 300 | E09 | |
| 落剑 | 200 | 砸 | 一把巨剑（剑形贴图加 slash_trail）从中央上方落到敌方整排前，落地 dust_land count 20 |
| 旋扫 | 400 | 线 | 巨剑绕 y 轴扫两圈，每圈经过每个随从时 spark_heavy；第二圈经过时是该随从的命中帧，错开 40ms |
| 收尾 | 200 | 飘 | 剑消散，地面扬尘 |

粒子：slash_trail、spark_heavy、dust_land。声音：impact 落剑重一次；action 旋扫 whoosh 两圈；命中取一次重。镜头：落剑 S1，第二圈 S2，棋盘闪白。
分量：重。两圈的节奏是记忆点：第一圈是预告，第二圈才结算。

### garen.demacian_justice 德玛西亚正义 · 1200ms · 重

| 阶段 | 时长 | 缓动 | 画面 |
| --- | --- | --- | --- |
| 展示 | 300 | E09 | |
| 天光 | 300 | 落 | holy_pillar 落在目标头顶，目标头像被照亮 |
| 落剑 | 200 | 砸 | 巨剑从画面上方直落砸在目标上 |
| 命中帧 | 0 | | spark_heavy count 24，S2，白闪；目标走 E14 死亡，碎裂方向改为从剑痕向两侧 death_shards dir out |
| 收尾 | 400 | 飘 | 剑没入地面消散，光柱淡出 |

粒子：holy_pillar、spark_heavy、death_shards。声音：magic 天光 300ms；impact 落剑重加低频在命中帧。镜头：S2。
分量：重。单体消灭要比普通命中重一档，否则看不出"消灭"和"打死"的区别。

### tryndamere.undying_rage 泰达米尔 · 900ms · 中

触发在那次致命伤害的命中帧之后，E12 的飘字照出。

| 阶段 | 时长 | 缓动 | 画面 |
| --- | --- | --- | --- |
| 减速 | 200 | 无 | 全局 timeScale 0.3，泰达米尔头像红色自发光到 1，底座抬 0.3 底座高（弹） |
| 怒吼 | 300 | 脉 | buff_ring 伤害红 color count 大，从他向外两圈；徽章数字跳到 1 并闪红 3 次 |
| 恢复 | 400 | 落 | timeScale 回 1，红光淡出但留一层淡红常驻到回合结束 |

粒子：buff_ring 红。声音：magic 火焰低吼在减速 t=0，impact 低频一次。镜头：S1。
分量：中。记忆点是时间慢下来那一瞬，用减速代替震屏。

### masteryi.highlander 易 · 600ms · 中

触发在击杀的死亡结算之后，E14 开始的同时。

| 阶段 | 时长 | 缓动 | 画面 |
| --- | --- | --- | --- |
| 残影 | 150 | 线 | slash_trail count 24 从易身上向外散开，头像蓝白自发光闪 |
| 重置 | 250 | 弹 | 底座绿色描边重新点亮并弹一下，buff_ring 小、蓝色 |
| 收尾 | 200 | 飘 | |

粒子：slash_trail、buff_ring。声音：magic 短促的"重置"音。镜头：S0。
分量：中。重点是把"又能动了"显示出来，玩家下一步就会去点他。

### zed.living_shadow 劫 · 800ms · 中

落地（E07）之后：

| 阶段 | 时长 | 缓动 | 画面 |
| --- | --- | --- | --- |
| 分离 | 250 | 线 | shadow_gather 逆向 dir out count 30，一道黑影从劫身上滑向右侧空槽，劫本体闪黑 100ms |
| 成形 | 350 | 弹 | 影分身在槽位成形（E20 的成形段），头像用劫的头像、暗色、半透明 0.7 |
| 收尾 | 200 | 飘 | |

粒子：shadow_gather。声音：magic 暗影滑出。镜头：S0。
分量：中。影分身要一看就是"劫的影子"，不是另一个随从。

### leesin.dragons_rage 李青 · 900ms · 中

连击触发时：

| 阶段 | 时长 | 缓动 | 画面 |
| --- | --- | --- | --- |
| 蓄力 | 150 | 起 | E11 的蓄力 |
| 冲踢 | 180 | 起 | E11 的冲锋，slash_trail |
| 命中帧 | 0 | | spark_heavy，S1 |
| 踢飞 | 300 | 起 | 目标沿高弧线飞向其拥有者手牌（E21 的飞回但更快、带 slash_trail），落入手牌弹 |
| 回位 | 270 | 落 | 李青弹回原槽 |

粒子：slash_trail、spark_heavy。声音：action 踢 whoosh；impact 重在命中帧；ui 落位。镜头：S1。
分量：中。踢飞的弧线要高，让玩家看清是"踢回手里"。

### baron.hand_of_baron 纳什男爵 · 1000ms · 中

回合结束触发时：

| 阶段 | 时长 | 缓动 | 画面 |
| --- | --- | --- | --- |
| 脉冲 | 400 | 线 | 男爵底座紫色（#8a4dff）光环向外扩一圈 |
| 增益 | 每个 400，错开 40 | E15 | 光环到达每个友方随从时走 E15，头像蒙紫光 |
| 收尾 | 200 | 飘 | |

粒子：buff_ring 紫、E15 的 buff_ring。声音：magic 低沉嗡鸣一次，增益声只播一次。镜头：S0。
分量：中。每回合都会触发，不能重，靠颜色辨识。
