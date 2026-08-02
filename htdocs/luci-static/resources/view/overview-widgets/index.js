'use strict';
'require view';
'require rpc';
'require poll';
'require dom';

var callGetUserlist = rpc.declare({
	object: 'luci.overview',
	method: 'getOnlineUserlist',
	expect: { userlist: [] }
});

var callDisconnect = rpc.declare({
	object: 'luci.overview',
	method: 'disconnectClient',
	expect: { result: false }
});

var callRename = rpc.declare({
	object: 'luci.overview',
	method: 'renameDevice',
	expect: { result: false }
});

var callSetIcon = rpc.declare({
	object: 'luci.overview',
	method: 'setIcon',
	expect: { result: false }
});

var callFlushArp = rpc.declare({
	object: 'luci.overview',
	method: 'flushArp',
	expect: { result: false }
});

var REFRESH_INTERVAL = 30;
var WEAK_THRESHOLD = -75;

var overviewCfg = { showAllUsers: true, users: { icon: {}, label: {} } };
var allUsers = [];
var iconList = ['📱','💻','📺','📟','🖥️','🗄️','🖨️','🎮','⌚','📷','🔊','🌡️','🚨','🔌','💡','🚗','🛸','🐱','🐶','🦊','🐼','🐨','🦁','🐯','🐸','🐵','🦄','🐲','🎅','👻','🤖','👽','💀','🎃','🧠','👁️','🦾','🦿','🦵','🦶','🫀','🫁','🧬','🦠','💩','🔥','⚡','☀️','🌙','🌈'];

var showUsers = true, selectedMac = null, lastSelectedMac = null;
var searchQuery = '', sortBy = 'default', sortDir = 1;
var weakSignalDismissed = false, currentDetailMac = null;
var timer = null, countdown = REFRESH_INTERVAL, pageVisible = true;

function getSignalBars(dbm) {
	if (dbm == null) return [];
	var active = 0;
	if (dbm > -50) active = 4;
	else if (dbm > -60) active = 3;
	else if (dbm > -70) active = 2;
	else if (dbm > -80) active = 1;
	var cls = active <= 1 ? 'off' : active <= 2 ? 'warn' : 'on';
	return [4,3,2,1].map(function(i) {
		return E('div', { class: 'bar ' + (i <= active ? cls : 'off'), style: 'height:' + (i*3+3) + 'px' });
	});
}

function getSignalClass(dbm) {
	if (dbm == null) return '';
	return dbm > -60 ? 'good' : dbm > -75 ? 'medium' : 'bad';
}

function getDeviceIcon(u) {
	if (overviewCfg.users.icon[u.macaddr]) return overviewCfg.users.icon[u.macaddr];
	if (u._icon) return u._icon;
	var n = (u.hostname || '').toLowerCase();
	if (n.includes('phone') || n.includes('iphone')) return '📱';
	if (n.includes('mac') || n.includes('book')) return '💻';
	if (n.includes('tv')) return '📺';
	if (n.includes('tablet')) return '📟';
	if (n.includes('pc') || n.includes('desktop')) return '🖥️';
	if (n.includes('nas')) return '🗄️';
	if (n.includes('printer')) return '🖨️';
	if (n.includes('game')) return '🎮';
	return '🖥️';
}

function formatExpiry(expires) {
	if (expires === undefined || expires === null || expires === '-' || typeof expires !== 'number' || expires <= 0) return '—';
	var h = Math.floor(expires / 3600);
	var m = Math.floor((expires % 3600) / 60);
	if (h > 0) return h + 'h ' + m + 'm';
	return m + 'm';
}

