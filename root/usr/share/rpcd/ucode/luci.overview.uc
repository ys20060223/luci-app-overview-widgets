'use strict';

import { readfile, popen } from 'fs';

function read_text(path) {
	let data = readfile(path);
	return (data == null) ? '' : data;
}

function get_lines(text) {
	text = trim(text || '');
	return text ? split(text, '\n') : [];
}

function trim(s) {
	return (s || '').replace(/^\s+/, '').replace(/\s+$/, '');
}

function norm_mac(mac) {
	if (!mac) return '';
	let m = lc(trim(mac));
	if (m == 'null' || m == 'none' || m == '-' || m == '00:00:00:00:00:00') return '';
	return m;
}

function format_uptime(seconds) {
	if (!seconds || seconds <= 0) return '—';
	let days = floor(seconds / 86400);
	let hours = floor((seconds % 86400) / 3600);
	let mins = floor((seconds % 3600) / 60);
	if (days > 0) return days + 'd ' + hours + 'h';
	if (hours > 0) return hours + 'h ' + mins + 'm';
	return mins + 'm';
}

// Load saved icons and labels from /etc/config/overview-widgets
function load_persistent() {
	let icons = {};
	let labels = {};
	let text = read_text('/etc/config/overview-widgets');
	for (let line in get_lines(text)) {
		if (index(line, 'config device') == 0 || index(line, 'config dev') == 0) {
			// Start of a device section — key will be the MAC (section name)
		} else if (match(line, /^[\s]*option\s+icon\s+"?([^"\s]+)"?/) != null) {
			let m = match(line, /^[\s]*option\s+icon\s+"?([^"\s]+)"?/);
			// Will attach to current MAC once we know it
		} else if (match(line, /^[\s]*option\s+label\s+"?([^"\s]+)"?/) != null) {
			// Same
		}
	}

	// Parse with section tracking
	let curMac = '';
	for (let line in get_lines(text)) {
		line = trim(line);
		let m = match(line, /^config\s+(dev|device)\s+"?(\S+)"?/);
		if (m) {
			curMac = m[2];
			continue;
		}
		if (curMac) {
			m = match(line, /^option\s+icon\s+"?(\S+)"?/);
			if (m) icons[curMac] = m[1];
			m = match(line, /^option\s+label\s+"?(\S+)"?/);
			if (m) labels[curMac] = m[1];
		}
	}
	return [icons, labels];
}

function load_dhcp_leases() {
	let leases = {};
	let text = read_text('/tmp/dhcp.leases');
	let lns = get_lines(text);
	let now = time();

	for (let i = 0; i < length(lns); i++) {
		let p = split_ws(lns[i]);
		if (length(p) < 4) continue;
		let ts = int(p[0]);
		let mac = norm_mac(p[1]);
		if (!mac) continue;
		let ip = p[2];
		let hostname = p[3];
		if (hostname == '*' || hostname == '-' || lc(hostname) == 'null') hostname = null;
		let rem = ts - now;
		if (rem < 0) rem = 0;
		leases[mac] = { ip: ip, hostname: hostname, begin: ts, expires: rem };
	}

	// Also read /tmp/hosts/dhcp.leases if exists
	let extra = read_text('/tmp/hosts/dhcp.leases');
	if (extra) {
		for (let line in get_lines(extra)) {
			let p = split_ws(line);
			if (length(p) < 4) continue;
			let mac = norm_mac(p[1]);
			if (!mac) continue;
			if (leases[mac] && !leases[mac].hostname && p[3] && p[3] != '*' && p[3] != '-') {
				leases[mac].hostname = p[3];
			}
		}
	}

	return leases;
}

function get_ip_host_map() {
	let map = {};
	for (let path in ['/tmp/hosts/odhcpd', '/tmp/hosts/dhcp']) {
		let content = read_text(path);
		if (!content) continue;
		for (let line in get_lines(content)) {
			if (substr(line, 0, 1) == '#') continue;
			let p = split_ws(line);
			if (length(p) >= 2 && p[0] && p[1] && p[1] != '*' && lc(p[1]) != 'null') {
				map[p[0]] = p[1];
			}
		}
	}
	return map;
}

