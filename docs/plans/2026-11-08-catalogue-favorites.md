# 标的库扩展与收藏 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 增加用户指定的 15 个证券，并在标的库提供独立收藏和当前模型筛选。

**Architecture:** 沿用单页 HTML、浏览器本地状态及 Yahoo 日线到周线的现有流程，不引入服务或依赖。收藏数组与模型权重独立；筛选数量从当前状态动态生成。个股只使用自身历史，SPCX 限定为 SpaceX 上市后的数据，避免同代码历史混用。

**Tech Stack:** 原生 JavaScript / CSS、Node.js、现有行情脚本、Playwright 浏览器验证。

---

### Task 1: 核对证券并接入历史数据

**Files:** `app/scripts/assets.mjs`, `app/scripts/process.mjs`, `app/data/prices-weekly.json`。

增加 VOO、SGOV、600036、600900、600941、601088、NVDA、MSFT、TSLA、AAPL、AMZN、SPCX、AXP、BRK-B、GOOG。中国公司按 A 股处理，SPCX 按官方确认的 2026-06-12 上市日期截断。下载真实行情，验证币种、公司身份、复权序列长度与正数、上市边界。失败时保持原始数据可用。

### Task 2: 完善标的展示

**Files:** `app/src.html`, `app/ui.css`。

配置名称、证券代码、股票/基金类型、币种、交易单位、风险说明及分层。基金沿用发行商图标，个股使用公司简称。个股费率栏显示不适用，历史不足一年不展示外推年化收益；详情保留实际历史范围。

### Task 3: 收藏与筛选

**Files:** `app/src.html`, `app/ui.css`。

在本地状态新增独立的收藏数组，兼容没有收藏字段的旧状态。标的行提供可键盘操作、带 aria-pressed 的收藏按钮，不触发详情或改变模型。在现有分类栏加入“我的收藏”和“当前模型”，数量、空状态和结果随收藏或模型变更同步更新。模型内待设权重的标的仍显示，以便管理；实际定投继续只使用正权重。

### Task 4: 构建与验证

**Files:** `app/heng.html`, `dist/index.html`, `docs/产品设计书.md`, `README.md`。

运行 `node app/scripts/update.mjs --skip-fetch` 和 `node app/scripts/publish.mjs`，生成本地可用页面。浏览器验证新增证券详情与图表、收藏/取消/刷新、模型筛选/移除/切换模板、排序和空结果、桌面与手机布局，以及原有再平衡计算。校验嵌入图标、价格完整性和 JavaScript 错误。只更新本地项目，不提交或推送。
