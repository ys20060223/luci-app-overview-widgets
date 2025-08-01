// Copyright 2024 wsk170 <wsk170@gmail.com>
// Licensed to the GNU General Public License v3.0.

'use strict';
'require baseclass';
'require dom';
'require fs';
'require rpc';
'require uci';
'require network';
'require poll';

const overviewCfg = {};
const Store = {
  showUsers: true,
  showAllUsers: true,
  showRename: {},
  iconFiles: [],
  thisUser: { id: null, border: 0, boxShadow: 'none' },
  lastUser: { id: null },
  iconsCard: { show: false, oX: 0, oY: 0, tX: 0, tY: 0 }
};

let callLuciDHCPLeases = rpc.declare({
  object: 'luci-rpc',
  method: 'getDHCPLeases',
  expect: { '': {} }
});

function readOverviewConfig() {
  const path = '/etc/overview.json';
  return L.resolveDefault(fs.read_direct(path, 'json'), {});
}

function saveOverviewConfig() {
  const path = '/etc/overview.json';
  fs.write(path, JSON.stringify(overviewCfg, null, 2));
}

function getWifiNetworks() {
  return network.getWifiNetworks().then((nets) => {
    nets.forEach(async (net) => {
      net.assocList = await net.getAssocList();
    });
    return nets;
  });
}

function getOnlineUsers() {
  const params = ['-4', 'neigh', 'show', 'dev', 'br-lan'];
  return fs.exec('/sbin/ip', params).then((res) => {
    const users = [];
    const lines = res.stdout.trim().split(/\n/);
    lines.forEach((line) => {
      const [ip, addr, mac] = line.split(/\s+/);
      if (addr === 'lladdr') users.push(mac.toUpperCase());
    });
    return users;
  });
}

function getIconFiles() {
  if (Store.iconFiles.length > 0) return Store.iconFiles;

  const iconsDir = '/www/luci-static/resources/icons/device';
  return fs.list(iconsDir).then((files) => {
    const iconFiles = [];
    for (let i = 0; i < files.length; i++) {
      if (i > 50) break;
      if (files[i].name === 'default.png') continue;
      iconFiles.push(L.resource(`icons/device/${files[i].name}`));
    }
    Store.iconFiles = iconFiles.sort();
    return Store.iconFiles;
  });
}

function leaseToSeconds(leasetime) {
  const match = leasetime.toLowerCase().match(/^(\d+)(d|h|m)$/);
  if (match === null) return null;
  const [, num, unit] = match;
  if (num == 0) return 120;
  if (unit === 'd') return num * 86400;
  if (unit === 'h') return num * 3600;
  if (unit === 'm') return (num <= 1 ? 2 : num) * 60;
}

function calcOnlineTime(dhcpLeases) {
  const lanLease = leaseToSeconds(uci.get('dhcp', 'lan', 'leasetime'));
  const hostsLease = {};
  uci.sections('dhcp', 'host').forEach((host) => {
    const mac = host.mac.toUpperCase();
    hostsLease[mac] = leaseToSeconds(host.leasetime) ?? lanLease;
  });

  const onlineTime = {};
  dhcpLeases.forEach((host) => {
    const mac = host.macaddr.toUpperCase();
    if (host.expires > 0) {
      const leasetime = hostsLease[mac] ?? lanLease;
      onlineTime[mac] = leasetime - host.expires;
    }
  });
  return onlineTime;
}

function getSignalIcon(signal) {
  let filename;
  const q = Math.min(((signal + 110) / 70) * 100, 100);
  if (q == 0) filename = 'signal-0.png';
  else if (q < 25) filename = 'signal-0-25.png';
  else if (q < 50) filename = 'signal-25-50.png';
  else if (q < 75) filename = 'signal-50-75.png';
  else filename = 'signal-75-100.png';
  return L.resource(`icons/${filename}`);
}

