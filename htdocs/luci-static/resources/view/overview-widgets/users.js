'require view';
'require uci';
'require network';
'require fs';
'require rpc';

return view.extend({
  title: _('在线用户管理'),
  
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
      container: `
        padding: 15px;
        background-color: #f9fafb;
        min-height: calc(100vh - 60px);
      `,
      header: `
        margin-bottom: 20px;
        padding-bottom: 15px;
        border-bottom: 1px solid #e5e7eb;
      `,
      title: `
        font-size: 1.5rem;
        font-weight: 600;
        color: #1e293b;
        margin: 0 0 10px 0;
      `,
      subtitle: `
        font-size: 0.9rem;
        color: #64748b;
        margin: 0;
      `,
      grid: `
        display: ${Store.showUsers ? 'grid' : 'none'};
        grid-gap: 15px;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        transition: all 0.3s ease;
        opacity: ${Store.showUsers ? '1' : '0'};
        height: ${Store.showUsers ? 'auto' : '0'};
        overflow: hidden;
      `,
      statsBar: `
        display: flex;
        gap: 10px;
        margin: 0 0 20px 0;
        flex-wrap: wrap;
      `,
      statCard: `
        flex: 1;
        min-width: 180px;
        background: white;
        border-radius: 8px;
        padding: 15px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        border-left: 3px solid #3b82f6;
      `,
      statValue: `
        font-size: 1.8rem;
        font-weight: 700;
        color: #1e293b;
        margin: 0 0 5px 0;
      `,
      statLabel: `
        font-size: 0.85rem;
        color: #64748b;
        margin: 0;
      `
    };

    const totalUsers = users.length;
    const wifiUsers = overviewCfg.showAllUsers ? users.filter(u => u.wifi).length : totalUsers;
    const wiredUsers = totalUsers - wifiUsers;

    return E('div', { style: css.container }, [
      E('div', { style: css.header }, [
        E('h1', { style: css.title }, _('在线用户管理')),
        E('p', { style: css.subtitle }, _('查看和管理当前连接到网络的所有设备'))
      ]),
      
      E('div', { style: css.statsBar }, [
        E('div', { style: css.statCard }, [
          E('p', { style: css.statValue }, totalUsers),
          E('p', { style: css.statLabel }, _('总在线设备'))
        ]),
        E('div', { style: css.statCard + ' border-left-color: #10b981;' }, [
          E('p', { style: css.statValue }, wifiUsers),
          E('p', { style: css.statLabel }, _('无线设备'))
        ]),
        E('div', { style: css.statCard + ' border-left-color: #f59e0b;' }, [
          E('p', { style: css.statValue }, wiredUsers),
          E('p', { style: css.statLabel }, _('有线设备'))
        ])
      ]),
      
      renderTitle(_('在线设备列表'), users.length, 'online-users'),
      E('div', { id: 'online-users', style: css.grid }, users),
      renderManagerButton()
    ]);
  }
});

