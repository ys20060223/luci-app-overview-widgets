# CLAUDE.md

OpenWrt LuCI plugin for online user management, built with ucode RPC + JS view architecture.

## Architecture

**Modern LuCI stack** — no Lua controller, no htm templates:
- `root/usr/share/rpcd/ucode/luci.overview.uc` — ubus RPC module with 5 methods
- `htdocs/luci-static/resources/view/overview-widgets/index.js` — LuCI JS view using E() API
- `htdocs/luci-static/resources/overview-widgets/style.css` — custom CSS matching preview.html design
- `root/usr/share/luci/menu.d/` — menu entry under admin/status
- `root/usr/share/rpcd/acl.d/` — ubus/uci/menu permissions
- `root/etc/config/overview-widgets` — default UCI config, persistent icon/label storage

## Key RPC Methods

```ucode
luci.overview.getOnlineUserlist()   → { userlist: [...], savedIcons: {}, savedLabels: {} }
luci.overview.disconnectClient(args) { mac } → { result: bool }
luci.overview.renameDevice(args)    { mac, label } → { result: bool }
luci.overview.setIcon(args)         { mac, icon }   → { result: bool }
luci.overview.flushArp()            → { result: bool }
```

## Data Sources

Device discovery reads from:
- `/proc/net/arp` + `ip neigh show` — ARP/neighbor tables
- `/tmp/dhcp.leases` — DHCP lease info (ip, hostname, expiry)
- `/tmp/hosts/odhcpd` + `/tmp/hosts/dhcp` — hostname resolution
- `iw dev ... station dump` — WiFi signal strength and bitrate
- WiFi interface detection via `/sys/class/net/*/wireless`

Persistent config (icon, label) stored in UCI section type `dev` under `overview-widgets`.

## Build

```bash
# In OpenWrt SDK
make package/luci-app-overview-widgets/compile V=s

# Install .apk on device
opkg install luci-app-overview-widgets_*.apk
opkg install luci-i18n-overview-widgets_*.apk
```

## GitHub Actions

Build workflow at `.github/workflows/build.yml` targets `qualcommax-ipq50xx` (NX30 Pro). Triggers on `workflow_dispatch`. Produces `.apk` packages uploaded to GitHub Releases as `multi-arch-build` tag.

## JS View API Conventions

- Use `E()` for all DOM construction (never `innerHTML` with HTML strings)
- Event handlers use `click:` not `onclick:` in E() calls
- `poll.add(callback, interval)` for periodic data refresh (60s default)
- Strings: `_('translatable string')` via i18n; see `po/zh_Hans/overview-widgets.po`
- RPC calls: `rpc.declare({ object: 'luci.overview', method: '...', expect: {...} })`

## Important Notes

- **Makefile must include `$(TOPDIR)/rules.mk`** before `$(TOPDIR)/feeds/luci/luci.mk` — omitting it causes `No rule to make target '/package.mk'` error
- SDK URL for ipq50xx: `https://downloads.openwrt.org/snapshots/targets/qualcommax/ipq50xx/openwrt-sdk-qualcommax-ipq50xx_gcc-14.4.0_musl.Linux-x86_64.tar.zst`
- Device config sections use type `dev` (not `device`) to avoid UCI keyword conflict
- ucode RPC runs under `/usr/share/rpcd/ucode/` — uses `import { readfile, popen } from 'fs'`, standard ucode builtins (`match`, `split`, `trim`, etc.)
- Do NOT use `import { uci } from 'luci'` in ucode — use direct filesystem reads of `/etc/config/overview-widgets` instead