function getWifiVersion(rx, tx) {
  const { ht: rxHT, vht: rxVHT, he: rxHE } = rx;
  const { ht: txHT, vht: txVHT, he: txHE } = tx;
  if (rxHE || txHE) return 'Wi-Fi 6';
  if (rxVHT || txVHT) return 'Wi-Fi 5';
  if (rxHT || txHT) return 'Wi-Fi 4';
  return '';
}

function formatWiFiFreq(freq) {
  if (!freq) return '';
  if (freq.startsWith('2')) return '2.4G';
  if (freq.startsWith('5')) return '5G';
  return '%.1fG'.format(freq);
}

function formatWiFiRate(rxtx) {
  let { rate, mhz, ht, vht, he, mcs, nss, short_gi, he_gi, he_dcm } = rxtx;
  let s = `${rate / 1000} ${_('Mbit/s')}, ${mhz} ${_('MHz')}`;

  if (ht || vht || he) {
    s += `, MCS: ${mcs}`;
    if (nss) s += `, NSS: ${nss}`;
    if (short_gi) s += ', ' + _('Short GI').replace(/ /g, '\xa0');
    if (he_gi) s += `, HE-GI ${he_gi}`;
    if (he_dcm) s += `, HE-DCM ${he_dcm}`;
  }

  return s;
}

function renderTitle(title, users, collapseID) {
  // remove CSS overflow hidden to use sticky
  // for Material theme
  const htmlStyle = window.getComputedStyle(document.documentElement);
  if (htmlStyle.overflowY === 'hidden') {
    document.documentElement.style.overflow = 'visible';
  }
  // for Argon theme
  ['main', 'main-right'].forEach((className) => {
    const elmt = document.getElementsByClassName(className)[0];
    if (elmt) elmt.style.overflow = 'visible';
  });
  const view = document.getElementById('view');
  if (view) {
    const viewStyle = window.getComputedStyle(view);
    if (viewStyle.overflow === 'hidden') {
      view.style.overflow = 'visible';
    }
  }

  let stickyTop = 1;
  const header = document.getElementsByTagName('header')[0];
  if (header) {
    const position = window.getComputedStyle(header).position;
    if (position === 'sticky') {
      const headerPos = header.getBoundingClientRect();
      stickyTop = headerPos.bottom + 1;
    }
  }

  const css = {
    box: `
      position: sticky; top: ${stickyTop}px;
      display: flex; align-items: center;
      height: 36px; margin-bottom: 5px;
      box-shadow: 0 5px 5px -5px rgba(230, 230, 250, 0.8);
    `,
    title: `font-size: 1.1rem; font-weight: bold; margin-right: 5px;`,
    users: `font-size: 1.1rem; font-weight: bold; color: LimeGreen;`,
    fill: 'flex: 1;',
    button: `
      font-size: 20px;
      margin: 0 2px; padding: 0;
      border: none !important; border-radius: 3px;
      background: transparent;
    `
  };

  const symbol1 = overviewCfg.showAllUsers ? '🌐' : '🛜';
  const toggleUserBtn = E('button', { style: css.button }, symbol1);
  toggleUserBtn.addEventListener('click', () => {
    overviewCfg.showAllUsers = !overviewCfg.showAllUsers;
    toggleUserBtn.innerHTML = overviewCfg.showAllUsers ? '🌐' : '🛜';
    saveOverviewConfig();
    L.ui.showModal(null, E('p', { class: 'spinning' }, _('Loading')));
    window.setTimeout(() => {
      L.ui.hideModal();
    }, 3000);
  });

  const flushBtn = E('button', { style: css.button }, '🔄️');
  flushBtn.addEventListener('click', () => {
    fs.exec('/sbin/ip', ['-4', 'neigh', 'flush', 'dev', 'br-lan']);
    L.ui.showModal(null, E('p', { class: 'spinning' }, _('Loading')));
    window.setTimeout(() => {
      L.ui.hideModal();
    }, 3000);
  });

  const symbol2 = Store.showUsers ? '⏫' : '⏬';
  const collapseBtn = E('button', { style: css.button }, symbol2);
  collapseBtn.addEventListener('click', () => {
    Store.showUsers = !Store.showUsers;
    const section = document.getElementById(collapseID);
    section.style.display = Store.showUsers ? 'grid' : 'none';
    section.style.opacity = Store.showUsers ? 1 : 0;
    collapseBtn.innerHTML = Store.showUsers ? '⏫' : '⏬';
    if (Store.iconsCard.show) {
      Store.iconsCard.show = false;
      toggleIconsCard();
    }
    const usersTitle = document.getElementById('users-title');
    const titlePos = usersTitle.getBoundingClientRect();
    let scrollTop = titlePos.top < 10 ? 1 : titlePos.top - titlePos.height - 5;
    window.scrollTo({ top: scrollTop, left: 0, behavior: 'smooth' });
  });

  return E('div', { id: 'users-title', style: css.box }, [
    E('div', { style: css.title }, title + ':'),
    E('div', { style: css.users }, users),
    E('div', { style: css.fill }, ''),
    toggleUserBtn,
    flushBtn,
    collapseBtn
  ]);
}

