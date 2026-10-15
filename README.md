# 海斗论战 · Mayhem Lab

[构筑实验室](https://xiaokai2810.github.io/haidou-lunzhan/) · [独立文字游戏：海斗战记](https://xiaokai2810.github.io/haidou-zhanji/) · [游戏源码](https://github.com/xiaokai2810/haidou-zhanji)

海克斯大乱斗构筑和虚拟对战工具。自由选择英雄、最多 4 个海克斯和 6 件装备，查看面板评分，进行 1v1 构筑比拼或挑战五名发育落后的人机。构筑可通过 URL 分享，推演在浏览器本地完成。随机英雄卡、装备经营和多轮团战的互动文字玩法已迁至独立的「海斗战记」站点。

## 功能

- **构筑分析**：当前静态快照包含 173 名英雄、195 个海克斯和 196 条装备资料。构筑选择器展示当前可购买的成装与鞋子；可调整等级、目标双抗并查看面板及强化建模覆盖率。
- **成长数据**：手动输入赛末层数，或导入自己的真实对局 CSV，按成长项目取有效记录的算术平均。文件只在浏览器中处理。
- **1v1 对决**：选择示例对手，或导入另一位玩家分享的构筑链接。结果展示有效输出、剩余生命和触发的规则修正。
- **1v5 人机挑战**：自由选择五名不同英雄作为人机。人机低 4 级、只有 1 件按职业分配的装备且没有海克斯；页面展示胜负、击败数量、伤害与各人机状态。
- **海斗战记入口**：从首页进入[独立文字游戏](https://xiaokai2810.github.io/haidou-zhanji/)，体验两张随机英雄卡与备选席、海克斯三选一、183 件可购买装备、三阶段团战决策及战后经济。

## 开发与部署

```bash
npm ci
npm run dev
npm test
npm run build
```

推送到 `main` 后，GitHub Actions 运行测试、构建并发布到 GitHub Pages。`public/data/` 是随仓库发布的静态快照。更新时核对 `scripts/fetch-data.sh` 使用的版本和 `public/data/meta.json` 的发布 ID，再运行 `bash scripts/fetch-data.sh`。脚本校验 Data Dragon 版本及 Mayhem 目录的同一发布 ID。

## 数据与计算口径

| 数据 | 当前快照与来源 | 用途 |
| --- | --- | --- |
| 英雄、装备静态属性 | Riot [Data Dragon 16.20.1](https://ddragon.leagueoflegends.com/api/versions.json) | 英雄成长、物品价格和基础面板 |
| 海克斯目录、稀有度、选取率 | [ARAMMayhem 26.20 开放数据](https://arammayhem.com/data/)，CC BY 4.0；统计截至 2026-10-11 | 可选目录与参考选取率 |
| 强化文案与图标 | [ARAMKit](https://aramkit.cn/zh-CN)、[CommunityDragon](https://raw.communitydragon.org/16.20/)、ARAMMayhem 图标 | 效果说明和界面素材 |
| 模式改动 | [Riot 26.20 补丁说明](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-20-notes/) | 版本核对 |

[海斗战记](https://github.com/xiaokai2810/haidou-zhanji)使用同一数据快照，并明确区分官方资料和本站设计的随机、经济、战术及联动规则。开放数据没有组合或英雄对位胜率；本站结果是启发式模拟，不代表实战胜率。职业关系提供 6%–12% 的小幅手工修正，部分可核对的英雄机制另有 5%–8% 的规则修正。技能时机、控制链、条件被动和模式专属平衡未完整建模。

### 成长项目

暂无可核验的全服逐场赛末层数数据，因此默认成长值为 0。玩家可手动设定，或导入自己的 CSV：

```csv
match_id,id,final_value
game-001,phenomenal_evil,83
game-002,phenomenal_evil,107
game-003,3084,492
```

支持的成长 ID 见 `src/model.js` 的 `GROWTH`。导入时过滤非数值与负值，对同一 ID 的有效记录取平均；文件不上传。

本站为非官方爱好者项目，未获 Riot Games 背书。游戏名称和素材归 Riot Games 所有。