function renderUserBox(user) {
  const css = {
    box: `
      background: white;
      border-radius: 10px;
      padding: 15px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.07);
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      position: relative;
    `,
    boxHover: `
      box-shadow: 0 5px 15px rgba(0,0,0,0.1);
      transform: translateY(-2px);
    `,
    iconContainer: `
      width: 50px;
      height: 50px;
      border-radius: 12px;
      background-color: #eff6ff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    `,
    icon: `
      font-size: 24px;
      color: #3b82f6;
    `,
    infoBox: `
      margin-left: 15px;
      flex-grow: 1;
    `,
    name: `
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 3px 0;
      display: flex;
      align-items: center;
      gap: 5px;
    `,
    details: `
      font-size: 0.85rem;
      color: #64748b;
      margin: 3px 0;
    `,
    tag: `
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
      margin-left: 5px;
    `,
    actions: `
      display: flex;
      gap: 8px;
    `,
    actionBtn: `
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: none;
      background-color: #f1f5f9;
      color: #64748b;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    `,
    actionBtnHover: `
      background-color: #e2e8f0;
      color: #3b82f6;
    `
  };

  let deviceIcon = 'fa-desktop';
  if (user.hostname && user.hostname.toLowerCase().includes('phone')) {
    deviceIcon = 'fa-mobile-alt';
  } else if (user.hostname && user.hostname.toLowerCase().includes('tablet')) {
    deviceIcon = 'fa-tablet-alt';
  } else if (user.hostname && user.hostname.toLowerCase().includes('laptop')) {
    deviceIcon = 'fa-laptop';
  } else if (user.hostname && user.hostname.toLowerCase().includes('tv')) {
    deviceIcon = 'fa-tv';
  } else if (user.hostname && user.hostname.toLowerCase().includes('printer')) {
    deviceIcon = 'fa-print';
  } else if (user.wifi) {
    deviceIcon = 'fa-wifi';
  } else {
    deviceIcon = 'fa-ethernet';
  }

  let connTypeLabel = E('span');
  if (user.wifi) {
    const band = user.band === '5G' ? '5 GHz' : '2.4 GHz';
    connTypeLabel = E('span', { style: css.tag + ' background-color: #dcfce7; color: #166534;' }, band);
  } else {
    connTypeLabel = E('span', { style: css.tag + ' background-color: #fef3c7; color: #92400e;' }, _('有线'));
  }

  let signalDisplay = '';
  if (user.signal) {
    signalDisplay = E('span', { style: 'margin-left: 8px;' }, [
      E('i', { class: `fa ${user.signal > -50 ? 'fa-signal' : user.signal > -70 ? 'fa-wifi' : 'fa-wifi-slash'}` }),
      E('span', {}, ` ${Math.abs(user.signal)} dBm`)
    ]);
  }

  const userBox = E('div', { style: css.box }, [
    E('div', { style: css.iconContainer }, [
      E('i', { class: 'fa ' + deviceIcon, style: css.icon })
    ]),
    E('div', { style: css.infoBox }, [
      E('div', { style: css.name }, [
        user.hostname || user.ipaddr,
        connTypeLabel
      ]),
      E('div', { style: css.details }, [
        E('i', { class: 'fa fa-globe', style: 'margin-right: 5px;' }),
        user.ipaddr
      ]),
      E('div', { style: css.details }, [
        user.macaddr,
        signalDisplay
      ]),
      E('div', { style: css.details }, [
        E('i', { class: 'fa fa-clock', style: 'margin-right: 5px;' }),
        _('在线时间: ') + formatUptime(user.uptime)
      ])
    ]),
    E('div', { style: css.actions }, [
      E('button', { 
        style: css.actionBtn,
        title: _('刷新信息')
      }, E('i', { class: 'fa fa-sync' })),
      E('button', { 
        style: css.actionBtn,
        title: _('断开连接')
      }, E('i', { class: 'fa fa-wifi-slash' }))
    ])
  ]);

  userBox.addEventListener('mouseenter', () => {
    Object.assign(userBox.style, {
      boxShadow: css.boxHover.boxShadow,
      transform: css.boxHover.transform
    });
  });
  
  userBox.addEventListener('mouseleave', () => {
    Object.assign(userBox.style, {
      boxShadow: css.box.boxShadow,
      transform: 'translateY(0)'
    });
  });

  const buttons = userBox.querySelectorAll('button');
  buttons.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.backgroundColor = css.actionBtnHover.backgroundColor;
      btn.style.color = css.actionBtnHover.color;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.backgroundColor = css.actionBtn.backgroundColor;
      btn.style.color = css.actionBtn.color;
    });
  });

  return userBox;
}