function renderIconsCard(iconFiles) {
  const css = {
    card: `
      position: absolute; z-index: 5;
      width: 300px;
      background: transparent;
      will-change: opacity, transform;
      transition: transform 0.3s ease, opacity 0.3s ease;
    `,
    closeBar: `
      display: flex; align-items: center; justify-content: flex-end;
    `,
    closeBtn: `
      font-size: 16px;
      padding: 2px;
      border: none !important; border-radius: 3px;
      background: transparent;
    `,
    iconsGrid: `
      padding: 5px;
      background-color: Lavender;
      border: 1px solid LightGray; border-radius: 7px;
      display: grid; grid-gap: 10px 5px;
      justify-content: space-evenly;
      grid-template-columns: repeat(auto-fill, 45px);
    `,
    iconBtn: `
      width: 45px; height: 45px;
      background-color: WhiteSmoke;
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      border: none !important; border-radius: 5px;
      transition: none !important;
    `
  };

  const buttons = [];
  for (let iconPath of iconFiles) {
    const btn = E('button', { style: css.iconBtn });
    btn.style.backgroundImage = `url(${iconPath})`;
    buttons.push(btn);

    btn.addEventListener('click', () => {
      const mac = Store.thisUser.id;
      if (overviewCfg.users.icon[mac] != iconPath) {
        overviewCfg.users.icon[mac] = iconPath;
        const thisUser = document.getElementById(mac);
        thisUser.style.backgroundImage = `url(${iconPath})`;
      }
      Store.iconsCard.show = false;
      toggleIconsCard();
      saveOverviewConfig();
    });
  }

  const closeBtn = E('button', { style: css.closeBtn }, '❌');
  closeBtn.addEventListener('click', () => {
    Store.iconsCard.show = false;
    toggleIconsCard();
  });

  const card = E('div', { id: 'icons-card', style: css.card }, [
    E('div', { style: css.closeBar }, closeBtn),
    E('div', {}, [E('div', { style: css.iconsGrid }, buttons)])
  ]);
  card.style.transformOrigin = `
    ${Store.iconsCard.oX}px ${Store.iconsCard.oY}px`;
  card.style.transform = `
    scale(${Store.iconsCard.show ? 1 : 0})
    translate(${Store.iconsCard.tX}px, ${Store.iconsCard.tY}px)`;
  return card;
}

