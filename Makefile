#
# Copyright (C) 2024 OpenWrt
#
# This is free software, licensed under the GNU General Public License v2.
#

PKG_NAME:=luci-app-overview-widgets
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

LUCI_TITLE:=Online Users Management for LuCI
LUCI_DEPENDS:=+rpcd +rpcd-mod-ucode +ucode +ucode-mod-fs
LUCI_PKGARCH:=all
LUCI_MINIMIZE:=1

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