function get_userlist() {
	let users = {};
	let now = time();

	// 1. DHCP leases as base skeleton
	let leases = load_dhcp_leases();
	for (let mac in leases) {
		let l = leases[mac];
		users[mac] = {
			macaddr: mac,
			ipaddr: l.ip + '[STALE]',
			hostname: l.hostname or '?',
			device: '-',
			expires: l.expires,
			is_wifi: false,
			signal: null,
			ssid: null,
			freq: null,
			rx: null,
			tx: null,
		};
	}

	// 2. Neighbor tables (IPv4 + IPv6)
	let neigh_text = '';
	let fd = popen("ip -4 neigh show 2>/dev/null; ip -6 neigh show 2>/dev/null");
	if (fd) {
		neigh_text = fd.read('all');
		fd.close();
	}
	// Also read /proc/net/arp directly
	let arp_text = read_text('/proc/net/arp') or '';
	neigh_text = neigh_text + arp_text;

	for (let line in get_lines(neigh_text)) {
		let p = split_ws(line);
		if (length(p) < 4) continue;
		let ip = p[0];
		if (!ip || ip == 'null') continue;

		let mac = '';
		let dev = '';
		let status = '';
		for (let i = 1; i < length(p); i++) {
			if (p[i] == 'dev' && i + 1 < length(p)) dev = p[i + 1];
			if (p[i] == 'lladdr' && i + 1 < length(p)) mac = norm_mac(p[i + 1]);
			if (p[i] == 'FAILED' || p[i] == 'REACHABLE' || p[i] == 'STALE' || p[i] == 'PROBE' || p[i] == 'DELAY') status = p[i];
		}
		// For /proc/net/arp format: IP HW Type Flags MAC Interface
		if (!mac && length(p) >= 5) {
			mac = norm_mac(p[4]);
			dev = p[5] or '';
			status = 'REACHABLE';
		}
		if (!mac) continue;

		let ip_with_status = status ? (ip + '[' + status + ']') : ip;

		if (!users[mac]) {
			let ip_host = get_ip_host_map();
			let hostname = ip_host[ip] or '?';
			users[mac] = {
				macaddr: mac,
				ipaddr: ip_with_status,
				hostname: hostname,
				device: dev,
				expires: '-',
				is_wifi: false,
				signal: null,
				ssid: null,
			};
		} else {
			if (index(users[mac].ipaddr, ip) >= 0) {
				users[mac].ipaddr = ip_with_status;
			} else {
				users[mac].ipaddr = users[mac].ipaddr + '/' + ip_with_status;
			}
			if (dev) users[mac].device = dev;
		}
	}

	// 3. WiFi interface detection
	let wifi_devs = {};
	let fd2 = popen("ls /sys/class/net/ 2>/dev/null");
	if (fd2) {
		let ls = fd2.read('all');
		fd2.close();
		for (let d in get_lines(ls)) {
			d = trim(d);
			if (!d) continue;
			if (match(d, '^wl') != null || match(d, '^wlan') != null) {
				wifi_devs[d] = true;
				continue;
			}
			let wireless_path = '/sys/class/net/' + d + '/wireless';
			if (read_text(wireless_path) != null) {
				wifi_devs[d] = true;
			}
		}
	}

	// 4. WiFi station info
	for (let dev in wifi_devs) {
		let ssid = '';
		let fd_ssid = popen(sprintf("iw dev %s info 2>/dev/null | grep ssid", dev));
		if (fd_ssid) {
			let ssid_out = trim(fd_ssid.read('all'));
			fd_ssid.close();
			let m = match(ssid_out, /ssid (.+)/);
			if (m) ssid = m[1];
		}

		let fd_assoc = popen(sprintf("iw dev %s station dump 2>/dev/null || iw dev %s station get 00:00:00:00:00:00 2>/dev/null", dev, dev));
		if (fd_assoc) {
			let assoc = fd_assoc.read('all');
			fd_assoc.close();
			let cur_mac = '';
			for (let line in get_lines(assoc)) {
				let p = split_ws(line);
				if (length(p) >= 2) {
					if (match(p[0], /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/)) {
						cur_mac = norm_mac(p[0]);
					}
				}
				if (cur_mac && index(line, 'signal:') >= 0) {
					let sig_p = split_ws(line);
					let sig_val = sig_p[1] or '0';
					if (users[cur_mac]) {
						users[cur_mac].is_wifi = true;
						users[cur_mac].signal = sig_val;
						users[cur_mac].ssid = ssid;
						users[cur_mac].freq = (int(sig_val) < -80) ? '2.4GHz' : '5GHz';
						if (index(users[cur_mac].ipaddr, '[FAILED]') >= 0) {
							users[cur_mac].ipaddr = replace(users[cur_mac].ipaddr, '[FAILED]', '[REACHABLE]');
						}
					}
				}
				if (cur_mac && match(line, /rx bitrate:/) != null) {
					let m = match(line, /rx bitrate:\s*(\S+)/);
					if (m) { if (users[cur_mac]) users[cur_mac].rx = m[1]; }
				}
				if (cur_mac && match(line, /tx bitrate:/) != null) {
					let m = match(line, /tx bitrate:\s*(\S+)/);
					if (m) { if (users[cur_mac]) users[cur_mac].tx = m[1]; }
				}
			}
		}
	}

	// 5. Final cleanup
	let rv = [];
	for (let mac in users) {
		if (!mac || mac == '') continue;
		if (index(users[mac].ipaddr, '[') < 0 && users[mac].ipaddr != '-' && users[mac].ipaddr != 'null') {
			users[mac].ipaddr = users[mac].ipaddr + '[FAILED]';
		}
		push(rv, users[mac]);
	}

	// 6. Load persistent icons and labels
	let [saved_icons, saved_labels] = load_persistent();
	for (let mac in saved_icons) {
		if (users[mac]) users[mac]._icon = saved_icons[mac];
	}
	for (let mac in saved_labels) {
		if (users[mac]) users[mac]._label = saved_labels[mac];
	}

	return rv;
}

