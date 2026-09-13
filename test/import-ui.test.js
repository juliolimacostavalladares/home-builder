const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

// Run the browser entry point against job responses, including failures that
// happen before inventory.json exists. No CAD is sent to a provider here.
function page(job) {
  class Element {
    constructor() { this.listeners = {}; this.children = []; this.options = []; this.hidden = false; this.disabled = false; this.textContent = ''; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    scrollIntoView() {}
    setAttribute(name, value) { this[name] = value; }
  }
  const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
  const elements = new Map();
  for (const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element();
    element.hidden = /\bhidden\b/.test(tag[0]);
    element.disabled = /\bdisabled\b/.test(tag[0]);
    elements.set(tag[1], element);
  }
  elements.get('view').options = ['layers.svg', 'source.svg', 'semantic.svg'].map(value => ({ value }));
  const loaded = [], views = [];
  elements.get('editor').contentWindow = {
    dispatchEvent() {},
    homeBuilderBridge: { ready: true, load: design => { loaded.push(design); return { walls: 4, rooms: 1 }; }, showView: view => views.push(view) }
  };
  const listeners = {};
  const context = {
    document: { getElementById: id => elements.get(id), createElement: () => new Element(), createTextNode: text => ({ textContent: text }) },
    window: { addEventListener: (name, fn) => { listeners[name] = fn; } },
    location: { search: '?job=test' }, URLSearchParams, Event,
    fetch: async url => ({ ok: true, json: async () => {
      if (url.startsWith('/api/blueprint3d/jobs/')) return job;
      if (url === '/inventory.json') return { instances: [] };
      throw new Error('Unexpected request: ' + url);
    } })
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/import-blueprint.js'), 'utf8'), context);
  return { elements, loaded, views, resume: () => listeners.load() };
}

test('Failed CAD still displays its extracted 2D drawing and never the editor demo', async () => {
  const ui = page({ id: 'test', status: 'failed', filename: 'large.dwg', error: 'CAD excede 12000 entidades instanciadas.', stages: [], artifacts: { 'source.svg': '/source.svg', 'source.dxf': '/source.dxf' } });
  await ui.resume();
  assert.equal(ui.elements.get('technical').hidden, false, 'extracted CAD must remain visible without inventory');
  assert.equal(ui.elements.get('vector').data, '/source.svg');
  assert.equal(ui.elements.get('editor').hidden, true, 'a failed import must not show the demo room');
  assert.equal(ui.elements.get('view-model').disabled, true);
  assert.equal(ui.loaded.length, 0);
});

test('Validated conversion enables explicit 2D and 3D navigation to the same imported model', async () => {
  const design = { floorplan: { corners: {}, walls: [] }, items: [] };
  const ui = page({ id: 'test', status: 'ready', filename: 'house.dwg', stages: [], artifacts: { 'source.svg': '/source.svg', 'inventory.json': '/inventory.json' }, result: { design, report: { strategy: 'ai-native', contractVersion: 'cad-blueprint3d/2', warnings: [] } } });
  await ui.resume();
  assert.equal(ui.loaded[0], design);
  assert.equal(ui.elements.get('view-plan').disabled, false);
  assert.equal(ui.elements.get('view-model').disabled, false);
  await ui.elements.get('view-model').listeners.click();
  assert.equal(ui.views.at(-1), '3d');
  assert.equal(ui.elements.get('editor').hidden, false);
  assert.equal(ui.elements.get('technical').hidden, true);
});
