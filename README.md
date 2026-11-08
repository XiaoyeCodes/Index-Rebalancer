# Index Rebalancer · 衡

**指数基金定投 + 动态再平衡工具。** 每月发薪后打开，告诉你这笔钱该买哪些指数基金、各买多少；有资产偏离目标太多时，也告诉你该卖什么。

*Index fund DCA, rebalanced. Steady by design.*

## 在线使用

网站地址：**https://xiaoyecodes.github.io/Index-Rebalancer/**

无需安装，电脑和手机浏览器均可打开。持仓和模型保存在当前浏览器的本地存储中，不会上传到仓库；换设备或清除浏览器数据后不会自动同步。独立网站使用规则推荐，Claude 环境的 AI 解读能力不会随部署自动获得。

## 网站部署

网站使用免费的 GitHub Pages，由 `.github/workflows/deploy-pages.yml` 发布：

- `main` 分支的应用代码更新后自动部署。
- 私有调度仓库推送行情更新后，自动发布最新数据；本仓库的手动行情更新成功后也会发布。更新失败时保留已上线版本。
- 可在 Actions → Deploy website → Run workflow 手动发布。

仓库 Settings → Pages → Source 选择 **GitHub Actions**。发布目录仅包含 `dist/index.html` 和 `.nojekyll`，不包含产品文档和构建脚本。图表、3D 和字体仍从现有 CDN 加载。

本地生成部署文件：

```bash
node app/scripts/build.mjs
node app/scripts/publish.mjs
```

## 功能

| 页面 | 做什么 |
| --- | --- |
| 我的动态再平衡计划（主页） | 录入持仓股数，按你的定投模型算出本月操作清单（买多少、卖多少、约合几股），可复制清单、一键按清单更新持仓；支持冷却期、只买整数股 / 整手；附带 3D 持仓天平（高/低波动两盘，偏离目标时倾斜，可预览按清单操作后的状态，可拖动托盘、旋转视角）、持仓解读与可选的 AI 解读 |
| 标的库 | 19 个适合长期定投的标的（美股、债券、黄金、比特币、A 股、港股），按防守、分散、核心、卫星、中国五层展示风险、20 年年化、波动、回撤、相关性和 K 线 |
| 定投模型 | 稳健、均衡、中美均衡、激进等模板，或自己调整目标权重与再平衡规则 |
| AI 方案 | 填写年龄、收入、可承受的下跌等信息，生成配置草案并立即回测检验；AI 不可用时用规则推荐 |
| 回测 | 2000 年至今的定投回测：策略净值 K 线、多标的与策略的走势对比、市值与累计投入、逐年收益、再平衡记录，并与"只定投不再平衡""同额定投标普 500"对比 |

## 目录

```
app/
  src.html                 页面源码（HTML + CSS + JS，单文件）
  heng.html                打包后的页面（src.html + 内嵌数据），直接用浏览器打开即可
  data/prices-weekly.json  2000 年至今的周线复权数据（含人民币、港币汇率）
  scripts/
    update.mjs             一条命令更新数据：下载 → 生成周线并校验 → 打包
    fetch.mjs              从 Yahoo Finance 下载日线（经 curl，遵循系统代理）
    process.mjs            合成周线、接续早年替代数据、清洗拆分与错误价格
    assets.mjs             标的与 Yahoo 代码对应表
    build.mjs              把数据内嵌进页面，生成 heng.html
    serve.mjs              本地预览服务器
docs/
  产品设计书.md             完整的产品设计书（需求、规则、验收、体验走查）
```

## 使用

需要 Node.js 18+ 和 curl。

```bash
# 更新行情数据并重新打包页面（约 1–2 分钟）
node app/scripts/update.mjs

# 只用已下载的数据重新打包
node app/scripts/update.mjs --skip-fetch

# 更新后只提交数据和页面并推送到 GitHub（每周定时任务使用）
node app/scripts/update.mjs --git

# 本地预览，打开 http://localhost:5178
node app/scripts/serve.mjs
```

页面是一个独立的 HTML 文件，图表库从 CDN 加载。AI 功能需要在 claude.ai 中打开页面时才能使用；在其他环境里会自动改用规则推荐。

## 自动更新

定时更新在专用的私有仓库 `XiaoyeCodes/Index-Rebalancer-Automation` 中运行：每周六北京时间 **09:17** 更新，周日 **09:47** 补跑。私有调度仓库不适用 GitHub 当前对公开仓库定时任务的「60 天不活跃停用」规则；无需通过空提交保持活跃。

任务在 GitHub 的服务器上运行 `node app/scripts/update.mjs --git`：下载最新行情、校验、重新打包页面，然后只提交并推送 `app/data/prices-weekly.json` 与 `app/heng.html`。使用仅授权给本仓库的专用 SSH 部署密钥，私钥保存在私有调度仓库的 Actions Secret 中。数据没有变化时不提交；下载或校验失败时保留已上线版本。真实数据提交会触发网站自动发布。

本仓库的 [`.github/workflows/weekly-update.yml`](.github/workflows/weekly-update.yml) 保留手动更新入口：Actions → Weekly data update → Run workflow。私有调度消除了上述公开仓库不活跃条件，但 GitHub 故障、账户 Actions 额度耗尽、密钥撤销或行情源故障仍可能影响更新；不能承诺任何第三方平台永久无故障。私有调度会使用账户内含的 Actions 计算额度，不使用付费规格的运行器。

## 数据说明

- 价格来自 Yahoo Finance 日线（含分红与拆股调整的复权价），合成为周线；不同市场按交易所当地日期分周。
- 成立较晚的标的，早年用同指数或同类资产接续（如 QQQM 之前用 QQQ，中证 A500 之前用沪深 300 ETF 和上证指数），每个标的的接续来源在页面"数据说明"中注明。
- 人民币、港币资产在回测和再平衡中按当周汇率折算成美元。
- 回测假设按周收盘价成交、允许零碎份额、分红再投资、不计税。

## 免责声明

本项目用于学习定投与再平衡方法，不构成投资建议。历史表现不代表未来，实际下单请以券商报价为准。