function renderUserDOM(u) {
	var mac = u.macaddr;
	var customLabel = overviewCfg.users.label[mac] || u.hostname || '?';
	var icon = getDeviceIcon(u);
	var tagClass = u.is_wifi ? 'tag-wifi' : 'tag-wired';
	var tagText = u.is_wifi ? (u.freq || 'WiFi') : '有线';
	var weakTag = (u.signal != null && parseFloat(u.signal) < WEAK_THRESHOLD)
		? E('span', { class: 'tag tag-weak' }, '⚠ ' + _('弱信号')) : null;
	var sigCls = getSignalClass(u.signal);

	var signalHTML = u.signal != null ? E('div', { class: 'user-detail' }, [
		E('span', { class: 'label' }, _('信号')),
		E('div', { class: 'signal-bar' }, getSignalBars(u.signal)),
		E('span', { class: 'signal-str ' + sigCls }, u.signal + ' dBm')
	]) : null;

	var speedHTML = u.rx ? E('div', { class: 'user-detail' }, [
		E('span', { class: 'label' }, _('速率')),
		E('span', { class: 'speed down' }, '↓ ' + u.rx),
		E('span', { class: 'speed up' }, '↑ ' + u.tx)
	]) : null;

	var expired = formatExpiry(u.expires);

	return E('div', {
		class: 'user-card',
		id: mac,
		'data-mac': mac,
		click: function(ev) {
			if (!ev.target.closest('button') && !ev.target.closest('.user-icon') && !ev.target.closest('.name-input'))
				openDetailModal(mac);
		}
	}, [
		E('div', {
			class: 'user-icon',
			click: function(ev) { ev.stopPropagation(); openIconsCard(ev, mac); },
			title: _('更换图标')
		}, icon),
		E('div', { class: 'user-info' }, [
			E('div', { class: 'user-name-row' }, [
				E('div', { class: 'user-name' }, [
					E('span', { class: 'name-display' }, customLabel),
					E('input', {
						class: 'name-input',
						value: customLabel,
						style: 'display:none',
						keydown: function(ev) { if (ev.key === 'Enter') applyRename(mac); }
					}),
					E('button', {
						class: 'rename-btn',
						click: function(ev) { ev.stopPropagation(); startRename(mac); },
						title: _('重命名')
					}, '✏️'),
					E('button', {
						class: 'apply-btn',
						style: 'display:none',
						click: function(ev) { ev.stopPropagation(); applyRename(mac); },
						title: _('保存')
					}, '✓'),
					E('button', {
						class: 'cancel-btn',
						style: 'display:none',
						click: function(ev) { ev.stopPropagation(); cancelRename(mac); },
						title: _('取消')
					}, '✕'),
					E('span', { class: 'tag ' + tagClass }, tagText),
					weakTag
				])
			]),
			E('div', { class: 'user-detail' }, [
				E('span', { class: 'label' }, 'IP'),
				E('span', { class: 'mono' }, u.ipaddr || '-')
			]),
			E('div', { class: 'user-detail' }, [
				E('span', { class: 'label' }, 'MAC'),
				E('span', { class: 'mono' }, mac)
			]),
			u.ssid ? E('div', { class: 'user-detail' }, [
				E('span', { class: 'label' }, 'SSID'),
				u.ssid
			]) : null,
			signalHTML,
			speedHTML,
			E('div', { class: 'user-detail' }, [
				E('span', { class: 'label' }, _('在线时长')),
				expired
			])
		]),
		E('div', { class: 'user-actions' }, [
			E('button', {
				title: _('断开连接'),
				class: 'danger',
				click: function(ev) { ev.stopPropagation(); disconnectClient(mac, u.hostname); }
			}, '⏻')
		])
	]);
}