function toggleIconsCard() {
  const card = document.getElementById('icons-card');
  const parent = card.parentElement;
  const parentPos = parent.getBoundingClientRect();
  const thisUser = document.getElementById(Store.thisUser.id);
  const thisPos = thisUser.getBoundingClientRect();
  const originX = thisPos.left - parentPos.left;
  const originY = thisPos.top - parentPos.top;
  const offsetX = thisPos.right - parentPos.left + 5;
  const offsetY = thisPos.bottom - parentPos.top - 18;
  Store.iconsCard.oX = originX;
  Store.iconsCard.oY = originY;
  Store.iconsCard.tX = offsetX;
  Store.iconsCard.tY = offsetY;

  card.style.transformOrigin = `
    ${Store.iconsCard.oX}px ${Store.iconsCard.oY}px`;
  card.style.transform = `
    scale(${Store.iconsCard.show ? 1 : 0})
    translate(${Store.iconsCard.tX}px, ${Store.iconsCard.tY}px)`;

  if (Store.iconsCard.show) {
    Store.thisUser.border = '1px solid rgb(82, 168, 236)';
    Store.thisUser.boxShadow = '0 0 5px rgb(82, 168, 236)';
  } else {
    Store.thisUser.border = 0;
    Store.thisUser.boxShadow = 'none';
  }
  thisUser.style.border = Store.thisUser.border;
  thisUser.style.boxShadow = Store.thisUser.boxShadow;

  if (Store.lastUser.id === null) return;
  if (Store.lastUser.id != Store.thisUser.id) {
    const lastUser = document.getElementById(Store.lastUser.id);
    lastUser.style.border = 0;
    lastUser.style.boxShadow = 'none';
  }
}

function renderUserIcon(info) {
  const css = {
    box: `
      display: flex; align-items: center;
      flex-direction: column;
    `,
    iconBtn: `
      width: 64px !important; height: 64px !important;
      border: none !important;
      border-radius: 7px;
      box-shadow: none !important;
      background: transparent;
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      transition: none !important;
    `,
    button: `
      font-size: 20px;
      margin: 0 2px; padding: 0;
      border: none !important; border-radius: 3px;
      background: transparent;
    `
  };

  const mac = info.mac;
  const defIcon = L.resource('icons/device/default.png');
  const iconPath = overviewCfg.users.icon[mac] ?? defIcon;
  const userBtn = E('button', { id: mac, style: css.iconBtn });
  userBtn.style.backgroundImage = `url(${iconPath})`;

  if (Store.iconsCard.show && Store.thisUser.id === userBtn.id) {
    userBtn.style.border = Store.thisUser.border;
    userBtn.style.boxShadow = Store.thisUser.boxShadow;
  }

  userBtn.addEventListener('click', () => {
    Store.lastUser.id = Store.thisUser.id;
    Store.thisUser.id = userBtn.id;
    Store.iconsCard.show =
      Store.thisUser.id != Store.lastUser.id ? true : !Store.iconsCard.show;
    toggleIconsCard();
  });

  const disconnectBtn = E(
    'button',
    {
      class: 'cbi-button cbi-button-remove',
      style: 'font-size: 0.7rem; margin-top: 10px;'
    },
    [_('Disconnect')]
  );

  disconnectBtn.addEventListener('click', async (ev) => {
    ev.currentTarget.classList.add('spinning');
    ev.currentTarget.disabled = true;
    ev.currentTarget.blur();

    try {
      const stat = await Promise.all([
        L.resolveDefault(fs.stat('/usr/sbin/iwpriv'), null),
        L.resolveDefault(fs.stat('/usr/sbin/hostapd'), null)
      ]);
      if (stat[0]) {
        const params = ['ra0', 'set', `DisConnectSta=${mac}`];
        fs.exec('/usr/sbin/iwpriv', params);
      } else if (stat[1]) {
        info.net.disconnectClient(mac, true, 5, 5000);
      }
    } catch (err) {
      ui.addNotification(
        null,
        E('p', {}, _('Unable to disconnectClient: ' + err.message))
      );
      return '';
    }
  });

  return E('div', { style: css.box }, [
    userBtn,
    info.sigStr ? disconnectBtn : ''
  ]);
}

