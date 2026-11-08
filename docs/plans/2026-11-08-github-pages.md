# GitHub Pages 网站部署 Implementation Plan

**Goal:** 将现有「衡」工具发布为可通过公开 HTTPS 地址访问的网站，保留已有计算和界面。

**Architecture:** 静态网页和内嵌周线数据继续在浏览器运行。GitHub Actions 生成仅含公共应用的 dist 并部署到 GitHub Pages；使用 workflow_run 在每周行情更新成功后发布，避免 GITHUB_TOKEN 提交不触发 push 的限制。

**Tech Stack:** HTML/CSS/JavaScript、Node.js、GitHub Actions、GitHub Pages。

## 方案选择

1. GitHub Pages（采用）：复用公开仓库，无需后端和额外账号。
2. EdgeOne：可作为将来的另一种托管方式，本次按用户要求使用 GitHub。
3. 服务器：现有功能不需要持续运行的服务，不引入额外维护。

## 实施与验收

1. 为 app/src.html 补齐标准 HTML 文档、语言、编码、viewport 和描述；同步 app/heng.html，并让本地预览直接提供完整文档。
2. 添加 app/scripts/publish.mjs，仅发布构建后的网页。运行 build.mjs 和 publish.mjs，检查内嵌数据可解析且无占位符。
3. 添加 deploy-pages.yml：main 应用变动、手动触发、每周行情更新成功均可部署；部署权限限制为 contents:read、pages:write、id-token:write。
4. 使用浏览器检查桌面和手机视口、导航、持仓操作、规则推荐与回测；记录实际失败并修复此次适配导致的问题。
5. 启用仓库 Pages 的 GitHub Actions 发布方式，提交代码并等待部署完成，检查公开 HTTPS 网站和线上交互。

## 范围和限制

- 保留原有纸张配色、布局、再平衡及回测逻辑，不增加登录或交易执行功能。
- 用户数据存储在访问者的本地浏览器，不上传仓库；AI 能力维持现有规则回退。
- 现有 CDN 图表、3D 与字体依赖需要网络。行情更新失败时不发布新版本，保留上一次可用网站。
