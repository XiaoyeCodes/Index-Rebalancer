# 17条历史行情差异：逐条核实与修正 · 2026-11-12

**结果：17条均已完成本轮复核。9条修正项目主源价格，8条保留得到多来源支持的主源价格，待复核0条。原始差异与采用依据均保留。**

核对口径统一为美元、常规交易时段的市场收盘价，按截至2026-11-11的后续拆股换算到同一股数单位；本表不是包含现金分红的总收益复权价。每个采用值至少有两个其他来源支持。使用了Nasdaq、腾讯、新浪；2026年的关键条目另外通过IBKR历史日线验证（`source=Last`、`outside_rth=false`）。

## 1. 已修正的9条主源日线价格

| 标的 | 日期 | 原Yahoo收盘 | 采用收盘 | 采用值的交叉来源 |
|---|---|---:|---:|---|
| AAPL | 2020-07-09 | 95.7525 | 95.6825 | [Nasdaq](https://api.nasdaq.com/api/quote/AAPL/historical?assetclass=stocks&limit=10000&fromdate=2000-01-01&todate=2026-11-11)、[Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usAAPL.OQ,day,2020-07-09,2020-07-09,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/AAPL) |
| AMZN | 2019-08-22 | 90.233 | 90.280 | [Nasdaq](https://api.nasdaq.com/api/quote/AMZN/historical?assetclass=stocks&limit=10000&fromdate=2000-01-01&todate=2026-11-11)、[Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usAMZN.OQ,day,2019-08-22,2019-08-22,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/AMZN) |
| BND | 2018-07-26 | 79.03 | 78.97 | [Nasdaq](https://api.nasdaq.com/api/quote/BND/historical?assetclass=etf&limit=10000&fromdate=2000-01-01&todate=2026-11-11)、[Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usBND.OQ,day,2018-07-26,2018-07-26,10) |
| BRK-B | 2019-08-12 | 197.18 | 197.20 | [Nasdaq](https://api.nasdaq.com/api/quote/BRK.B/historical?assetclass=stocks&limit=10000&fromdate=2000-01-01&todate=2026-11-11)、[Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usBRK.B.N,day,2019-08-12,2019-08-12,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/BRK.B) |
| SOXX | 2019-08-22 | 22.861111 | 22.876667 | [Nasdaq](https://api.nasdaq.com/api/quote/SOXX/historical?assetclass=etf&limit=10000&fromdate=2000-01-01&todate=2026-11-11)、[Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usSOXX.OQ,day,2019-08-22,2019-08-22,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/SOXX) |
| SPCX | 2026-06-16 | 211.39 | 201.80 | [Nasdaq](https://api.nasdaq.com/api/quote/SPCX/historical?assetclass=stocks&limit=10000&fromdate=2000-01-01&todate=2026-11-11)、[Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usSPCX.OQ,day,2026-06-16,2026-06-16,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/SPCX)、IBKR（请求参数见证据） |
| SPY | 2019-07-16 | 299.78 | 299.71 | [Nasdaq](https://api.nasdaq.com/api/quote/SPY/historical?assetclass=etf&limit=10000&fromdate=2000-01-01&todate=2026-11-11)、[Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usSPY.AM,day,2019-07-16,2019-07-16,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/SPY) |
| TLT | 2019-05-28 | 128.70 | 128.79 | [Nasdaq](https://api.nasdaq.com/api/quote/TLT/historical?assetclass=etf&limit=10000&fromdate=2000-01-01&todate=2026-11-11)、[Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usTLT.OQ,day,2019-05-28,2019-05-28,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/TLT) |
| VXUS | 2020-01-22 | 56.22 | 56.20 | [Nasdaq](https://api.nasdaq.com/api/quote/VXUS/historical?assetclass=etf&limit=10000&fromdate=2000-01-01&todate=2026-11-11)、[Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usVXUS.OQ,day,2020-01-22,2020-01-22,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/VXUS) |

原始JSON浮点读数保存在证据文件，表格按相应报价精度展示。修正收盘时，同步维护对应的分红复权值，保留分红因子的含义。

**同时核实并修复的价格字段：**

- **BND，2018-07-26**：Yahoo的开、高、低、收均被写成约79.03，是一条被填平的日线。采用开盘 **79.06**、最高 **79.0968**、最低 **78.94**、收盘 **78.97**。Nasdaq与腾讯同日OHLC交叉支持；腾讯最高价为三位小数79.097，与Nasdaq较高精度79.0968的舍入一致。新浪没有可比的该日日线，未将空结果作为佐证。
- **SPCX，2026-06-16**：除收盘211.39改为 **201.80**，最低价还由约199.98改为 **195.13**。最低价得到新浪、腾讯与IBKR一致支持；最高225.64等其他未发现此项错误的字段保留。IBKR对应美国Nasdaq的SpaceX普通股合约890493863，避免与旧同名ETF或加拿大证券混淆。
- 成交量不在这次价格修正范围内。不同来源的成交量汇总并不完全一致，本项目统计与回测不使用成交量，不据此猜测替换。

## 2. 保留原值、标记对照记录的8条

| 标的 | 日期 | 保留的市场收盘价 | 未采用的Nasdaq对照值 | 保留依据 |
|---|---|---:|---:|---|
| GLD | 2026-04-20 | 442.09 | 445.9300 | [Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usGLD.AM,day,2026-04-20,2026-04-20,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/GLD)、IBKR（请求参数见证据） |
| GLD | 2017-03-20 | 117.51 | 117.5645 | [Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usGLD.AM,day,2017-03-20,2017-03-20,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/GLD) |
| GLDM | 2026-04-20 | 95.26 | 96.0400 | [Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usGLDM.AM,day,2026-04-20,2026-04-20,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/GLDM)、IBKR（请求参数见证据） |
| SCHD | 2026-04-20 | 31.03 | 31.0500 | [Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usSCHD.AM,day,2026-04-20,2026-04-20,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/SCHD)、IBKR（请求参数见证据） |
| SPY | 2026-04-20 | 708.72 | 710.1400 | [Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usSPY.AM,day,2026-04-20,2026-04-20,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/SPY)、IBKR（请求参数见证据） |
| VNQ | 2017-03-20 | 82.37 | 82.2991 | [Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usVNQ.AM,day,2017-03-20,2017-03-20,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/VNQ) |
| VOO | 2017-03-20 | 218.37 | 218.3327 | [Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usVOO.AM,day,2017-03-20,2017-03-20,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/VOO) |
| VWO | 2017-03-20 | 40.45 | 40.4681 | [Tencent Finance](https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usVWO.AM,day,2017-03-20,2017-03-20,10)、[Sina Finance](https://finance.sina.com.cn/staticdata/us/VWO) |

- **2026-04-20的GLD、GLDM、SCHD、SPY**：Nasdaq接口的该日close字段分别与前一交易日2026-04-17的收盘值一致。腾讯、新浪与IBKR均支持表中保留的4月20日价格。此处记录的是可复核的字段现象，不声称已获得供应商对内部原因的确认。
- **2017-03-20的GLD、VNQ、VOO、VWO**：原Yahoo市场收盘价与腾讯、新浪一致。Nasdaq这4个具体对照值不被本项目采用；未把它们擅自认定为NAV或某一其他价格口径，内部成因仍无供应商确认。
- 这8条并非需要把项目原值替换成Nasdaq值的依据。审计结果保留原始双方报价，并将每个已复核条目精确标记。

## 3. 拆股口径核对

直接比较历史交易时的原始股价与今天的拆股调整价会得出假差异，本轮先统一单位：

| 标的 | 第三来源历史原价 | 后续拆股除数 | 同口径价格 |
|---|---:|---:|---:|
| AAPL | 382.73 | 4 | 95.6825 |
| AMZN | 1,805.60 | 20 | 90.28 |
| SOXX | 205.89 | 3 × 3 = 9 | 22.876666… |

依据：[Apple拆股记录](https://investor.apple.com/dividend-history/default.aspx)、[Amazon投资者FAQ](https://ir.aboutamazon.com/faqs/default.aspx)、[OCC关于SOXX 2024年3:1拆股的公告](https://infomemo.theocc.com/infomemos?number=53942)。SOXX在2026-11-05再次3:1拆股，由Yahoo事件与IBKR corporate-actions交叉核对，IBKR事件和请求参数保存在证据文件。

新浪压缩日线按其原始未复权数据读取，解码方式参考[AkShare的源代码](https://github.com/akfamily/akshare/blob/main/akshare/stock/quote/stock_us_sina.py)。不把前复权、现金分红复权、原始交易价混在一起比较。

## 4. 已接入每日更新，修正不会被重新下载覆盖

1. 每次下载后，按固定的标的、日期、已核实的错误值匹配，再应用经过多来源验证的字段修正。保留修改前后的字段与来源记录。
2. 供应商自己修复时识别为已正确；重复处理不重复调整。后续发生新的拆股时，按实际生效后的股数单位重新换算这些历史价格。
3. 收盘与对应复权收盘一起维护；如修正日是除息前一收盘日，维护更早的现金分红调整因子，防止制造虚假收益。
4. 已核实的8条对照异常仅允许精确匹配的证券、日期和报价；新日期、新值或不符合证据的OHLC范围不能借用旧结论。
5. 新增或变化后的未解释日线差异会阻止发布，并保留上一份通过验证的版本。
6. 审计中仍保留原始来源的17条差异；`unresolvedDisagreements=0`表示本轮没有待复核条目，不表示外部Nasdaq接口已被修改。8条已核实但未采用的对照值仍可查看。

证据：[history-resolutions.json](../app/data/history-resolutions.json)。每日复核结果：[historical-audit.json](../app/data/historical-audit.json)。实现：[reconcile-history.mjs](../app/scripts/reconcile-history.mjs)。

## 5. 对标的统计与模型回测的影响

在同一份原始下载上，修正前后对比 **37个标的**：周收盘数组、汇率数组均完全一致；周开高低价最大变化为 **0**。9条价格修正既没有落在所用周收盘点，也没有改变各周最终开高低收。

进一步对比37组标的统计与16组完整回测结果，全部相同，包括逐周净值、现金流结果、年度收益端点和月末权重。独立Python复算再次通过；**102项自动测试通过**，新增覆盖重复执行、供应商自行修复、未来拆股、除息、错误OHLC及新增非周末差异拒绝发布。

因此，当前页面的模型年化、最大回撤和期末市值不会因这9条历史日线修正而变化。这是周频输入相同的结果；日线处理链路中的错误已修复。后续行情更新或供应商其他历史修订仍可能改变数值。

本次结论仅针对这17条明确记录的差异和所列价格字段，不扩大解释为所有证券、所有日内成交或未覆盖历史的绝对认证。