function renderUserName(info) {
  const css = {
    box: `
      display: flex; align-items: center;
    `,
    symbol: `
      min-width: 22px;
      text-align: center;
      font-size: 0.85rem;
    `,
    label: `
      width: 100%;
      margin-left: 3px;
      font-size: 0.9rem;
      font-weight: bold;
    `,
    button1: `
      font-size: 1rem; padding: 0;
      border: none !important; border-radius: 3px;
      background: transparent;
    `,
    button2: `
      font-size: 20px; width: 30px;
      border: none !important; border-radius: 3px;
      background: transparent;
    `,
    fill: 'flex: 1;'
  };

  const mac = info.mac;
  const label = overviewCfg.users.label[mac] ?? info.name;
  const userLabel = E('div', { style: css.label }, label);
  const labelInput = E('input', { class: 'cbi-input-text', value: label });
  const filling = E('div', { style: css.fill }, '');
  const renameBtn = E('button', { style: css.button1 }, '📝');
  const applyBtn = E('button', { style: css.button2 }, '✅');
  const cancelBtn = E('button', { style: css.button2 }, '❎');

  const userName = E('div', { style: css.box }, [
    E('div', { style: css.symbol }, '➡️'),
    userLabel,
    filling,
    renameBtn
  ]);

  const labelRename = E('div', { style: css.box }, [
    E('div', { style: css.symbol }, '📝'),
    labelInput,
    filling,
    applyBtn,
    cancelBtn
  ]);
  labelRename.style.display = Store.showRename[mac] ? 'flex' : 'none';

  renameBtn.addEventListener('click', () => {
    labelRename.style.display = 'flex';
    Store.showRename[mac] = true;
    poll.stop();
  });

  applyBtn.addEventListener('click', () => {
    if (labelInput.value.length == 0) {
      delete overviewCfg.users.label[mac];
      saveOverviewConfig();
    } else if (labelInput.value != label) {
      userLabel.innerHTML = labelInput.value;
      overviewCfg.users.label[mac] = labelInput.value;
      saveOverviewConfig();
    }
    labelRename.style.display = 'none';
    Store.showRename[mac] = false;
    poll.start();
  });

  cancelBtn.addEventListener('click', () => {
    labelRename.style.display = 'none';
    Store.showRename[mac] = false;
    poll.start();
  });

  return E('div', {}, [userName, labelRename]);
}

function renderSymbolInfo(symbol, symbolSize, info, infoSize) {
  const boxHeight = symbol === '🔼' || symbol === '🔽' ? '16px' : '22px';
  const css = {
    box: `
      display: flex; align-items: center;
      height: ${boxHeight};
    `,
    symbol: `
      min-width: 22px;
      text-align: center;
      font-size: ${symbolSize}rem;
    `,
    text: `
      width: 100%;
      margin-left: 3px;
      font-size: ${infoSize}rem;
    `
  };

  return E('div', { style: css.box }, [
    E('div', { style: css.symbol }, symbol),
    E('div', { style: css.text }, info)
  ]);
}

function renderUserBox(info) {
  const css = {
    box: `
      display: flex; align-items: center;
      height: 100%;
      padding: 7px;
      border-radius: 5px;
      box-shadow: inset 0px 0px 3px LightGray;
    `,
    infoBox: 'padding-left: 7px; width: 100%;',
    sigBox: 'display: flex; align-items: center; height: 22px;',
    sigIcon: 'width: 22px; padding: 4px; background-position: center;',
    sigStr: 'font-size: 0.8rem; margin-left: 3px;',
    highlight: `
      padding: 0 3px;
      margin-left: 10px;
      border-radius: 2px;
      box-shadow: 0 0 3px rgb(82, 168, 236);
      font-size: 0.7rem;
      font-weight: bold;
      font-family: "Times New Roman", Times, serif;
    `
  };

  const { sigStr, rx, tx } = info;
  return E('user-box', { style: css.box }, [
    renderUserIcon(info),
    E('info-box', { style: css.infoBox }, [
      renderUserName(info),
      sigStr ? renderSymbolInfo('🛜', 0.85, info.ssid, 0.8) : '',
      sigStr
        ? E('signal-box', { style: css.sigBox }, [
            E('img', { style: css.sigIcon, src: info.sigIcon }),
            E('div', { style: css.sigStr }, sigStr),
            E('div', { style: css.highlight }, info.freq),
            E('div', { style: css.highlight }, info.wifiVer)
          ])
        : '',
      renderSymbolInfo('⏱️', 0.9, info.time, 0.8),
      renderSymbolInfo('🌐', 0.85, info.ipv4, 0.8),
      renderSymbolInfo('🌏', 0.85, info.ipv6, 0.72),
      renderSymbolInfo('Ⓜ️', 0.85, info.mac, 0.72),
      rx ? renderSymbolInfo('🔽', 0.6, rx, 0.65) : '',
      tx ? renderSymbolInfo('🔼', 0.6, tx, 0.65) : ''
    ])
  ]);
}

