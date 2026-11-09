# Dynamic Rebalancing

**全天候动态再平衡策略。** 每月发薪后打开，告诉你这笔钱该买哪些指数基金、各买多少；有资产偏离目标太多时，也告诉你该卖什么。

*Index fund DCA, rebalanced. Steady by design.*

## 登录

本机入口为 [打开 Dynamic Rebalancing](http://127.0.0.1:5178/)。先启动本地服务，再输入账户密码。

## 网站部署

当前 GitHub 套餐不支持从这个私有源码仓库发布 Pages，原项目网址已停用。若通过支持 Pages 的仓库托管登录页，只需发布 `dist/index.html` 和 `dist/.nojekyll`。浏览器可能会提示允许访问本地网络。账户验证、模型调用和应用页面均由当前设备的本地服务提供。

本地生成部署文件：

```bash
npm ci --prefix assistant
npm run build --prefix assistant
node app/scripts/build.mjs
node app/scripts/publish.mjs
```

## AI 助手

进入「AI 助手」，点击「研究我的定投计划与当前持仓」即可发送当时的持仓和本月清单。普通新对话仅发送问题。回答支持 Markdown、复制原文和 PDF 下载。可在历史研究中继续提问、重命名、置顶或删除。

本地版沿用 SparkFlow 的 Vibe-Trading 服务。首次使用先构建前端，再运行 `npm run research:setup --prefix assistant`。需要 Node 24 和 Python 3.11+。在项目根目录将初始密码通过标准输入传给 `node app/scripts/init-access.mjs <DeepSeek配置文件路径>`。配置文件前三行分别为密钥、官方地址和模型。然后运行 `node app/scripts/serve.mjs`。

Pages 通过本机 127.0.0.1:5178 的授权接口读取应用和请求模型。没有运行此服务的设备无法独立登录。研究记录保存在当前设备。

## 功能

| 页面 | 做什么 |
| --- | --- |
| 我的动态再平衡计划（主页） | 录入持仓股数，按你的定投模型算出本月操作清单（买多少、卖多少、约合几股），可复制清单、一键按清单更新持仓；支持执行前定投日期提醒与确认、只买整数股 / 整手；顶部持仓卡片内嵌可旋转的 3D 天平，高/低波动两盘放置带代码与占比的小砝码，悬停或轻触查看明细，偏离目标时倾斜，可预览操作后状态、拖动托盘；附带持仓解读与可选的 AI 解读 |
| 标的库 | 34 个基金、指数与个股，按防守、分散、核心、卫星、中国、海外个股六层展示；支持收藏、查看当前模型标的、历史统计及 K 线，收藏保存在本机浏览器 |
| 定投模型 | 稳健、均衡、中美均衡、激进等模板；也可新建自己的模板，命名、搜索并选择标的、设置或平均分配权重，保存后直接选用，支持编辑和删除；自定义模板及再平衡规则保存在当前浏览器 |
| 回测 | 2000 年至今的定投回测：策略净值 K 线、多标的与策略的走势对比、市值与累计投入、逐年收益、再平衡记录，并与"只定投不再平衡""同额定投标普 500"对比 |

## 目录

```
app/
  src.html                 页面结构、交互和计算逻辑
  ui.css                   界面样式与响应式布局
  assets/                  本地字体、字体许可证与持仓卡片插画
  heng.html                打包后的页面，直接用浏览器打开即可
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

# 更新后只提交数据和页面并推送到 GitHub（每日定时任务使用）
node app/scripts/update.mjs --git

# 本地预览，打开 http://localhost:5178
node app/scripts/serve.mjs
```

账户和加密配置保存在项目的 `.private/access.sqlite`。密码使用带随机盐的 scrypt，模型配置使用 AES-256-GCM。主密钥单独存于用户配置目录的 `DynamicRebalancing/keys/vault.key`。迁移设备时需通过安全渠道备份二者。

在本地登录后通过「设置」更换模型或密钥。已在运行的本地研究引擎在下一次启动时加载新配置。网页版的模型请求由登录服务代理。

## 自动更新

定时更新在专用的私有仓库 `XiaoyeCodes/Index-Rebalancer-Automation` 中运行：每天北京时间 **09:17** 更新，当天 **11:47** 补跑。休市或行情没有变化时保留最近交易日数据。私有调度仓库不适用 GitHub 当前对公开仓库定时任务的「60 天不活跃停用」规则；无需通过空提交保持活跃。

任务在 GitHub 的服务器上运行 `node app/scripts/update.mjs --git`：下载最新行情、校验、重新打包页面，然后只提交并推送 `app/data/prices-weekly.json` 与 `app/heng.html`。使用仅授权给本仓库的专用 SSH 部署密钥，私钥保存在私有调度仓库的 Actions Secret 中。数据没有变化时不提交；下载或校验失败时保留已上线版本。

本仓库的 [`.github/workflows/weekly-update.yml`](.github/workflows/weekly-update.yml) 保留手动更新入口：Actions → Weekly data update → Run workflow。私有调度消除了上述公开仓库不活跃条件，但 GitHub 故障、账户 Actions 额度耗尽、密钥撤销或行情源故障仍可能影响更新；不能承诺任何第三方平台永久无故障。私有调度会使用账户内含的 Actions 计算额度，不使用付费规格的运行器。

## 数据说明

- 价格来自 Yahoo Finance 日线（含分红与拆股调整的复权价），合成为周线；不同市场按交易所当地日期分周。
- 成立较晚的标的，早年用同指数或同类资产接续（如 QQQM 之前用 QQQ，中证 A500 之前用沪深 300 ETF 和上证指数），每个标的的接续来源在页面"数据说明"中注明。
- 人民币、港币资产在回测和再平衡中按当周汇率折算成美元。
- 新增 VOO、SGOV、招商银行（600036）、长江电力（600900）、中国移动（600941）、中国神华（601088）、NVDA、MSFT、TSLA、AAPL、AMZN、SPCX、AXP、BRK-B、GOOG；均使用各自历史，不用其他资产补齐早期数据。
- SPCX 为 SpaceX，按其 [官方投资者说明](https://ir.spacex.com/faqs-and-contact/) 从 2026-06-12 上市后的历史开始，并校验证券类型和公司名称，避免混入曾使用相同代码的 ETF 数据。历史不足一年时，标的库不显示外推年化收益。
- 回测假设按周收盘价成交、允许零碎份额、分红再投资、不计税。

## 免责声明

本项目用于学习定投与再平衡方法，不构成投资建议。历史表现不代表未来，实际下单请以券商报价为准。