function disconnect_client(mac) {
	mac = lc(trim(mac or ''));
	if (!mac) return { result: false, error: 'no mac' };
	let rv = popen(sprintf("iw dev wlan0 station del %s 2>/dev/null; iw dev wlan1 station del %s 2>/dev/null; true", mac, mac));
	if (rv) rv.close();
	return { result: true };
}

function rename_device(mac, label) {
	mac = uc(trim(mac or ''));
	label = trim(label or '');
	if (!mac) return { result: false, error: 'no mac' };
	// Write to /etc/config/overview-widgets directly
	let text = read_text('/etc/config/overview-widgets') or '';
	let lines = get_lines(text);
	let out = [];
	let curMac = '';
	let found = false;
	for (let line in lines) {
		let m = match(line, /^config\s+(dev|device)\s+"?(\S+)"?/);
		if (m) {
			curMac = m[2];
			found = (curMac == mac);
		}
		if (found && match(line, /^option\s+label\s+/) != null) {
			out.push('	option label "' + label + '"');
			found = false;
			continue;
		}
		push(out, line);
	}
	if (!found && label) {
		push(out, '');
		push(out, 'config dev "' + mac + '"');
		push(out, '	option label "' + label + '"');
	}
	writefile('/etc/config/overview-widgets', join(out, '\n') + '\n');
	return { result: true };
}

function set_device_icon(mac, icon) {
	mac = uc(trim(mac or ''));
	icon = trim(icon or '');
	if (!mac) return { result: false, error: 'no mac' };
	let text = read_text('/etc/config/overview-widgets') or '';
	let lines = get_lines(text);
	let out = [];
	let curMac = '';
	let found = false;
	for (let line in lines) {
		let m = match(line, /^config\s+(dev|device)\s+"?(\S+)"?/);
		if (m) {
			curMac = m[2];
			found = (curMac == mac);
		}
		if (found && match(line, /^option\s+icon\s+/) != null) {
			out.push('	option icon "' + icon + '"');
			found = false;
			continue;
		}
		push(out, line);
	}
	if (!found && icon) {
		push(out, '');
		push(out, 'config dev "' + mac + '"');
		push(out, '	option icon "' + icon + '"');
	}
	writefile('/etc/config/overview-widgets', join(out, '\n') + '\n');
	return { result: true };
}

function flush_arp() {
	popen("ip neigh flush all 2>/dev/null; true");
	return { result: true };
}

return {
	'luci.overview': {
		getOnlineUserlist: {
			call: function() {
				return { userlist: get_userlist() };
			}
		},
		disconnectClient: {
			call: function(args) {
				return disconnect_client(args.mac);
			}
		},
		renameDevice: {
			call: function(args) {
				return rename_device(args.mac, args.label);
			}
		},
		setIcon: {
			call: function(args) {
				return set_device_icon(args.mac, args.icon);
			}
		},
		flushArp: {
			call: function() {
				return flush_arp();
			}
		}
	}
};
