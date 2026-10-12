# 海斗论战 · Mayhem Lab

海克斯大乱斗的本地面板推演工具。选择英雄、最多 4 个强化和 6 件装备，查看 1–18 级面板、目标抗性下的简化伤害示例与启发式构筑评价。构筑会保存在浏览器并可通过 URL 分享。

## 开发

```bash
npm ci
npm run dev
npm test
npm run build
```

`public/data/` 是已生成的 16.20 静态快照，克隆后无需运行数据脚本。更新快照可执行 `bash scripts/fetch-data.sh`；跨版本更新时，先核对脚本中的版本、来源 URL 和属性规则。

## 数据与边界

- 英雄及装备的静态属性：Riot Data Dragon 16.20.1。
- 可用海克斯、稀有度与选取率：[arammayhem.com 开放数据](https://arammayhem.com/data/)，26.20，CC BY 4.0。该数据集公开的是选取率，不是组合胜率。
- 强化说明：ARAMKit 和 CommunityDragon。仅少数可以清楚换算为面板数值的强化纳入计算；其他效果可选，但不会虚构其面板加成。
- 成长效果：没有可核验的全服逐场赛末层数数据。可手动设置赛末数值，或导入自己的真实对局 CSV，由浏览器对每个 ID 的所有记录求平均。文件不会上传。
- 强度评分是基于输出、生存、机动与续航的启发式指标，不是实测胜率或游戏内精确模拟。技能机制、条件被动、召唤师技能、对局节奏及英雄专属海斗平衡调整可能改变实际强度。

CSV 示例：

```csv
match_id,id,final_value
game-001,phenomenal_evil,83
game-002,phenomenal_evil,107
game-003,3084,492
```

支持的成长 ID 可在 `src/model.js` 的 `GROWTH` 查看。导入后仅在浏览器本地保存汇总均值。

## 部署

推送到 `main` 后，GitHub Actions 运行测试、构建并发布到 GitHub Pages。项目路径配置在 `vite.config.js` 中。若更改仓库名，须同步修改该路径。

本站为非官方爱好者项目，未获 Riot Games 背书。游戏名称和素材归 Riot Games 所有。