function renderWiFiUsers(data) {
  const [, hosts, networks] = data;
  const users = [];
  for (let net of networks) {
    const ssid = net.getActiveSSID();
    const freq = formatWiFiFreq(net.getFrequency());
    for (let bss of net.assocList) {
      const { mac, noise, signal, rx, tx } = bss;
      let name = hosts.getHostnameByMACAddr(mac);
      name = name ? name.slice(0, 30) : '?';
      const info = {
        mac,
        ssid,
        freq,
        name,
        sigIcon: getSignalIcon(signal),
        sigStr: noise ? `${signal}/${noise}dBm` : `${signal}dBm`,
        rx: formatWiFiRate(rx),
        tx: formatWiFiRate(tx),
        time: '%t'.format(bss.connected_time),
        ipv4: hosts.getIPAddrByMACAddr(mac),
        ipv6: hosts.getIP6AddrByMACAddr(mac) || '-',
        wifiVer: getWifiVersion(rx, tx),
        net
      };
      users.push({ name, box: renderUserBox(info) });
    }
  }

  users.sort((a, b) => a.name.localeCompare(b.name));
  return Array.from(users, (elmt) => elmt.box);
}

function renderOtherUsers(data) {
  const [, hosts, networks, onlineUsers, leases] = data;
  if (onlineUsers.length === 0) return [];

  const wifiUsers = new Map();
  for (let net of networks) {
    for (let bss of net.assocList) {
      wifiUsers.set(bss.mac, true);
    }
  }

  const users = [];
  const time = calcOnlineTime(leases.dhcp_leases);
  for (let mac of onlineUsers) {
    if (wifiUsers.has(mac)) continue;
    let name = hosts.getHostnameByMACAddr(mac);
    name = name ? name.slice(0, 30) : '?';
    const info = {
      mac,
      name,
      time: time[mac] > 0 ? '%t'.format(time[mac]) : '-',
      ipv4: hosts.getIPAddrByMACAddr(mac),
      ipv6: hosts.getIP6AddrByMACAddr(mac) || '-'
    };
    users.push({ name, box: renderUserBox(info) });
  }

  users.sort((a, b) => a.name.localeCompare(b.name));
  return Array.from(users, (elmt) => elmt.box);
}

return baseclass.extend({
  title: '',

  load: function () {
    L.resolveDefault(uci.load('dhcp'));
    return Promise.all([
      readOverviewConfig(),
      network.getHostHints(),
      getWifiNetworks(),
      getOnlineUsers(),
      callLuciDHCPLeases(),
      getIconFiles()
    ]);
  },

  render: function (data) {
    const cfg = data[0];
    if (!('users' in cfg)) cfg.users = { icon: {} };
    if (!('icon' in cfg.users)) cfg.users.icon = {};
    if (!('label' in cfg.users)) cfg.users.label = {};
    Object.assign(overviewCfg, cfg);
    const otherUsers = overviewCfg.showAllUsers ? renderOtherUsers(data) : [];
    const users = renderWiFiUsers(data).concat(otherUsers);

    const css = {
      box: 'position: relative',
      grid: `
        display: ${Store.showUsers ? 'grid' : 'none'};
        grid-gap: 7px 7px;
        grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
        transition: opacity 0.3s ease, display 0.3s ease allow-discrete;
        margin-bottom: 1rem;
      `
    };

    return E('div', { style: css.box }, [
      renderIconsCard(data[5]),
      renderTitle(_('Online Users'), users.length, 'online-users'),
      E('div', { id: 'online-users', style: css.grid }, users)
    ]);
  }
});
