// Copyright 2024 wsk170 <wsk170@gmail.com>
// Licensed to the GNU General Public License v3.0.

'use strict';
'require baseclass';
'require fs';
'require ui';
'require rpc';

const Store = { show: false, change: false };

function renderManagerButton(items) {
  const css = {
    btn: `
      position: fixed; bottom: 10px; right: 10px;
      width: 48px; height: 48px;
      border-radius: 50%;
      background: transparent;
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
    `
  };

  const btn = E('button', { style: css.btn });
  const icon = L.resource('icons/layout.png');
  btn.style.backgroundImage = `url(${icon})`;
  btn.addEventListener('click', () => {
    L.ui.showModal(null, renderManager(items));
  });
  return btn;
}

function renderManager(items) {
  const css = {
    itemsGrid: `
      display: grid; grid-gap: 5px 10px; align-items: center;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    `,
    item: `
      display: flex; align-items: center; height: 3rem;
      border: 1px solid LightGray;
      border-radius: 3px;
    `,
    checkbox: `width: 1rem; height: 1rem; margin: 0 5px;`,
    label: `font-size: 1rem; font-weight: bold;`,
    buttons: `
      display: flex; justify-content: flex-end; align-items: center;
      margin-top: 1rem;
    `,
    applyBtn: `
      font-size: 0.8rem; color: White;
      line-height: 2em;
      border-radius: 4px;
      background-color: rgb(0, 172, 89);
      margin: 0 5px; padding: 0 10px;
    `,
    cancelBtn: `
      font-size: 0.8rem;
      width: 50px; line-height: 2em;
      border-radius: 4px;
      border: 1px solid LightGray;
      margin: 0 5px;
    `
  };

  const checkboxArr = [];
  const checkboxItems = [];
  items.forEach((item) => {
    const [basename, extname] = item;
    const itemId = 'include_' + basename;
    const checkbox = E('input', {
      type: 'checkbox',
      id: itemId,
      name: extname,
      value: basename,
      style: css.checkbox
    });
    if (extname === '.js') checkbox.checked = true;
    const label = E('label', { for: itemId, style: css.label }, basename);
    checkboxItems.push(checkbox);
    checkboxArr.push(E('div', { style: css.item }, [checkbox, label]));

    checkbox.addEventListener('click', () => {
      Store.change = true;
    });
  });

  const itemsGrid = E('div', { style: css.itemsGrid }, checkboxArr);

  const applyBtn = E('button', { style: css.applyBtn }, _('Save & Apply'));
  applyBtn.addEventListener('click', () => {
    if (Store.change === false) return;
    applayChange(checkboxItems);
  });

  const cancelBtn = E('button', { style: css.cancelBtn }, _('Cancel'));
  cancelBtn.addEventListener('click', () => {
    L.ui.hideModal();
  });

  const buttons = E('div', { style: css.buttons }, [applyBtn, cancelBtn]);

  return E('div', {}, [itemsGrid, buttons]);
}

function applayChange(items) {
  const path = '/www/luci-static/resources/view/status/include';
  const tasks = [];
  for (let checkbox of items) {
    const source = path + '/' + checkbox.value;
    if (checkbox.checked) {
      if (checkbox.name === '.bak') {
        tasks.push(fs.exec('mv', [source + '.bak', source + '.js']));
      }
    } else {
      if (checkbox.name === '.js') {
        tasks.push(fs.exec('mv', [source + '.js', source + '.bak']));
      }
    }
  }

  Promise.all(tasks).then(() => {
    L.ui.hideModal();
    location.reload();
  });
}

return baseclass.extend({
  title: '',

  load: function () {
    const path = '/www/luci-static/resources/view/status/include';
    return L.resolveDefault(fs.list(path), []).then((files) => {
      return files.map((file) => file.name).sort();
    });
  },

  render: function (files) {
    const items = [];
    let match;
    for (let filename of files) {
      match = filename.match(/manager/);
      if (match) continue;
      match = filename.match(/(.+)(\.(js|bak))$/);
      if (match === null) continue;
      items.push([match[1], match[2]]);
    }
    return renderManagerButton(items);
  }
});