function renderUsers(data) {
	allUsers = data || allUsers;

	var grid = document.getElementById('users-grid');
	if (!grid) return;
	grid.innerHTML = '';

	var visible = overviewCfg.showAllUsers ? allUsers : allUsers.filter(function(u) { return u.is_wifi; });
	if (searchQuery) {
		visible = visible.filter(function(u) {
			var label = (overviewCfg.users.label[u.macaddr] || u.hostname || '').toLowerCase();
			return label.includes(searchQuery) ||
				(u.ipaddr || '').toLowerCase().includes(searchQuery) ||
				u.macaddr.toLowerCase().includes(searchQuery);
		});
	}

	var online = visible.filter(function(u) {
		return u.ipaddr && u.ipaddr.indexOf('[FAILED]') < 0;
	});

	var sortFn = function(a, b) {
		if (sortBy === 'name') {
			var la = (overviewCfg.users.label[a.macaddr] || a.hostname || '').toLowerCase();
			var lb = (overviewCfg.users.label[b.macaddr] || b.hostname || '').toLowerCase();
			return la.localeCompare(lb) * sortDir;
		}
		if (sortBy === 'signal') return ((a.signal || -999) - (b.signal || -999)) * sortDir;
		return 0;
	};
	online.sort(sortFn);

	if (online.length === 0) {
		grid.appendChild(E('div', { class: 'no-result' }, [
			E('div', { class: 'icon' }, '🔍'),
			E('div', {}, _('没有找到匹配的设备'))
		]));
		updateStats(allUsers);
		return;
	}

	var wifi5 = online.filter(function(u) { return u.is_wifi && u.freq === '5GHz'; });
	var wifi24 = online.filter(function(u) { return u.is_wifi && u.freq === '2.4GHz'; });
	var wired = overviewCfg.showAllUsers ? online.filter(function(u) { return !u.is_wifi; }) : [];

	function group(title, cls, users) {
		var section = E('div', { class: 'device-group' }, [
			E('div', { class: 'device-group-title' }, [
				E('span', { class: 'group-dot ' + cls }),
				title,
				E('span', { class: 'group-count' }, String(users.length))
			]),
			E('div', { class: 'users-grid' })
		]);
		var container = section.querySelectorAll('.users-grid')[0] || section.querySelector('.users-grid');
		users.forEach(function(u) { container.appendChild(renderUserDOM(u)); });
		return section;
	}

	if (wifi5.length) grid.appendChild(group(E('span', { class: 'group-dot wifi5' }), 'wifi5', wifi5));
	if (wifi24.length) grid.appendChild(group(E('span', { class: 'group-dot wifi24' }), 'wifi24', wifi24));
	if (overviewCfg.showAllUsers && wired.length)
		grid.appendChild(group(_('有线设备') + ' <span class="group-count">' + wired.length + '</span>', 'wired', wired));

	updateStats(allUsers);
	updateWeakSignalBanner(online);
}

function updateStats(users) {
	var base = overviewCfg.showAllUsers ? users : users.filter(function(u) { return u.is_wifi; });
	var online = base.filter(function(u) { return u.ipaddr && u.ipaddr.indexOf('[FAILED]') < 0; });
	var total = online.length;
	var wifi = online.filter(function(u) { return u.is_wifi; }).length;
	var wired = overviewCfg.showAllUsers ? online.filter(function(u) { return !u.is_wifi; }).length : 0;
	var et = document.getElementById('stat-total');
	var ew = document.getElementById('stat-wifi');
	var eW = document.getElementById('stat-wired');
	var cb = document.getElementById('count-badge');
	if (et) et.textContent = total;
	if (ew) ew.textContent = wifi;
	if (eW) eW.textContent = wired;
	if (cb) cb.textContent = total;
}

function updateWeakSignalBanner(users) {
	var weak = users.filter(function(u) { return u.signal != null && parseFloat(u.signal) < WEAK_THRESHOLD; });
	if (weak.length === 0 || weakSignalDismissed) {
		var banner = document.getElementById('weak-signal-banner');
		if (banner) banner.style.display = 'none';
		return;
	}
	var listEl = document.getElementById('weak-signal-list');
	if (listEl) {
		listEl.innerHTML = weak.map(function(u) {
			var label = overviewCfg.users.label[u.macaddr] || u.hostname;
			return '<span class="device-chip" onclick="openDetailModal(\'' + u.macaddr + '\')">' + label + ' · ' + u.signal + 'dBm</span>';
		}).join('');
	}
	var banner = document.getElementById('weak-signal-banner');
	if (banner) banner.classList.add('show');
}

function onSearch() {
	searchQuery = document.getElementById('search-input').value.trim().toLowerCase();
	renderUsers(allUsers);
}

function setSort(key) {
	if (sortBy === key) sortDir *= -1;
	else { sortBy = key; sortDir = key === 'signal' ? -1 : 1; }
	document.querySelectorAll('.sort-btn').forEach(function(btn) {
		btn.classList.remove('active');
		if (btn.dataset.sort === key) {
			btn.classList.add('active');
			var a = btn.querySelector('.dir-arrow');
			if (a) a.textContent = sortDir === 1 ? '↑' : '↓';
		}
	});
	renderUsers(allUsers);
}

