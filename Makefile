include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-overview-widgets
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

LUCI_TITLE:=Online Users Management for LuCI
LUCI_DEPENDS:=+rpcd +rpcd-mod-ucode +ucode +ucode-mod-fs
LUCI_PKGARCH:=all
PKG_LICENSE:=MIT
PKG_MAINTAINER:=ys20060223

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
