# 空荧酒馆地图 v5 · 完全离线版

基于 `cognitiveshadows03/genshin-map-v5` 的个人离线分支。地图、图标、点位和界面图片均已随项目打包；**首次启动即可在断开互联网的情况下使用，不依赖 Service Worker、远程 API 或预先存在的浏览器缓存。**

## 快速启动

要求：Node.js 18 或更高版本，以及支持 WebGL2 的现代桌面浏览器。

```bash
npm ci
npm start
```

打开 <http://localhost:13101>。`npm start` 会在缺少 `dist/` 时自动构建，之后启动只监听本机的静态文件服务器。

也可以使用启动脚本：

- Windows：双击 `start.bat`
- macOS / Linux：运行 `./start.sh`

停止服务只需在终端按 `Ctrl+C`。应用运行时不会访问互联网。

### 不安装依赖，直接运行已构建版本

如果已经有 `dist/`，可以用任意静态 HTTP 服务器，无需执行 `npm ci`：

```bash
cd dist
python -m http.server 13101 --bind 127.0.0.1
```

然后打开 <http://localhost:13101>。请从 `dist` 根目录提供服务，不要直接双击 `index.html`；浏览器会限制 `file://` 页面使用模块、Fetch、IndexedDB 等必要能力。

## 离线范围

当前捆绑的是 `kxxoling/genshin-map-data` 的 **Teyvat Full v7.1.1** 官方提瓦特地表快照：

| 内容 | 数量 / 版本 |
| --- | --- |
| 游戏数据版本 | 7.1.0 |
| 地图版本 | `eea752b746ae1f2e0c1988a574f2b7b0` |
| 地图切片 | 13,770 张，合并为 76,927,502 字节的 `tiles.pack` |
| 图标 | 793 个，合并为 1,598,012 字节的 `icons.pack` |
| 地表点位 | 85,788 个 |
| 有点位的分类 / 物品 | 13 / 702 |
| 排除的地下及分层点位 | 2,896 个 |

地图切片索引和图标索引均含偏移、长度与整包 SHA-256。运行时从本地包按需读取，不会向图床或地图服务器发起请求。

### 当前边界

- 仅包含官方提瓦特地表地图；原旧版的八张地图、地下地图和楼层切换数据没有包含在此快照中，因此未伪装成可用功能。
- 点位具有官方名称和坐标；快照不含旧版空荧酒馆的详细图文描述、视频或刷新时间元数据。
- 在线账号、云端同步、在线编辑、自动更新和远程数据库下载已关闭或阻断。
- 点位完成状态、筛选条件和偏好仅保存在当前浏览器的 IndexedDB / localStorage 中。
- 浏览器数据按源（协议、主机、端口）隔离。更换端口或主机名会创建另一份本地数据；清理浏览器站点数据会删除完成状态。

## 操作

1. 点击左侧箭头展开分类。
2. 依次选择 **提瓦特 → 分类 → 物品**。选择地区会清空旧分类，这是预期行为。
3. 缩放或拖动地图；点击点位可查看详情并切换完成状态。
4. 使用左下方返回箭头重置地区，或使用顶部设置调整显示偏好。

首次加载需要读取约 77 MiB 的本地地图包及点位数据，因此可能需要数秒。后续启动会复用同源的版本化本地包缓存，但缓存不是首次启动或离线运行的前提。

## 验证

```bash
# 首次在开发机上准备测试浏览器时需要；应用正常运行不需要 Playwright。
npx playwright install chromium

# 自动重新构建并执行完整验证
npm run verify:offline
```

验证器会：

- 校验 tile/icon 索引、整包 SHA-256、每个条目的边界和 WebP 文件头；
- 校验所有地表点位的分类与图标引用；
- 扫描运行时代码中的外部 URL，并确认生产 CSP；
- 在全新 Chromium 配置中**禁用 Service Worker，并阻断所有外部 HTTP(S)/WebSocket 请求**；
- 验证首次启动画布、IndexedDB 数据量、真实 UI 分类选择和本地偏好持久化；
- 重新加载并验证 blob 图标 URL 已刷新、图标可解码且点位未重复；
- 将 JSON 报告和截图写入 `artifacts/`。

当前验证结果：13,770 张切片、793 个图标、85,788 个地表点位全部通过；首次启动、62 个七天神像的筛选、重载和本地持久化通过；外部请求、失败请求和控制台错误均为 0。

## 开发

```bash
npm run dev       # 本地开发服务器
npm run build     # 生成完全静态的 dist/
npm start         # 构建（如需要）并启动生产服务器
```

生产构建包含限制外部连接的 Content Security Policy，不生成或注册 Service Worker。应用也可部署到任何静态 HTTP 服务器；请部署在站点根目录，并保留 `offline/`、`assets/`、`icons/` 等目录结构。

## 更新离线快照

只有更新数据时才需要准备新快照；普通用户运行地图不需要下载任何数据。

```bash
npm run import:offline -- /absolute/path/to/extracted/teyvat
npm run build
```

导入器会重建 tiles/icons 包和索引，生成地表点位，并清除旧的逐文件图标输出。源快照目录不会被修改。

## 主要实现

- `scripts/import-offline-snapshot.mjs`：快照导入与索引生成。
- `scripts/serve-offline.mjs`：零第三方运行时依赖的本地静态服务器。
- `src/offline/bootstrap.ts`：首次启动初始化本地数据库及本地用户。
- `src/offline/tilePack.ts`、`iconPack.ts`：本地包读取与版本管理。
- `src/pages/pageMapV2/config/layers.ts`：提瓦特图层与投影配置。
- `src/utils/request.ts`：对遗留远程 API 调用进行预派发阻断。

游戏素材权利归原权利方所有；第三方快照来源保留在 `public/offline/source.json`。