function toggleAllUsers() {
	overviewCfg.showAllUsers = !overviewCfg.showAllUsers;
	var btn = document.getElementById('btn-toggle-all');
	if (btn) {
		btn.textContent = overviewCfg.showAllUsers ? '🌐' : '🛜';
		btn.title = overviewCfg.showAllUsers ? _('显示全部设备') : _('仅显示WiFi设备');
	}
	renderUsers(allUsers);
}

async function flushARP() {
	showToast(_('正在刷新 ARP 缓存...'));
	var btn = document.getElementById('btn-flush');
	if (btn) btn.classList.add('spinning');
	try { await callFlushArp(); } catch(e) {}
	setTimeout(function() {
		if (btn) btn.classList.remove('spinning');
		showToast(_('ARP 缓存已刷新'));
	}, 1500);
}

function toggleUsers() {
	showUsers = !showUsers;
	var grid = document.getElementById('users-grid');
	var btn = document.getElementById('btn-collapse');
	if (showUsers) {
		if (grid) grid.classList.remove('collapsed');
		if (btn) { btn.innerHTML = '⏫'; btn.title = _('收起列表'); }
	} else {
		if (grid) grid.classList.add('collapsed');
		if (btn) { btn.innerHTML = '⏬'; btn.title = _('展开列表'); }
	}
}

function startRename(mac) {
	var card = document.getElementById(mac);
	if (!card) return;
	var disp = card.querySelector('.name-display');
	var inp = card.querySelector('.name-input');
	var applyBtn = card.querySelector('.apply-btn');
	var cancelBtn = card.querySelector('.cancel-btn');
	var renameBtn = card.querySelector('.rename-btn');
	if (disp) disp.style.display = 'none';
	if (inp) { inp.style.display = 'inline-block'; inp.focus(); }
	if (renameBtn) renameBtn.style.display = 'none';
	if (applyBtn) applyBtn.style.display = 'inline';
	if (cancelBtn) cancelBtn.style.display = 'inline';
}

async function applyRename(mac) {
	var card = document.getElementById(mac);
	if (!card) return;
	var inp = card.querySelector('.name-input');
	var disp = card.querySelector('.name-display');
	var val = inp ? inp.value.trim() : '';
	if (val) {
		overviewCfg.users.label[mac] = val;
		if (disp) disp.textContent = val;
		try { await callRename({ mac: mac, label: val }); } catch(e) {}
	} else {
		delete overviewCfg.users.label[mac];
		var u = allUsers.find(function(x) { return x.macaddr === mac; });
		if (disp) disp.textContent = u ? u.hostname : mac;
	}
	if (inp) inp.style.display = 'none';
	if (disp) disp.style.display = '';
	var applyBtn = card.querySelector('.apply-btn');
	var cancelBtn = card.querySelector('.cancel-btn');
	var renameBtn = card.querySelector('.rename-btn');
	if (applyBtn) applyBtn.style.display = 'none';
	if (cancelBtn) cancelBtn.style.display = 'none';
	if (renameBtn) renameBtn.style.display = '';
}

function cancelRename(mac) {
	var card = document.getElementById(mac);
	if (!card) return;
	var inp = card.querySelector('.name-input');
	var disp = card.querySelector('.name-display');
	var u = allUsers.find(function(x) { return x.macaddr === mac; });
	var defVal = overviewCfg.users.label[mac] || (u ? u.hostname : mac);
	if (inp) inp.value = defVal;
	if (inp) inp.style.display = 'none';
	if (disp) disp.style.display = '';
	var applyBtn = card.querySelector('.apply-btn');
	var cancelBtn = card.querySelector('.cancel-btn');
	var renameBtn = card.querySelector('.rename-btn');
	if (applyBtn) applyBtn.style.display = 'none';
	if (cancelBtn) cancelBtn.style.display = 'none';
	if (renameBtn) renameBtn.style.display = '';
}

