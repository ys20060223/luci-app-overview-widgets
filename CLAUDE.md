# CLAUDE.md

OpenWrt LuCI 插件，用于在线用户管理，采用 ucode RPC + JS 视图架构。

## 架构

**现代 LuCI 栈** — 无 Lua 控制器，无 htm 模板：
- `root/usr/share/rpcd/ucode/luci.overview.uc` — ubus RPC 模块，5 个方法
- `htdocs/luci-static/resources/view/overview-widgets/index.js` — LuCI JS 视图，使用 E() API
- `htdocs/luci-static/resources/overview-widgets/style.css` — 自定义 CSS，匹配预览图设计
- `root/usr/share/luci/menu.d/` — 菜单入口，位于 admin/status 下
- `root/usr/share/rpcd/acl.d/` — ubus/uci/menu 权限配置
- `root/etc/config/overview-widgets` — 默认 UCI 配置，持久化图标/昵称存储

## 核心 RPC 方法

```ucode
luci.overview.getOnlineUserlist()   → { userlist: [...], savedIcons: {}, savedLabels: {} }
luci.overview.disconnectClient(args) { mac } → { result: bool }
luci.overview.renameDevice(args)    { mac, label } → { result: bool }
luci.overview.setIcon(args)         { mac, icon }   → { result: bool }
luci.overview.flushArp()            → { result: bool }
```

## 数据来源

设备发现读取以下位置：
- `/proc/net/arp` + `ip neigh show` — ARP/邻居表
- `/tmp/dhcp.leases` — DHCP 租约信息（IP、主机名、到期时间）
- `/tmp/hosts/odhcpd` + `/tmp/hosts/dhcp` — 主机名解析
- `iw dev ... station dump` — WiFi 信号强度和速率
- WiFi 接口检测：`/sys/class/net/*/wireless`

持久化配置（图标、昵称）以 UCI 类型 `dev` 存储在 `overview-widgets` 配置中。

## 构建

```bash
# 在 OpenWrt SDK 中
make package/luci-app-overview-widgets/compile V=s

# 安装到设备
opkg install luci-app-overview-widgets_*.apk
opkg install luci-i18n-overview-widgets_*.apk
```

## GitHub Actions

构建工作流位于 `.github/workflows/build.yml`，针对 `qualcommax-ipq50xx`（NX30 Pro）。通过 `workflow_dispatch` 手动触发，生成 `.apk` 包并上传至 GitHub Releases 的 `multi-arch-build` 标签。

## JS 视图开发规范

- 使用 `E()` 构建所有 DOM 元素（不要对 `innerHTML` 拼接 HTML 字符串）
- 事件处理用 `click:` 而非 `onclick:`
- `poll.add(callback, interval)` 定期刷新数据（默认 60 秒）
- 可翻译字符串用 `_('文本')` 包裹，翻译文件在 `po/zh_Hans/overview-widgets.po`
- RPC 声明：`rpc.declare({ object: 'luci.overview', method: '...', expect: {...} })`

## 重要注意事项

- **Makefile 必须在 `feeds/luci/luci.mk` 之前 include `rules.mk`**，否则会报 `No rule to make target '/package.mk'` 错误
- ipq50xx SDK 地址：`https://downloads.openwrt.org/snapshots/targets/qualcommax/ipq50xx/openwrt-sdk-qualcommax-ipq50xx_gcc-14.4.0_musl.Linux-x86_64.tar.zst`
- UCI 配置节类型用 `dev`（不用 `device`，避免关键字冲突）
- ucode RPC 使用 `import { readfile, popen } from 'fs'` 及 ucode 内置函数（`match`、`split`、`trim` 等）
- **不要在 ucode 中使用 `import { uci } from 'luci'`**，应直接读写 `/etc/config/overview-widgets` 文件
