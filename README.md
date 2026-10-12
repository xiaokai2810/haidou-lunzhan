# 海斗论战 · Mayhem Lab

[在线体验](https://xiaokai2810.github.io/haidou-lunzhan/) · [GitHub 仓库](https://github.com/xiaokai2810/haidou-lunzhan)

海克斯大乱斗构筑与虚拟对战工具。选择英雄、最多 4 个海克斯和 6 件装备，查看 1–18 级面板、简化伤害与构筑评分；再用同一套构筑进行 1v1 比拼或挑战五名发育落后的人机。所有推演在浏览器本地完成，构筑可通过 URL 分享。

## 主要功能

- **构筑分析**：173 名英雄、195 个强化、122 件装备。可调整等级、目标双抗并查看面板及未建模效果覆盖率。
- **成长数据**：手动输入赛末层数，或导入真实对局 CSV，按每个成长项目所有有效记录取算术平均；数据只存于本地浏览器。
- **1v1 构筑对决**：选择预设对手，或让另一位玩家分享本站构筑链接并粘贴导入。结果展示有效输出、剩余生命和触发的职业/英雄机制修正。
- **1v5 人机挑战**：自由选择五名不同英雄作为人机。每名人机比玩家低 4 级、只有 1 件按职业分配的装备且没有海克斯；页面展示胜负、击败数量、伤害与每名人机状态。
- **自适应界面**：手机上将构筑分析置于虚拟对战之前；等级滑块拖动时保持操作连续，松开后更新完整推演。

## 开发与部署

```bash
npm ci
npm run dev
npm test
npm run build
```

推送到 `main` 后，GitHub Actions 运行测试、构建并发布到 GitHub Pages。仓库路径配置在 `vite.config.js` 中。

`public/data/` 是随仓库发布的静态快照。更新时先核对 `scripts/fetch-data.sh` 的三个版本号，再运行 `bash scripts/fetch-data.sh`；脚本会校验 Data Dragon 版本及 Mayhem 索引、强化和物品目录的同一发布 ID。若官方数据源更新版本，须同步检查构筑公式和模式专属改动。`public/data/meta.json` 记录快照版本、日期、来源和条目数。

## 数据口径

| 数据 | 当前快照与来源 | 用途 |
| --- | --- | --- |
| 英雄、装备静态属性 | Riot [Data Dragon 16.20.1](https://ddragon.leagueoflegends.com/api/versions.json) | 等级成长与基础面板 |
| 海克斯目录、稀有度、选取率 | [ARAMMayhem 26.20 开放数据](https://arammayhem.com/data/)，CC BY 4.0；统计截至 2026-10-11 | 可选目录与参考选取率 |
| 强化文案与图标 | [ARAMKit](https://aramkit.cn/zh-CN)、[CommunityDragon](https://raw.communitydragon.org/16.20/)、经验证的 ARAMMayhem 图标 | 效果说明和界面素材 |
| 模式改动 | [Riot 26.20 补丁说明](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-20-notes/) | 版本核对及限制说明 |

开放数据只发布选取率，不含组合或英雄对位胜率。Riot 的公开 Match-v5 目前也[不提供 Mayhem 逐场详情](https://github.com/RiotGames/developer-relations/issues/1109)，因此本站不会把对战结果写成实测胜率或全服预测。当前 195 个强化中，187 个有可核对的说明，147 个有可核对的图标；缺失项保留文字/首字占位，不拼造素材链接。

### 对战模型

推演使用英雄等级面板、装备可量化属性、已建模强化、目标护甲/魔抗和穿透计算持续输出与承伤。职业关系提供 **6%–12%** 的小幅规则修正；少数官方技能机制提供 **5%–8%** 的额外修正，例如[亚索风墙](https://www.leagueoflegends.com/en-us/champions/yasuo/)对飞行道具，以及[特朗德尔](https://www.leagueoflegends.com/en-us/champions/trundle/)对高双抗目标。结果会展示触发的规则。

1v5 在同一模型下加入目标切换、按职业估算的范围伤害、敌方控制影响和人机协同效率；这些系数是明确写在代码里的玩法假设，不来自实测胜率。技能释放时机、控制链、召唤师技能、条件被动及海斗专属平衡未完整建模，实战结果可能不同。

### 成长项目

暂无可核验的全服逐场赛末层数数据，因此默认成长值为 0。玩家可手动设定，或导入自己的 CSV：

```csv
match_id,id,final_value
game-001,phenomenal_evil,83
game-002,phenomenal_evil,107
game-003,3084,492
```

支持的成长 ID 见 `src/model.js` 的 `GROWTH`。导入时过滤非数值与负值，对相同 ID 的有效记录取平均；文件不上传。

本站为非官方爱好者项目，未获 Riot Games 背书。游戏名称和素材归 Riot Games 所有。