function openIconsCard(event, mac) {
	event.stopPropagation();
	lastSelectedMac = selectedMac;
	selectedMac = mac;
	var card = document.getElementById(mac);
	if (!card) return;
	var iconBtn = card.querySelector('.user-icon');
	var gridEl = document.getElementById('icons-grid');
	if (gridEl) {
		gridEl.innerHTML = iconList.map(function(ic) {
			return '<button onclick="selectIcon(\'' + mac + '\', \'' + ic + '\')">' + ic + '</button>';
		}).join('');
	}
	var iconsCard = document.getElementById('icons-card');
	if (iconsCard && iconBtn) {
		var rect = iconBtn.getBoundingClientRect();
		iconsCard.style.left = (rect.right + 10) + 'px';
		iconsCard.style.top = Math.max(10, rect.top - 80) + 'px';
		iconsCard.style.display = 'block';
		requestAnimationFrame(function() {
			iconsCard.style.opacity = '1';
			iconsCard.style.transform = 'scale(1)';
		});
		iconBtn.classList.add('selected');
	}
}

function closeIconsCard() {
	var iconsCard = document.getElementById('icons-card');
	if (iconsCard) {
		iconsCard.style.opacity = '0';
		iconsCard.style.transform = 'scale(0.8)';
		setTimeout(function() { if (iconsCard) iconsCard.style.display = 'none'; }, 250);
	}
	if (lastSelectedMac) {
		var c = document.getElementById(lastSelectedMac);
		if (c) { var ib = c.querySelector('.user-icon'); if (ib) ib.classList.remove('selected'); }
	}
	selectedMac = null;
	lastSelectedMac = null;
}

async function selectIcon(mac, icon) {
	overviewCfg.users.icon[mac] = icon;
	var card = document.getElementById(mac);
	if (card) { var ib = card.querySelector('.user-icon'); if (ib) ib.textContent = icon; }
	try { await callSetIcon({ mac: mac, icon: icon }); } catch(e) {}
	closeIconsCard();
}

document.addEventListener('click', function(e) {
	if (selectedMac && !document.getElementById('icons-card').contains(e.target) && !e.target.classList.contains('user-icon'))
		closeIconsCard();
});

async function disconnectClient(mac, hostname) {
	if (!confirm(_('确定要断开') + ' ' + hostname + ' (' + mac + ')')) return;
	showToast(_('正在断开') + ' ' + hostname + '...');
	try {
		var result = await callDisconnect({ mac: mac });
		if (!result.result) { showToast(_('断开失败')); return; }
	} catch(e) {}
	var idx = allUsers.findIndex(function(u) { return u.macaddr === mac; });
	if (idx >= 0) { allUsers.splice(idx, 1); renderUsers(allUsers); }
	showToast(_('已断开') + ' ' + hostname);
}

function openDetailModal(mac) {
	var u = allUsers.find(function(x) { return x.macaddr === mac; });
	if (!u) return;
	currentDetailMac = mac;
	var label = overviewCfg.users.label[mac] || u.hostname;
	var set = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
	set('detail-icon', getDeviceIcon(u));
	set('detail-name', label);
	set('detail-subtitle', (u.ipaddr || '-') + '  ·  ' + mac);
	set('detail-ip', u.ipaddr || '—');
	set('detail-mac', mac);
	set('detail-hostname', u.hostname || '—');
	set('detail-time', formatExpiry(u.expires));

	if (u.is_wifi && u.signal != null) {
		['signal-row','freq-row','rx-row','tx-row','ssid-row'].forEach(function(id) {
			var el = document.getElementById('detail-' + id);
			if (el) el.style.display = 'flex';
		});
		var sigEl = document.getElementById('detail-signal');
		if (sigEl) {
			sigEl.textContent = u.signal + ' dBm';
			sigEl.style.color = parseFloat(u.signal) < -75 ? '#dc2626' : parseFloat(u.signal) < -60 ? '#d97706' : '#059669';
		}
		set('detail-rx', u.rx || '—');
		set('detail-tx', u.tx || '—');
		set('detail-ssid', u.ssid || '—');
		set('detail-interface', 'br-lan');
	} else {
		['signal-row','freq-row','rx-row','tx-row','ssid-row'].forEach(function(id) {
			var el = document.getElementById('detail-' + id);
			if (el) el.style.display = 'none';
		});
		var ifaceEl = document.getElementById('detail-interface-row');
		if (ifaceEl) ifaceEl.style.display = 'flex';
		set('detail-interface', 'br-lan (eth0)');
	}
	var modal = document.getElementById('detail-modal');
	if (modal) modal.classList.add('show');
}

