# Nova 版本发布方案

Nova 使用语义化版本和 GitHub Releases 分发安装包。应用仅在用户点击“检查更新”时联网，不在后台静默下载或安装。

## 版本规则

- 修订版 `0.1.1`：兼容性修复和小范围优化。
- 次版本 `0.2.0`：向后兼容的新功能。
- 主版本 `1.0.0`：存在迁移要求或不兼容变化。
- Git 标签必须与 `package.json` 一致，格式为 `vX.Y.Z`。
- GitHub Release 标题使用 `Nova X.Y.Z`，正文写面向用户的变更说明。

## 发布流程

1. 确认主分支测试、类型检查和构建通过。
2. 更新 `package.json` 与 `package-lock.json` 中的版本号并提交。
3. 创建并推送同版本标签，例如 `git tag v0.2.0 && git push origin v0.2.0`。
4. `.github/workflows/release.yml` 会分别构建 macOS Intel、macOS Apple Silicon、Windows x64 和 Linux x64 安装包。
5. 工作流完成后检查 Release 资产和变更说明，再用上一版本实际执行一次“检查更新 → 下载更新 → 打开安装包”。

安装包命名固定为 `Nova-{version}-{os}-{arch}.{ext}`。应用根据操作系统、CPU 架构和扩展名选择资产；没有匹配资产时只提供版本页面，避免下载错误平台的安装包。

## 界面热更新

仅包含 `src/` 或其他纯前端资源的变更，可以发布界面热更新。

推送标签后，`.github/workflows/renderer-release.yml` 会执行测试、类型检查和 Vite 构建，生成签名的渲染包与清单，并发布为 GitHub prerelease。客户端验证 Ed25519 签名、归档 SHA-256 和每个文件的 SHA-256 后原子切换资源，加载失败时自动回退到内置界面。

以下变更不能使用界面热更新，必须发布完整版本：

- `electron/main/` 主进程逻辑。
- `electron/preload/` 或 `NovaApi` 接口变化。
- Electron、Node.js、DBHub 或其他生产依赖变化。
- 本地数据结构、数据库迁移或安全边界变化。

热更新签名私钥保存在 GitHub Actions Secret `NOVA_RENDERER_UPDATE_PRIVATE_KEY` 中，仓库只包含验签公钥。更新 Shell API 时必须递增 `renderer-update.json` 中的 `shellApiVersion`，避免旧应用加载不兼容界面。

## 更新链路

1. 主进程请求仓库的最新正式 Release，并按语义化版本比较当前版本。
2. 设置页显示版本号、发布日期、安装包名称、大小和更新说明。
3. 下载写入系统下载目录下的 `Nova` 文件夹，未完成文件使用 `.download` 后缀。
4. 下载完成后用户可直接打开安装包；安装与重启仍由操作系统确认。

内部 macOS 版本在打包阶段使用 ad-hoc 签名，并在 DMG 中提供“安装 Nova”脚本。脚本会将应用复制到 `/Applications`、移除该应用的隔离属性并启动。由于没有 Apple Developer ID，首次运行安装脚本时仍可能需要在 Finder 中右键选择“打开”。

## 发布前要求

- 正式对外发布前应配置 macOS Developer ID 签名与公证、Windows 代码签名证书。
- Release 不应标记为 draft 或 prerelease，否则“最新正式版本”接口不会返回该版本。
- 不要删除已发布版本的安装资产，老版本用户仍可能通过 Release 页面获取它们。