function renderTitle(title, count, id) {
  const stickyTop = 10;
  const css = {
    box: `
      position: sticky; 
      top: ${stickyTop}px;
      display: flex; 
      align-items: center;
      padding: 12px 15px;
      margin: 0 0 15px 0;
      border-radius: 8px;
      background-color: white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      z-index: 10;
    `,
    title: `
      font-size: 1.1rem; 
      font-weight: 600; 
      margin: 0;
      color: #1e293b;
      display: flex;
      align-items: center;
      gap: 8px;
    `,
    countBadge: `
      background-color: #3b82f6;
      color: white;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.85rem;
      font-weight: 600;
    `,
    fill: 'flex: 1;',
    button: `
      width: 36px;
      height: 36px;
      margin: 0 3px;
      padding: 0;
      border: none;
      border-radius: 6px;
      background: #f1f5f9;
      color: #64748b;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    `,
    buttonHover: `
      background-color: #e2e8f0;
      color: #3b82f6;
    `
  };

  const toggleUserBtn = E('button', {
    style: css.button,
    title: Store.showUsers ? _('收起列表') : _('展开列表')
  }, E('i', { class: Store.showUsers ? 'fa fa-chevron-up' : 'fa fa-chevron-down' }));

  const flushBtn = E('button', {
    style: css.button,
    title: _('刷新列表')
  }, E('i', { class: 'fa fa-sync' }));

  const filterBtn = E('button', {
    style: css.button,
    title: _('筛选设备')
  }, E('i', { class: 'fa fa-filter' }));

  toggleUserBtn.addEventListener('click', () => {
    Store.showUsers = !Store.showUsers;
    const userGrid = document.getElementById(id);
    
    if (Store.showUsers) {
      userGrid.style.display = 'grid';
      setTimeout(() => {
        userGrid.style.opacity = '1';
        userGrid.style.height = 'auto';
      }, 10);
      toggleUserBtn.innerHTML = E('i', { class: 'fa fa-chevron-up' }).outerHTML;
      toggleUserBtn.title = _('收起列表');
    } else {
      userGrid.style.opacity = '0';
      userGrid.style.height = userGrid.offsetHeight + 'px';
      setTimeout(() => {
        userGrid.style.display = 'none';
        userGrid.style.height = '0';
      }, 300);
      toggleUserBtn.innerHTML = E('i', { class: 'fa fa-chevron-down' }).outerHTML;
      toggleUserBtn.title = _('展开列表');
    }
  });

  flushBtn.addEventListener('click', () => {
    flushBtn.querySelector('i').style.transition = 'transform 0.5s ease';
    flushBtn.querySelector('i').style.transform = 'rotate(360deg)';
    setTimeout(() => location.reload(), 500);
  });

  [toggleUserBtn, flushBtn, filterBtn].forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.backgroundColor = css.buttonHover.backgroundColor;
      btn.style.color = css.buttonHover.color;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.backgroundColor = css.button.backgroundColor;
      btn.style.color = css.button.color;
    });
  });

  return E('div', { style: css.box }, [
    E('h2', { style: css.title }, [
      title,
      E('span', { style: css.countBadge }, count)
    ]),
    E('div', { style: css.fill }),
    filterBtn,
    flushBtn,
    toggleUserBtn
  ]);
}

function formatUptime(seconds) {
  if (!seconds) return '未知';
  
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  let parts = [];
  if (days > 0) parts.push(days + 'd');
  if (hours > 0) parts.push(hours + 'h');
  if (minutes > 0) parts.push(minutes + 'm');
  
  return parts.join(' ');
}

function readOverviewConfig() {
  return fs.read('/etc/overview.json', 'utf8')
    .then(json => JSON.parse(json))
    .catch(() => ({}));
}

function getWifiNetworks() {
  return rpc.declare('network', 'get_wifi_networks', []);
}

function getOnlineUsers() {
  return rpc.declare('luci', 'getOnlineUsers', []);
}

function callLuciDHCPLeases() {
  return rpc.declare('luci', 'getDHCPLeases', []);
}

function getIconFiles() {
  return fs.list('/www/luci-static/resources/icons/')
    .then(files => files.filter(f => f.endsWith('.svg') || f.endsWith('.png')))
    .catch(() => []);
}

function renderWiFiUsers(data) {
  return [];
}

function renderOtherUsers(data) {
  return [];
}

function renderManagerButton() {
  const css = {
    button: `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background-color: #3b82f6;
      color: white;
      border: none;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      z-index: 100;
    `,
    buttonHover: `
      transform: scale(1.05);
      box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
    `
  };

  const btn = E('button', { style: css.button }, E('i', { class: 'fa fa-cog' }));
  
  btn.addEventListener('mouseenter', () => {
    btn.style.transform = css.buttonHover.transform;
    btn.style.boxShadow = css.buttonHover.boxShadow;
  });
  
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = 'scale(1)';
    btn.style.boxShadow = css.button.boxShadow;
  });
  
  return btn;
}

const Store = {
  showUsers: true
};

const overviewCfg = {};
