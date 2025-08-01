# This is free software, licensed under the Apache License, Version 2.0 .
include $(TOPDIR)/rules.mk

LUCI_TITLE:=在线用户管理
LUCI_DESCRIPTION:=路由菜单下的可折叠在线设备管理工具
LUCI_DEPENDS:=+luci-base +rpcd +luci-lib-jsonc

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Your Name <your@email.com>
PKG_VERSION:=1.3.0
PKG_RELEASE:=1

include $(TOPDIR)/feeds/luci/luci.mk

define Package/luci-app-overview-widgets/install
	$(call Package/luci/install/template,$(1))
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/overview-widgets
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/overview-widgets/users.js $(1)/www/luci-static/resources/view/overview-widgets/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-overview-widgets.json $(1)/usr/share/rpcd/acl.d/
	$(INSTALL_DIR) $(1)/etc
	$(INSTALL_DATA) ./root/etc/overview.json $(1)/etc/
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/menu.d
	$(INSTALL_DATA) ./luasrc/menu.d/luci-app-overview-widgets.json $(1)/usr/lib/lua/luci/menu.d/
endef

# call BuildPackage - OpenWrt buildroot signature