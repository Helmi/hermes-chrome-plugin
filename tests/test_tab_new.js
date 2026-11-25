const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(initialGroups = []) {
  const groups = initialGroups.map(g => ({...g}));
  const tabs = new Map();
  const calls = [];
  let nextTab = 100, nextGroup = 50, nextWindow = 20;
  const listener = { addListener() {} };
  const chrome = {
    runtime: { id: 'test', onInstalled: listener, onStartup: listener },
    alarms: { onAlarm: listener, create() {} },
    action: { onClicked: listener, setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {} },
    tabs: {
      async create(p) { calls.push(['tab.create', {...p}]); const tab = {id: nextTab++, windowId: p.windowId ?? 1, groupId: -1, active: p.active, url: p.url}; tabs.set(tab.id, tab); return {...tab}; },
      async get(id) { return {...tabs.get(id)}; },
      async group(p) { calls.push(['tab.group', {...p}]); let g = groups.find(g => g.id === p.groupId); if (!g) { g = {id: nextGroup++, windowId: tabs.get(p.tabIds[0]).windowId}; groups.push(g); } for (const id of p.tabIds) tabs.get(id).groupId = g.id; return g.id; },
    },
    tabGroups: {
      async query(q) { return groups.filter(g => q.windowId === undefined || g.windowId === q.windowId); },
      async get(id) { return groups.find(g => g.id === id); },
      async update(id, p) { Object.assign(groups.find(g => g.id === id), p); },
    },
    windows: {
      async create(p) { calls.push(['window.create', {...p}]); const tab = {id: nextTab++, windowId: nextWindow++, groupId: -1, active: true, url: p.url}; tabs.set(tab.id, tab); return {id: tab.windowId, tabs: [tab]}; },
      async get(id) { if (![...tabs.values()].some(t => t.windowId === id)) throw Error('missing'); return {id}; },
      async update(id, p) { calls.push(['window.update', id, {...p}]); },
    },
  };
  const context = vm.createContext({chrome, setInterval() {}, setTimeout, clearTimeout, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../chrome-extension/service_worker.js'), 'utf8'), context);
  return { dispatch: (action, params) => context.dispatch(action, params), calls, groups };
}

test('background creation finds the requested group in another window', async () => {
  const h = harness([{id: 9, windowId: 2, title: 'Hermes'}]);
  const result = await h.dispatch('tab.new', {url: 'https://example.org'});
  assert.equal(result.tab.windowId, 2);
  assert.equal(result.tab.active, false);
  assert.equal(result.group.id, 9);
  assert.equal(h.calls.some(c => c[0] === 'window.update'), false);
});

test('first run creates an unfocused window and concurrent calls reuse it', async () => {
  const h = harness();
  const [first, second] = await Promise.all([h.dispatch('tab.new', {}), h.dispatch('tab.new', {})]);
  assert.equal(first.tab.windowId, second.tab.windowId);
  assert.equal(first.tab.active, true); // A new Chrome window must have an active tab.
  assert.equal(second.tab.active, false);
  assert.equal(h.calls.filter(c => c[0] === 'window.create').length, 1);
  assert.equal(h.calls.find(c => c[0] === 'window.create')[1].focused, false);
  assert.equal(h.calls.filter(c => c[0] === 'window.update').length, 0);
});

test('follows the group when it moves to another window', async () => {
  const h = harness([{id: 9, windowId: 2, title: 'Hermes'}]);
  await h.dispatch('tab.new', {});
  h.groups[0].windowId = 3;
  const result = await h.dispatch('tab.new', {});
  assert.equal(result.tab.windowId, 3);
  assert.equal(result.group.id, 9);
  assert.equal(result.tab.active, false);
});

test('duplicate titles select lowest window and group IDs deterministically', async () => {
  const h = harness([{id: 8, windowId: 2, title: 'Hermes'}, {id: 6, windowId: 2, title: 'Hermes'}, {id: 2, windowId: 3, title: 'Hermes'}]);
  const result = await h.dispatch('tab.new', {});
  assert.equal(result.group.id, 6);
  assert.equal(result.tab.windowId, 2);
});

test('group opt-out remains ungrouped and explicit foreground targets a window', async () => {
  const h = harness([{id: 9, windowId: 2, title: 'Hermes'}]);
  const result = await h.dispatch('tab.new', {group: false, windowId: 1, foreground: true});
  assert.equal(result.windowId, 1);
  assert.equal(result.active, true);
  assert.equal(result.group, null);
  assert.equal(h.calls.filter(c => c[0] === 'tab.group').length, 0);
  assert.equal(h.calls.find(c => c[0] === 'window.update')[1], 1);
});