function closeDetailModal(event) {
	if (event && event.target !== event.currentTarget) return;
	var modal = document.getElementById('detail-modal');
	if (modal) modal.classList.remove('show');
	currentDetailMac = null;
}

function disconnectFromDetail() {
	if (!currentDetailMac) return;
	var u = allUsers.find(function(x) { return x.macaddr === currentDetailMac; });
	disconnectClient(currentDetailMac, u ? (u.hostname || currentDetailMac) : currentDetailMac);
	closeDetailModal();
}

function showToast(msg) {
	var t = document.getElementById('toast');
	if (t) { t.textContent = msg; t.classList.add('show'); }
	setTimeout(function() {
		var t = document.getElementById('toast');
		if (t) t.classList.remove('show');
	}, 2000);
}

function startAutoRefresh() {
	stopAutoRefresh();
	countdown = REFRESH_INTERVAL;
	var indicator = document.getElementById('auto-refresh-indicator');
	if (indicator) indicator.classList.add('show');
	var cntEl = document.getElementById('countdown-val');
	if (cntEl) cntEl.textContent = countdown;
	timer = setInterval(function() {
		countdown--;
		var el = document.getElementById('countdown-val');
		if (el) el.textContent = countdown;
		if (countdown <= 0) { countdown = REFRESH_INTERVAL; doAutoRefresh(); }
	}, 1000);
}

function stopAutoRefresh() {
	if (timer) { clearInterval(timer); timer = null; }
	var indicator = document.getElementById('auto-refresh-indicator');
	if (indicator) indicator.classList.remove('show');
}

function doAutoRefresh() {
	if (!pageVisible) return;
	showToast(_('正在刷新设备列表...'));
	loadOnlineData();
}

function loadOnlineData() {
	return L.resolveDefault(callGetUserlist(), { userlist: [] }).then(function(res) {
		var data = res.userlist || [];
		if (res.savedIcons) Object.assign(overviewCfg.users.icon, res.savedIcons);
		if (res.savedLabels) Object.assign(overviewCfg.users.label, res.savedLabels);
		renderUsers(data);
	});
}

return view.extend({
	load: function() {
		return L.resolveDefault(callGetUserlist(), { userlist: [] });
	},

	render: function(data) {
		var savedIcons = data.savedIcons || {};
		var savedLabels = data.savedLabels || {};
		Object.assign(overviewCfg.users.icon, savedIcons);
		Object.assign(overviewCfg.users.label, savedLabels);
		allUsers = data.userlist || [];

		document.addEventListener('visibilitychange', function() {
			pageVisible = document.visibilityState === 'visible';
			pageVisible ? startAutoRefresh() : stopAutoRefresh();
		});

		document.addEventListener('keydown', function(e) {
			if (e.key === 'Escape') { closeDetailModal(); closeIconsCard(); }
		});

		var styleEl = document.createElement('link');
		styleEl.rel = 'stylesheet';
		styleEl.href = L.resource('overview-widgets/style.css');
		document.head.appendChild(styleEl);

		return E('div', { class: 'ovw-page' }, [
			E('div', { class: 'ovw-main' }, [
				E('div', { class: 'breadcrumb' }, [
					E('a', { href: L.url('admin', 'status') }, _('Status')),
					' / ',
					E('span', {}, _('在线用户管理'))
				]),
				E('div', { class: 'page-header' }, [
					E('h1', { class: 'page-title' }, _('在线用户管理')),
					E('p', { class: 'page-subtitle' }, _('查看和管理当前连接到网络的所有设备'))
				]),
				E('div', { class: 'stats-bar' }, [
					E('div', { class: 'stat-card total' }, [
						E('div', { class: 'stat-icon' }, '🖥️'),
						E('div', { class: 'stat-value', id: 'stat-total' }, '—'),
						E('div', { class: 'stat-label' }, _('总在线设备')),
						E('div', { class: 'stat-trend' }, _('当前活跃'))
					]),
					E('div', { class: 'stat-card wireless' }, [
						E('div', { class: 'stat-icon' }, '📡'),
						E('div', { class: 'stat-value', id: 'stat-wifi' }, '—'),
						E('div', { class: 'stat-label' }, _('无线设备')),
						E('div', { class: 'stat-trend' }, 'WiFi 5G / 2.4G')
					]),
					E('div', { class: 'stat-card wired' }, [
						E('div', { class: 'stat-icon' }, '🔌'),
						E('div', { class: 'stat-value', id: 'stat-wired' }, '—'),
						E('div', { class: 'stat-label' }, _('有线设备')),
						E('div', { class: 'stat-trend' }, _('以太网连接'))
					])
				]),
				E('div', { class: 'title-bar' }, [
					E('h2', {}, [_('设备列表'), E('span', { class: 'count-badge', id: 'count-badge' }, '0')]),
					E('div', { class: 'fill' }),
					E('div', { class: 'btn-group' }, [
						E('button', {
							class: 'btn-icon',
							title: _('显示全部/仅WiFi'),
							id: 'btn-toggle-all',
							click: toggleAllUsers
						}, '🌐'),
						E('button', {
							class: 'btn-icon',
							title: _('刷新ARP缓存'),
							id: 'btn-flush',
							click: flushARP
						}, '🔄'),
						E('button', {
							class: 'btn-icon',
							title: _('收起列表'),
							id: 'btn-collapse',
							click: toggleUsers
						}, '⏫')
					])
				]),
				E('div', { class: 'search-bar' }, [
					E('div', { class: 'search-input-wrap' }, [
						E('span', { class: 'search-icon' }, '🔍'),
						E('input', {
							class: 'search-input',
							id: 'search-input',
							placeholder: _('搜索名称、IP 或 MAC 地址...'),
							input: onSearch
						})
					]),
					E('div', { class: 'sort-group' }, [
						E('span', { class: 'sort-label' }, _('排序')),
						E('button', { class: 'sort-btn active', 'data-sort': 'default', click: function() { setSort('default'); } }, [_('默认'), E('span', { class: 'dir-arrow' }, '↑')]),
						E('button', { class: 'sort-btn', 'data-sort': 'name', click: function() { setSort('name'); } }, [_('名称'), E('span', { class: 'dir-arrow' }, '↑')]),
						E('button', { class: 'sort-btn', 'data-sort': 'signal', click: function() { setSort('signal'); } }, [_('信号'), E('span', { class: 'dir-arrow' }, '↓')]),
						E('button', { class: 'sort-btn', 'data-sort': 'time', click: function() { setSort('time'); } }, [_('在线时长'), E('span', { class: 'dir-arrow' }, '↑')])
					])
				]),
				E('div', {
					class: 'weak-signal-banner',
					id: 'weak-signal-banner',
					style: 'display:none'
				}, [
					E('span', { class: 'banner-icon' }, '⚠️'),
					E('div', { class: 'banner-text' }, [
						E('div', {}, _('检测到弱信号设备，建议检查天线位置或减少干扰源')),
						E('div', { class: 'banner-list', id: 'weak-signal-list' })
					]),
					E('button', {
						class: 'banner-close',
						click: function() { weakSignalDismissed = true; var b = document.getElementById('weak-signal-banner'); if (b) b.style.display = 'none'; }
					}, '✕')
				]),
				E('div', { class: 'users-grid', id: 'users-grid' }),
				E('div', {
					class: 'icons-card',
					id: 'icons-card',
					style: 'display:none; opacity:0; transform:scale(0.8);'
				}, [
					E('div', { class: 'icons-card-header' }, [
						E('span', {}, _('选择图标')),
						E('button', { class: 'icons-card-close', click: closeIconsCard }, '✕')
					]),
					E('div', { class: 'icons-grid', id: 'icons-grid' })
				])
			]),
			E('div', {
				class: 'detail-modal-overlay',
				id: 'detail-modal',
				click: closeDetailModal
			}, [
				E('div', { class: 'detail-modal', click: function(e) { e.stopPropagation(); } }, [
					E('div', { class: 'detail-modal-header' }, [
						E('div', { class: 'detail-modal-icon', id: 'detail-icon' }, '📱'),
						E('div', { class: 'detail-modal-title' }, [
							E('h3', { id: 'detail-name' }, _('设备名称')),
							E('p', { id: 'detail-subtitle' })
						]),
						E('button', { class: 'detail-modal-close', click: closeDetailModal }, '✕')
					]),
					E('div', { class: 'detail-modal-body' }, [
						E('div', { class: 'detail-section' }, [
							E('div', { class: 'detail-section-title' }, _('网络信息')),
							E('div', { class: 'detail-row' }, [E('span', { class: 'detail-label' }, 'IPv4'), E('span', { class: 'detail-value', id: 'detail-ip' })]),
							E('div', { class: 'detail-row' }, [E('span', { class: 'detail-label' }, 'IPv6'), E('span', { class: 'detail-value', id: 'detail-ipv6' })]),
							E('div', { class: 'detail-row' }, [E('span', { class: 'detail-label' }, 'MAC'), E('span', { class: 'detail-value', id: 'detail-mac' })]),
							E('div', { class: 'detail-row', id: 'detail-ssid-row' }, [E('span', { class: 'detail-label' }, 'SSID'), E('span', { class: 'detail-value', id: 'detail-ssid' })]),
							E('div', { class: 'detail-row', id: 'detail-interface-row' }, [E('span', { class: 'detail-label' }, _('接口')), E('span', { class: 'detail-value', id: 'detail-interface' })])
						]),
						E('div', { class: 'detail-section' }, [
							E('div', { class: 'detail-section-title' }, _('无线信息')),
							E('div', { class: 'detail-row', id: 'detail-signal-row' }, [E('span', { class: 'detail-label' }, _('信号强度')), E('span', { class: 'detail-value', id: 'detail-signal' })]),
							E('div', { class: 'detail-row', id: 'detail-freq-row' }, [E('span', { class: 'detail-label' }, _('频率')), E('span', { class: 'detail-value', id: 'detail-freq' })]),
							E('div', { class: 'detail-row', id: 'detail-rx-row' }, [E('span', { class: 'detail-label' }, _('下行速率')), E('span', { class: 'detail-value', id: 'detail-rx', style: 'color:#059669' })]),
							E('div', { class: 'detail-row', id: 'detail-tx-row' }, [E('span', { class: 'detail-label' }, _('上行速率')), E('span', { class: 'detail-value', id: 'detail-tx', style: 'color:var(--primary)' })])
						]),
						E('div', { class: 'detail-section' }, [
							E('div', { class: 'detail-section-title' }, _('DHCP 信息')),
							E('div', { class: 'detail-row' }, [E('span', { class: 'detail-label' }, _('DHCP 类型')), E('span', { class: 'detail-value' }, 'DHCPv4')]),
							E('div', { class: 'detail-row' }, [E('span', { class: 'detail-label' }, _('在线时长')), E('span', { class: 'detail-value', id: 'detail-time' })]),
							E('div', { class: 'detail-row' }, [E('span', { class: 'detail-label' }, _('主机名')), E('span', { class: 'detail-value', id: 'detail-hostname' })])
						])
					]),
					E('div', { class: 'detail-modal-footer' }, [
						E('button', { class: 'btn-detail-disconnect', click: disconnectFromDetail }, _('断开连接')),
						E('button', { class: 'btn-detail-close', click: closeDetailModal }, _('关闭'))
					])
				])
			]),
			E('div', {
				class: 'auto-refresh-indicator',
				id: 'auto-refresh-indicator'
			}, [
				E('span', { class: 'dot' }),
				E('span', {}, [_('自动刷新'), ' · ', E('span', { id: 'countdown-val' }, REFRESH_INTERVAL), 's'])
			]),
			E('div', { class: 'toast', id: 'toast' }),
			E('span', { id: 'saved-icons', style: 'display:none' }, JSON.stringify(savedIcons)),
			E('span', { id: 'saved-labels', style: 'display:none' }, JSON.stringify(savedLabels))
		]);
	},

	boot: function() {
		poll.add(function() {
			return loadOnlineData().then(function() {
				if (document.activeElement && document.activeElement.classList.contains('search-input')) return;
			});
		}, 60);
		startAutoRefresh();
	}
});
