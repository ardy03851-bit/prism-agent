/* ============================================================
   PRISM — app logic
   Multi-model AI agent workspace · static, no build step
   ============================================================ */
'use strict';

/* ---------------- utilities ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));
}

function refreshIcons() {
  if (window.lucide) {
    try { window.lucide.createIcons(); } catch (e) { /* transient race during streaming re-renders */ }
  }
}

/* safe storage — degrades to memory when blocked (sandboxed iframes) */
const store = (() => {
  let mem = {};
  let ok = false;
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); ok = true; } catch (e) { ok = false; }
  return {
    get(k, fallback) {
      try {
        const v = ok ? localStorage.getItem(k) : mem[k];
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(k, v) {
      try { if (ok) localStorage.setItem(k, JSON.stringify(v)); else mem[k] = v; } catch (e) { mem[k] = v; }
    }
  };
})();

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = `<i data-lucide="${kind === 'err' ? 'alert-triangle' : 'check-circle-2'}"></i><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t);
  refreshIcons();
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 300ms'; }, 3400);
  setTimeout(() => t.remove(), 3800);
}

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function nowSec() { return Math.round(Date.now() / 1000); }

/* image error fallback: swap broken model icons to initials */
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.dataset.fallback) {
    const s = document.createElement('span');
    s.className = 'txt';
    s.textContent = img.dataset.fallback;
    img.replaceWith(s);
  }
}, true);

/* ---------------- constants ---------------- */

const FREE_ENDPOINT = 'https://text.pollinations.ai/openai';
const FREE_MODELS_URL = 'https://text.pollinations.ai/models';

const THOUGHT_LEVELS = [
  { id: 'off', name: 'Off', desc: 'Answer directly, minimal deliberation' },
  { id: 'low', name: 'Quick', desc: 'Brief thinking before answering' },
  { id: 'balanced', name: 'Balanced', desc: 'Reasonable depth for most tasks' },
  { id: 'deep', name: 'Deep', desc: 'Think hard — complex problems' },
  { id: 'max', name: 'Max', desc: 'Maximum reasoning effort' },
];

const THOUGHT_PROMPTS = {
  off: 'Answer directly and concisely. Do not deliberate extensively.',
  low: 'Think briefly before answering, then give a clear, direct response.',
  balanced: 'Think through the problem carefully before answering. Weigh approaches and pick the best one.',
  deep: 'Think deeply and rigorously before answering. Decompose the problem, consider edge cases, and verify your reasoning before responding.',
  max: 'Use maximum reasoning effort. Explore the problem from multiple angles, question your assumptions, verify each step, and only then produce your answer.',
};

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch a web page or URL and return its readable text as markdown. Use for reading documentation, articles, or APIs.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The full URL to fetch' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for a query and return the top results with snippets.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_js',
      description: 'Run JavaScript code in a browser sandbox. Use for calculations, data processing, simulations, or quick demos. Log outputs with console.log().',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: 'JavaScript source code to run' } },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_repo',
      description: 'Read a GitHub repository: its metadata + README, its file tree, or a specific file. Use action "info" | "tree" | "file" (with path).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['info', 'tree', 'file'] },
          repo: { type: 'string', description: 'Repository in owner/name form. Defaults to the connected repo.' },
          path: { type: 'string', description: 'File path within the repo (for action "file")' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'think',
      description: 'Private scratchpad for step-by-step reasoning on complex problems. Your thoughts here are not shown to the user in the final answer.',
      parameters: {
        type: 'object',
        properties: { thoughts: { type: 'string', description: 'Your reasoning' } },
        required: ['thoughts'],
      },
    },
  },
];

/* ---------------- state ---------------- */

const state = {
  myModels: [],
  freeModels: [],
  freeFetched: false,
  selectedModelId: null,
  thoughtLevel: 'balanced',
  autoMode: false,
  conversations: [],
  currentId: null,
  attachments: [],
  ghRepo: null,        // { owner, name, full_name, description }
  ghContext: null,      // readme excerpt
  generating: false,
  controller: null,
};

/* ---------------- model helpers ---------------- */

function allModels() { return [...state.myModels, ...state.freeModels]; }

function findModel(id) {
  return allModels().find(m => m.uid === id) ||
    allModels().find(m => m.id === id) || null;
}

function modelUid(m) { return m.uid || `${m.source}:${m.id}`; }

function normalizeMyModel(entry, i) {
  const src = entry || {};
  const id = String(src.model || src.id || `model-${i}`);
  return {
    uid: `mine:${id}`,
    id,
    name: src.name || id,
    company: src.company || 'Custom',
    icon: src.icon || null,
    baseUrl: src.baseUrl || src.url || src.proxy || '',
    apiKey: src.apiKey || src.key || '',
    model: src.model || src.id || id,
    tools: src.tools !== false,
    reasoning: !!src.reasoning,
    vision: !!src.vision,
    source: 'mine',
  };
}

async function loadMyModels() {
  try {
    const res = await fetch('models.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (Array.isArray(data.models) ? data.models : []);
    state.myModels = list.map(normalizeMyModel).filter(m => m.baseUrl);
  } catch (e) {
    state.myModels = [];
  }
}

async function loadFreeModels() {
  if (state.freeFetched) return;
  try {
    const res = await fetch(FREE_MODELS_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    state.freeModels = list
      .filter(m => (m.input_modalities || ['text']).includes('text'))
      .map(m => ({
        uid: `free:${m.name}`,
        id: m.name,
        name: m.name,
        company: 'Pollinations · free',
        icon: null,
        baseUrl: FREE_ENDPOINT,
        apiKey: '',
        model: m.name,
        tools: m.tools !== false,
        reasoning: !!m.reasoning,
        vision: !!m.vision,
        source: 'free',
      }));
    state.freeFetched = true;
  } catch (e) {
    state.freeModels = [];
  }
}

function defaultModel() {
  if (state.selectedModelId) {
    const m = findModel(state.selectedModelId);
    if (m) return m;
  }
  // skip untouched placeholder examples (fake key) when picking a default
  const usable = state.myModels.filter(m => !/REPLACE-ME|YOUR.?KEY|sk-\.\.\./i.test(m.apiKey || ''));
  return usable[0] || state.freeModels[0] || state.myModels[0] || null;
}

/* ---------------- persistence ---------------- */

function saveConversations() {
  store.set('prism.conversations', state.conversations.slice(0, 40));
}
function saveSettings() {
  store.set('prism.settings', {
    selectedModelId: state.selectedModelId,
    thoughtLevel: state.thoughtLevel,
    autoMode: state.autoMode,
  });
}
function loadPersisted() {
  state.conversations = store.get('prism.conversations', []);
  const s = store.get('prism.settings', {});
  if (s.selectedModelId) state.selectedModelId = s.selectedModelId;
  if (s.thoughtLevel) state.thoughtLevel = s.thoughtLevel;
  if (typeof s.autoMode === 'boolean') state.autoMode = s.autoMode;
}

/* ---------------- icons / avatars ---------------- */

function avatarHTML(m, cls = 'model-avatar') {
  const initials = esc((m.company === 'Pollinations · free' ? m.name : (m.company || m.name || '?')).slice(0, 2).toUpperCase());
  if (m.icon && /^https?:\/\//.test(m.icon)) {
    return `<span class="${cls}"><img src="${esc(m.icon)}" alt="" loading="lazy" data-fallback="${initials}"></span>`;
  }
  if (m.icon) return `<span class="${cls} txt">${esc(m.icon)}</span>`;
  return `<span class="${cls}">${initials}</span>`;
}

/* ---------------- markdown rendering ---------------- */

if (window.marked) {
  window.marked.setOptions({ gfm: true, breaks: true });
}

function renderMarkdown(text) {
  if (!window.marked || !window.DOMPurify) return `<p>${esc(text)}</p>`;
  const html = window.marked.parse(text || '');
  const clean = window.DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] });
  const wrap = document.createElement('div');
  wrap.innerHTML = clean;
  // links: open in new tab
  wrap.querySelectorAll('a').forEach(a => {
    a.target = '_blank'; a.rel = 'noopener noreferrer';
  });
  // code blocks: add head bar with copy button
  wrap.querySelectorAll('pre > code').forEach(code => {
    const pre = code.parentElement;
    const langMatch = /language-(\w+)/.exec(code.className || '');
    const lang = langMatch ? langMatch[1] : 'code';
    const head = document.createElement('div');
    head.className = 'code-head';
    head.innerHTML = `<span>${esc(lang)}</span><button class="code-copy" type="button"><i data-lucide="copy"></i>Copy</button>`;
    pre.insertBefore(head, code);
  });
  return wrap.innerHTML;
}

/* ---------------- chat rendering ---------------- */

const messagesEl = $('#messages');
const emptyStateEl = $('#emptyState');

function ensureMessagesInner() {
  let inner = $('.messages-inner', messagesEl);
  if (!inner) {
    inner = document.createElement('div');
    inner.className = 'messages-inner';
    messagesEl.appendChild(inner);
  }
  return inner;
}

function showEmpty(show) {
  emptyStateEl.style.display = show ? '' : 'none';
}

function currentConversation() {
  return state.conversations.find(c => c.id === state.currentId) || null;
}

function renderChatList() {
  const list = $('#chatList');
  list.innerHTML = '';
  if (!state.conversations.length) {
    list.innerHTML = `<div style="padding:12px 10px;font-size:var(--text-xs);color:var(--text-faint)">No chats yet — your conversations will appear here.</div>`;
    return;
  }
  for (const c of state.conversations) {
    const item = document.createElement('div');
    item.className = `chat-item${c.id === state.currentId ? ' active' : ''}`;
    item.setAttribute('data-testid', `chat-item-${c.id}`);
    item.innerHTML = `
      <i data-lucide="message-square" style="width:14px;height:14px;flex-shrink:0"></i>
      <span class="chat-item-title">${esc(c.title || 'New chat')}</span>
      <button class="chat-item-del" aria-label="Delete chat"><i data-lucide="trash-2"></i></button>`;
    item.addEventListener('click', () => openConversation(c.id));
    item.querySelector('.chat-item-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(c.id);
    });
    list.appendChild(item);
  }
  refreshIcons();
}

function newChat() {
  state.currentId = null;
  showEmpty(true);
  renderChatList();
  $('#topbarTitle').textContent = 'New chat';
  messagesEl.querySelectorAll('.messages-inner').forEach(n => n.remove());
  state.attachments = [];
  renderAttachments();
  closeSidebarMobile();
}

function openConversation(id) {
  const c = state.conversations.find(x => x.id === id);
  if (!c) return;
  state.currentId = id;
  showEmpty(false);
  $('#topbarTitle').textContent = c.title || 'Chat';
  messagesEl.querySelectorAll('.messages-inner').forEach(n => n.remove());
  const inner = ensureMessagesInner();
  for (const msg of c.history) renderHistoryMessage(inner, msg);
  renderChatList();
  scrollToBottom(false);
  closeSidebarMobile();
}

function deleteConversation(id) {
  state.conversations = state.conversations.filter(c => c.id !== id);
  saveConversations();
  if (state.currentId === id) newChat();
  else renderChatList();
}

function renderHistoryMessage(inner, msg) {
  if (msg.role === 'user') {
    const files = msg.files || [];
    const text = typeof msg.content === 'string' ? msg.content
      : Array.isArray(msg.content) ? (msg.content.find(p => p.type === 'text')?.text || '') : '';
    const el = document.createElement('div');
    el.className = 'msg msg-user';
    let fileHTML = '';
    if (files.length) {
      fileHTML = `<div class="msg-files">${files.map(f => f.kind === 'image'
        ? `<img class="thumb" src="${f.data}" alt="${esc(f.name)}">`
        : `<span class="file-pill"><i data-lucide="file-text"></i>${esc(f.name)}</span>`).join('')}</div>`;
    }
    el.innerHTML = `<div class="bubble">${fileHTML}${esc(text)}</div>`;
    inner.appendChild(el);
  } else if (msg.role === 'assistant') {
    if (!msg.content && !msg.reasoning) return; // tool-use round with no visible output
    const root = buildAssistantMessage(msg.modelInfo || null, msg);
    inner.appendChild(root.el);
  }
  refreshIcons();
}

/* ---------------- assistant message DOM ---------------- */

function buildAssistantMessage(model, existing) {
  const m = model || { name: 'AI', company: '' };
  const el = document.createElement('div');
  el.className = 'msg msg-ai';
  el.innerHTML = `
    <div class="ai-head">
      ${avatarHTML(m, 'model-avatar')}
      <span class="ai-name">${esc(m.name || 'Assistant')}</span>
      <span>${esc(m.company || '')}</span>
    </div>
    <div class="ai-body">
      <div class="stage-bar" hidden>
        <span class="stage" data-stage="plan"><i data-lucide="list-tree" class="stage-icon"></i>Plan</span>
        <i data-lucide="chevron-right" class="stage-arrow"></i>
        <span class="stage" data-stage="draft"><i data-lucide="pen-line" class="stage-icon"></i>Draft</span>
        <i data-lucide="chevron-right" class="stage-arrow"></i>
        <span class="stage" data-stage="polish"><i data-lucide="gem" class="stage-icon"></i>Polish</span>
      </div>
      <div class="reasoning" hidden>
        <button class="reasoning-head" type="button">
          <i data-lucide="brain"></i>
          <span class="reasoning-label">Thinking</span>
          <i data-lucide="chevron-down" class="chev"></i>
        </button>
        <div class="reasoning-body"></div>
      </div>
      <div class="tools-slot"></div>
      <div class="content-slot"></div>
      <div class="msg-actions">
        <button class="icon-btn copy-btn" style="width:28px;height:28px" aria-label="Copy message" title="Copy"><i data-lucide="copy"></i></button>
      </div>
    </div>`;
  const root = {
    el,
    reasoning: $('.reasoning', el),
    reasoningLabel: $('.reasoning-label', el),
    reasoningBody: $('.reasoning-body', el),
    tools: $('.tools-slot', el),
    content: $('.content-slot', el),
    stageBar: $('.stage-bar', el),
  };

  root.reasoning.querySelector('.reasoning-head').addEventListener('click', () => {
    root.reasoning.classList.toggle('open');
  });
  root.el.querySelector('.copy-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(root.content.textContent || '').then(() => toast('Copied to clipboard'));
  });

  if (existing) {
    if (existing.reasoning) {
      root.reasoning.hidden = false;
      root.reasoningLabel.textContent = 'Thought process';
      root.reasoningBody.textContent = existing.reasoning;
      root.reasoning.classList.add('open');
    }
    if (existing.content) root.content.innerHTML = renderMarkdown(existing.content);
    if (existing.toolCards) {
      for (const tc of existing.toolCards) root.tools.appendChild(makeToolCard(tc.name, tc.args, tc.result, 'done'));
    }
  }
  refreshIcons();
  return root;
}

function makeToolCard(name, args, result, status) {
  const card = document.createElement('div');
  card.className = `tool-card ${status}`;
  card.innerHTML = `
    <button class="tool-head" type="button">
      <span class="tool-dot"></span>
      <i data-lucide="${toolIcon(name)}" class="${status === 'live' ? 'spin' : ''}"></i>
      <span class="tool-name">${esc(name)}</span>
      <span class="tool-args">${esc(summarizeArgs(args))}</span>
      <i data-lucide="chevron-down" class="chev"></i>
    </button>
    <div class="tool-body"></div>`;
  if (result != null) $('.tool-body', card).textContent = result;
  card.querySelector('.tool-head').addEventListener('click', () => card.classList.toggle('open'));
  refreshIcons();
  return card;
}

function toolIcon(name) {
  return {
    fetch_url: 'globe', search_web: 'search', run_js: 'terminal',
    github_repo: 'github', think: 'brain',
  }[name] || 'wrench';
}

function summarizeArgs(args) {
  try {
    const a = typeof args === 'string' ? JSON.parse(args || '{}') : (args || {});
    return Object.entries(a).map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`).join(' · ') || '';
  } catch (e) { return String(args || '').slice(0, 60); }
}

function makeNoteCard(label, icon, live = false) {
  const card = document.createElement('div');
  card.className = `tool-card ${live ? 'live' : 'done'} note-card`;
  card.innerHTML = `
    <button class="tool-head" type="button">
      <span class="tool-dot"></span>
      <i data-lucide="${icon}"></i>
      <span class="tool-name">${esc(label)}</span>
      <i data-lucide="chevron-down" class="chev"></i>
    </button>
    <div class="tool-body"></div>`;
  card.querySelector('.tool-head').addEventListener('click', () => card.classList.toggle('open'));
  refreshIcons();
  return card;
}

/* ---------------- composer / popovers ---------------- */

const promptInput = $('#promptInput');
const composer = $('#composer');

function closeAllPopovers() {
  for (const p of ['#popModel', '#popThought', '#popGitHub']) {
    const el = $(p);
    el.hidden = true;
  }
  $('#btnModel').setAttribute('aria-expanded', 'false');
  $('#btnThought').setAttribute('aria-expanded', 'false');
}

function togglePopover(popSel, btnSel, onOpen) {
  const pop = $(popSel);
  const willOpen = pop.hidden;
  closeAllPopovers();
  if (willOpen) {
    pop.hidden = false;
    $(btnSel).setAttribute('aria-expanded', 'true');
    if (onOpen) onOpen();
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.popover') && !e.target.closest('#btnModel') && !e.target.closest('#btnThought') && !e.target.closest('#btnGitHub')) {
    closeAllPopovers();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllPopovers();
});

/* model popover */
let modelTab = 'mine';

$('#btnModel').addEventListener('click', () => {
  togglePopover('#popModel', '#btnModel', async () => {
    renderModelPopover();
    if (modelTab === 'free' && !state.freeFetched) {
      await loadFreeModels();
      renderModelPopover();
      if (!findModel(state.selectedModelId)) selectModel(defaultModel());
    }
  });
});

function renderModelPopover() {
  const body = $('#popModelBody');
  $$('.pop-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === modelTab));
  const models = modelTab === 'mine' ? state.myModels : state.freeModels;
  const selected = defaultModel();
  if (!models.length) {
    if (modelTab === 'mine') {
      body.innerHTML = `<div class="pop-empty">
        <i data-lucide="plug-zap"></i>
        <p>No models yet. Add one in <code>models.json</code>:<br><code>{ "baseUrl", "apiKey", "model", "name", "icon" }</code></p>
      </div>`;
    } else {
      body.innerHTML = `<div class="pop-skel"><div class="skel-row"></div><div class="skel-row"></div><div class="skel-row"></div></div>`;
    }
    refreshIcons();
    return;
  }
  body.innerHTML = '';
  for (const m of models) {
    const row = document.createElement('button');
    row.className = `model-row${selected && modelUid(selected) === modelUid(m) ? ' selected' : ''}`;
    row.setAttribute('data-testid', `model-row-${m.id}`);
    row.innerHTML = `
      ${avatarHTML(m)}
      <span class="model-info">
        <span class="model-name">${esc(m.name)}</span>
        <span class="model-company">${esc(m.company)}</span>
      </span>
      <span class="model-badges">
        ${m.source === 'free' ? '<span class="mbadge free">FREE</span>' : ''}
        ${m.reasoning ? '<span class="mbadge reasoning"><i data-lucide="brain"></i></span>' : ''}
        ${m.tools ? '<span class="mbadge tools"><i data-lucide="wrench"></i></span>' : ''}
        ${m.vision ? '<span class="mbadge vision"><i data-lucide="eye"></i></span>' : ''}
      </span>`;
    row.addEventListener('click', () => {
      selectModel(m);
      closeAllPopovers();
    });
    body.appendChild(row);
  }
  refreshIcons();
}

$$('.pop-tab').forEach(t => t.addEventListener('click', async () => {
  modelTab = t.dataset.tab;
  renderModelPopover();
  if (modelTab === 'free' && !state.freeFetched) {
    await loadFreeModels();
    renderModelPopover();
    if (!findModel(state.selectedModelId)) selectModel(defaultModel());
  }
}));

function selectModel(m) {
  if (!m) return;
  state.selectedModelId = modelUid(m);
  saveSettings();
  updateModelChip();
}

function updateModelChip() {
  const m = defaultModel();
  $('#modelChipIcon').innerHTML = m ? avatarHTML(m, 'chip-icon') : '';
  $('#modelChipLabel').textContent = m ? m.name : 'No model';
  const auto = $('#btnAuto');
  auto.classList.toggle('on', state.autoMode);
  auto.setAttribute('aria-pressed', String(state.autoMode));
}

/* thought popover */
$('#btnThought').addEventListener('click', () => {
  togglePopover('#popThought', '#btnThought', () => renderThoughtPopover());
});

function renderThoughtPopover() {
  const body = $('#popThoughtBody');
  body.innerHTML = '';
  for (const lv of THOUGHT_LEVELS) {
    const row = document.createElement('button');
    row.className = `thought-row${state.thoughtLevel === lv.id ? ' selected' : ''}`;
    row.innerHTML = `<i data-lucide="${lv.id === 'off' ? 'zap-off' : 'brain'}"></i>
      <span><span class="t-name">${lv.name}</span><br><span class="t-desc">${lv.desc}</span></span>`;
    row.addEventListener('click', () => {
      state.thoughtLevel = lv.id;
      saveSettings();
      $('#thoughtChipLabel').textContent = lv.name;
      closeAllPopovers();
    });
    body.appendChild(row);
  }
  refreshIcons();
}

/* auto mode */
$('#btnAuto').addEventListener('click', () => {
  state.autoMode = !state.autoMode;
  saveSettings();
  updateModelChip();
  toast(state.autoMode ? 'Auto mode on — plan, draft, polish' : 'Auto mode off');
});

/* ---------------- attachments ---------------- */

$('#btnAttach').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', (e) => {
  for (const f of e.target.files) addAttachment(f);
  e.target.value = '';
});

function addAttachment(file) {
  const isImage = /^image\//.test(file.type);
  if (isImage) {
    const reader = new FileReader();
    reader.onload = () => {
      state.attachments.push({ name: file.name, kind: 'image', data: reader.result, type: file.type });
      renderAttachments();
    };
    reader.readAsDataURL(file);
  } else {
    const reader = new FileReader();
    reader.onload = () => {
      state.attachments.push({ name: file.name, kind: 'text', data: String(reader.result).slice(0, 60000) });
      renderAttachments();
    };
    reader.readAsText(file);
  }
}

function renderAttachments() {
  const tray = $('#attachments');
  tray.hidden = state.attachments.length === 0;
  tray.innerHTML = '';
  state.attachments.forEach((a, i) => {
    const chip = document.createElement('span');
    chip.className = 'attachment-chip';
    chip.innerHTML = `${a.kind === 'image' ? `<img src="${a.data}" alt="">` : '<i data-lucide="file-text"></i>'}
      <span class="att-name">${esc(a.name)}</span>
      <button aria-label="Remove ${esc(a.name)}"><i data-lucide="x"></i></button>`;
    chip.querySelector('button').addEventListener('click', () => {
      state.attachments.splice(i, 1);
      renderAttachments();
    });
    tray.appendChild(chip);
  });
  refreshIcons();
}

/* ---------------- github connector ---------------- */

$('#btnGitHub').addEventListener('click', () => {
  togglePopover('#popGitHub', '#btnGitHub', () => {
    const st = $('#ghStatus');
    if (state.ghRepo) {
      st.className = 'gh-status ok';
      st.textContent = `Connected: ${state.ghRepo.full_name}`;
    } else {
      st.className = 'gh-status';
      st.textContent = '';
    }
    $('#ghInput').value = state.ghRepo ? state.ghRepo.full_name : '';
    setTimeout(() => $('#ghInput').focus(), 50);
  });
});

$('#ghForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = $('#ghInput').value.trim();
  const st = $('#ghStatus');
  const match = /github\.com\/([^/\s]+)\/([^/\s#]+)/.exec(raw);
  const repo = match ? `${match[1]}/${match[2]}` : raw.replace(/^\/+|\/+$/g, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    st.className = 'gh-status err';
    st.textContent = 'Use the form owner/repo (or a GitHub URL).';
    return;
  }
  st.className = 'gh-status busy';
  st.textContent = 'Checking repository…';
  const btn = $('.gh-form .btn-mini');
  btn.disabled = true;
  try {
    const info = await ghApi(`repos/${repo}`);
    let readmeExcerpt = '';
    try {
      const readme = await ghApi(`repos/${repo}/readme`);
      readmeExcerpt = decodeBase64Utf8(readme.content || '').slice(0, 6000);
    } catch (err) { /* no readme — fine */ }
    state.ghRepo = { owner: info.owner.login, name: info.name, full_name: info.full_name, description: info.description || '' };
    state.ghContext = readmeExcerpt;
    st.className = 'gh-status ok';
    st.textContent = `Connected: ${state.ghRepo.full_name}`;
    $('#btnGitHub').classList.add('on');
    renderGhChip();
    toast(`Connected to ${state.ghRepo.full_name}`);
  } catch (err) {
    st.className = 'gh-status err';
    st.textContent = `Could not reach ${repo} — ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

function renderGhChip() {
  let chip = $('#ghChip');
  if (!state.ghRepo) { if (chip) chip.remove(); return; }
  if (!chip) {
    chip = document.createElement('span');
    chip.id = 'ghChip';
    chip.className = 'gh-chip';
    $('.composer-controls').appendChild(chip);
  }
  chip.innerHTML = `<i data-lucide="github"></i><span>${esc(state.ghRepo.full_name)}</span>
    <button aria-label="Disconnect repository"><i data-lucide="x"></i></button>`;
  chip.querySelector('button').addEventListener('click', () => {
    state.ghRepo = null;
    state.ghContext = null;
    $('#btnGitHub').classList.remove('on');
    renderGhChip();
    toast('Repository disconnected');
  });
  refreshIcons();
}

async function ghApi(path) {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function decodeBase64Utf8(b64) {
  try {
    const bin = atob(b64.replace(/\n/g, ''));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch (e) { return ''; }
}

/* ---------------- tool executors ---------------- */

async function execFetchUrl(args) {
  const url = String(args.url || '').trim();
  if (!/^https?:\/\//.test(url)) throw new Error('URL must start with http:// or https://');
  const res = await fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  return text.slice(0, 12000);
}

async function execSearchWeb(args) {
  const q = String(args.query || '');
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*&srlimit=6`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);
  const data = await res.json();
  const hits = (data.query?.search) || [];
  if (!hits.length) return 'No results found.';
  return hits.map(h => `- ${h.title}: ${String(h.snippet || '').replace(/<[^>]+>/g, '')}`).join('\n');
}

function execRunJs(args) {
  const code = String(args.code || '');
  const logs = [];
  const fmt = (v) => {
    try { return typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { return String(v); }
  };
  const sandboxConsole = { log: (...a) => logs.push(a.map(fmt).join(' ')) };
  const fn = new Function('console', `"use strict";\n${code}`);
  const result = fn(sandboxConsole);
  let out = '';
  if (logs.length) out += logs.join('\n');
  if (result !== undefined) out += (out ? '\n' : '') + `→ ${fmt(result)}`;
  return out || '(no output — use console.log to print results)';
}

async function execGithubRepo(args) {
  const action = String(args.action || 'info');
  let repo = String(args.repo || '').trim();
  if (!repo && state.ghRepo) repo = state.ghRepo.full_name;
  if (!repo) throw new Error('No repository specified or connected.');
  repo = repo.replace(/^github\.com\//, '');
  if (action === 'info') {
    const info = await ghApi(`repos/${repo}`);
    let out = `Repo: ${info.full_name}\nStars: ${info.stargazers_count} · Forks: ${info.forks_count}\nLanguage: ${info.language || '—'}\nDescription: ${info.description || '—'}\nDefault branch: ${info.default_branch}`;
    try {
      const readme = await ghApi(`repos/${repo}/readme`);
      const text = decodeBase64Utf8(readme.content || '');
      out += `\n\n--- README (excerpt) ---\n${text.slice(0, 6000)}`;
    } catch (e) { /* skip readme */ }
    return out;
  }
  if (action === 'tree') {
    const info = await ghApi(`repos/${repo}`);
    const tree = await ghApi(`repos/${repo}/git/trees/${info.default_branch}?recursive=1`);
    const paths = (tree.tree || []).map(t => t.path).filter(p => !p.includes('node_modules/'));
    return `Files (${paths.length}):\n${paths.slice(0, 400).join('\n')}`;
  }
  if (action === 'file') {
    const path = String(args.path || '').replace(/^\/+/, '');
    const file = await ghApi(`repos/${repo}/contents/${encodeURIComponent(path)}`);
    if (Array.isArray(file)) return `That path is a directory containing: ${file.map(f => f.name).join(', ')}`;
    const text = decodeBase64Utf8(file.content || '');
    if (!text) throw new Error(`File is binary or empty (${file.size || 0} bytes).`);
    return text.slice(0, 12000);
  }
  throw new Error(`Unknown action "${action}"`);
}

async function executeTool(name, args) {
  switch (name) {
    case 'fetch_url': return await execFetchUrl(args);
    case 'search_web': return await execSearchWeb(args);
    case 'run_js': return execRunJs(args);
    case 'github_repo': return await execGithubRepo(args);
    case 'think': return 'ok';
    default: throw new Error(`Unknown tool "${name}"`);
  }
}

/* ---------------- LLM transport ---------------- */

async function chatOnce(model, messages, opts = {}) {
  const { tools = null, onReasoning = null, onContent = null, signal = null } = opts;
  const body = {
    model: model.model,
    messages,
    stream: true,
  };
  if (tools && model.tools !== false) body.tools = tools;

  const headers = { 'Content-Type': 'application/json' };
  if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;

  let res;
  try {
    res = await fetch(model.baseUrl, {
      method: 'POST', headers, body: JSON.stringify(body), signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error(`Network error reaching ${new URL(model.baseUrl).host}`);
  }

  if (res.status === 429) {
    toast('Free tier is rate-limited — waiting ~12s before retrying…', 'err');
    await sleep(12000);
    return chatOnce(model, messages, opts);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch (e) { /* ignore */ }
    const err = new Error(`HTTP ${res.status} ${detail}`);
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  const toolCalls = []; // {id, function:{name, arguments}}

  const handleDelta = (delta) => {
    if (delta.reasoning || delta.reasoning_content) {
      reasoning += (delta.reasoning || delta.reasoning_content);
      if (onReasoning) onReasoning(reasoning, false);
    }
    if (delta.content) {
      content += delta.content;
      if (onContent) onContent(content, false);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const i = tc.index ?? toolCalls.length;
        if (!toolCalls[i]) toolCalls[i] = { id: tc.id || '', function: { name: '', arguments: '' } };
        if (tc.id) toolCalls[i].id = tc.id;
        if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
        const delta = json.choices?.[0]?.delta;
        if (delta) handleDelta(delta);
        const msg = json.choices?.[0]?.message;
        if (msg) {
          if (msg.reasoning || msg.reasoning_content) {
            reasoning += (msg.reasoning || msg.reasoning_content);
            if (onReasoning) onReasoning(reasoning, false);
          }
          if (msg.content && typeof msg.content === 'string') {
            content += msg.content;
            if (onContent) onContent(content, false);
          }
          if (Array.isArray(msg.tool_calls)) {
            for (const tc of msg.tool_calls) {
              toolCalls.push({ id: tc.id || `call_${uid()}`, function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' } });
            }
          }
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue; // partial json line, skip
        throw e;
      }
    }
  }
  if (onReasoning && reasoning) onReasoning(reasoning, true);
  if (onContent && content) onContent(content, true);
  return { content, reasoning, toolCalls: toolCalls.filter(t => t.function.name) };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------------- system prompt ---------------- */

function buildSystemPrompt() {
  let sys = `You are Prism, a capable AI agent inside a minimal web workspace. Today is ${new Date().toDateString()}.

Guidelines:
- Be direct, precise and genuinely useful. Format with markdown when it helps.
- You may have tools available (fetch_url, search_web, run_js, github_repo, think). Use them when they genuinely help — for research, verification, math, code, or reading the connected repository.
- If a tool fails, errors out, or is unavailable, don't dwell: note it briefly (or not at all) and continue with your best answer without it.
- Never invent tool results or URLs you didn't actually retrieve.
${THOUGHT_PROMPTS[state.thoughtLevel] || ''}`;
  if (state.ghRepo) {
    sys += `\n\nThe user has connected the GitHub repository ${state.ghRepo.full_name}${state.ghRepo.description ? ` (${state.ghRepo.description})` : ''}. Use the github_repo tool to inspect it when relevant.`;
    if (state.ghContext) sys += `\n\nExcerpt of its README:\n${state.ghContext.slice(0, 4000)}`;
  }
  return sys;
}

/* ---------------- send flow ---------------- */

function setGenerating(on) {
  state.generating = on;
  const btn = $('#btnSend');
  btn.classList.toggle('stop', on);
  btn.setAttribute('aria-label', on ? 'Stop generating' : 'Send message');
  btn.innerHTML = `<i data-lucide="${on ? 'square' : 'arrow-up'}"></i>`;
  refreshIcons();
  promptInput.disabled = on;
}

async function handleSend() {
  if (state.generating) {
    state.controller?.abort();
    return;
  }
  const text = promptInput.value.trim();
  if (!text && !state.attachments.length) return;
  const model = defaultModel();
  if (!model) {
    toast('No model available — check the Free tab or models.json', 'err');
    return;
  }

  state.controller = new AbortController();
  setGenerating(true);

  // conversation bookkeeping
  let convo = currentConversation();
  if (!convo) {
    convo = { id: uid(), title: text.slice(0, 48) || 'New chat', history: [], createdAt: nowSec() };
    state.conversations.unshift(convo);
    state.currentId = convo.id;
    showEmpty(false);
    renderChatList();
  }
  $('#topbarTitle').textContent = convo.title;

  const inner = ensureMessagesInner();

  // build user message
  const files = state.attachments.slice();
  const userMsgEl = document.createElement('div');
  userMsgEl.className = 'msg msg-user';
  const visionModel = model.vision !== false;
  let apiContent;
  if (files.some(f => f.kind === 'image') && visionModel) {
    apiContent = [
      { type: 'text', text: text || 'Describe the attached file(s).' },
      ...files.filter(f => f.kind === 'image').map(f => ({ type: 'image_url', image_url: { url: f.data } })),
    ];
  } else {
    apiContent = text;
    const textFiles = files.filter(f => f.kind === 'text');
    if (textFiles.length) {
      apiContent += '\n\n' + textFiles.map(f => `[File: ${f.name}]\n${f.data}`).join('\n\n');
    }
  }
  const userMsg = { role: 'user', content: apiContent, files };
  convo.history.push(userMsg);

  userMsgEl.innerHTML = `<div class="bubble">${files.length ? `<div class="msg-files">${files.map(f => f.kind === 'image'
    ? `<img class="thumb" src="${f.data}" alt="${esc(f.name)}">`
    : `<span class="file-pill"><i data-lucide="file-text"></i>${esc(f.name)}</span>`).join('')}</div>` : ''}${esc(text)}</div>`;
  inner.appendChild(userMsgEl);
  refreshIcons();

  promptInput.value = '';
  autoGrow();
  state.attachments = [];
  renderAttachments();
  scrollToBottom();

  // assistant message scaffold
  const ui = buildAssistantMessage(model);
  inner.appendChild(ui.el);

  const history = () => convo.history;
  const sys = { role: 'system', content: buildSystemPrompt() };

  try {
    if (state.autoMode) {
      await runEnsemble(model, convo, ui, sys, state.controller.signal);
    } else {
      await agentLoop(model, convo, ui, sys, state.controller.signal);
    }
    saveConversations();
  } catch (e) {
    if (e.name === 'AbortError') {
      ui.content.innerHTML += renderMarkdown('\n\n*— stopped —*');
    } else {
      const msg = e.status === 401 || e.status === 403
        ? `Authentication failed (HTTP ${e.status}) — check the API key for this model in models.json.`
        : friendlyError(e);
      ui.content.innerHTML = renderMarkdown(`**Something went wrong.** ${esc(msg)}`);
      toast(String(e.message || e).slice(0, 120), 'err');
    }
  } finally {
    setGenerating(false);
    scrollToBottom();
  }
}

function friendlyError(e) {
  const m = String(e.message || e);
  if (/network error|failed to fetch/i.test(m)) return 'Could not reach the model endpoint. Check the URL in models.json, or the model may be offline.';
  if (/HTTP 4(0[0-9])?/.test(m)) return m;
  return m;
}

/* ---------------- agent loop (single model) ---------------- */

async function agentLoop(model, convo, ui, sys, signal, opts = {}) {
  const maxRounds = opts.maxRounds ?? 6;
  const showTools = opts.showTools !== false;
  let usedTools = false;

  for (let round = 0; round < maxRounds; round++) {
    const messages = [sys, ...convo.history.slice(-24)];
    let res;
    try {
      res = await chatOnce(model, messages, {
        tools: model.tools !== false ? TOOLS : null,
        signal,
        onReasoning: (r, done) => updateReasoning(ui, r, done),
        onContent: (c, done) => updateContent(ui, c, done, round === 0 && !usedTools),
      });
    } catch (e) {
      // some endpoints reject tools — retry once without them, then give up on the feature
      if (e.status === 400 && model.tools !== false) {
        model.tools = false;
        continue;
      }
      throw e;
    }

    if (res.reasoning) ui.msgReasoning = res.reasoning;

    if (res.toolCalls.length) {
      usedTools = true;
      const assistantMsg = { role: 'assistant', content: res.content || '', tool_calls: res.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: tc.function })) };
      if (res.reasoning) assistantMsg.reasoning = res.reasoning;
      convo.history.push(assistantMsg);

      for (const tc of res.toolCalls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (err) { /* keep raw */ }
        const card = showTools ? makeToolCard(tc.function.name, tc.function.arguments, null, 'live') : null;
        if (card) ui.tools.appendChild(card);
        let result;
        try {
          result = await executeTool(tc.function.name, args);
          if (card) {
            card.classList.remove('live'); card.classList.add('done');
            $('.tool-body', card).textContent = String(result).slice(0, 2000);
          }
        } catch (err) {
          result = `Error: ${err.message}`;
          if (card) {
            card.classList.remove('live'); card.classList.add('error');
            $('.tool-body', card).textContent = result;
          }
        }
        convo.history.push({ role: 'tool', tool_call_id: tc.id, content: String(result).slice(0, 12000) });
        scrollToBottom();
      }
      continue;
    }

    // final answer
    if (res.content) {
      if (ui.msgReasoning === undefined && res.reasoning) ui.msgReasoning = res.reasoning;
      convo.history.push({
        role: 'assistant',
        content: res.content,
        reasoning: ui.msgReasoning || res.reasoning || undefined,
        modelInfo: { name: model.name, company: model.company, icon: model.icon },
        toolCards: collectToolCards(ui),
      });
    } else if (!usedTools) {
      throw new Error('The model returned an empty response. Try again or switch models.');
    }
    return;
  }
  throw new Error('The agent hit its tool-use limit. Try rephrasing the request.');
}

function collectToolCards(ui) {
  return $$('.tool-card', ui.tools).map(c => ({
    name: $('.tool-name', c)?.textContent || '',
    args: $('.tool-args', c)?.textContent || '',
    result: $('.tool-body', c)?.textContent || '',
  }));
}

/* ---------------- ensemble (auto mode) ---------------- */

function isPlaceholderModel(m) {
  return /REPLACE-ME|YOUR.?KEY|sk-\.\.\./i.test(m.apiKey || '');
}

function pickEnsembleModels(lead) {
  const models = allModels().filter(m => !isPlaceholderModel(m) && modelUid(m) !== modelUid(lead));
  // prefer the user's own working models, then free ones
  const own = models.filter(m => m.source === 'mine');
  const free = models.filter(m => m.source === 'free');
  return {
    planner: lead,
    drafter: own[0] || free[0] || lead,
    polisher: own[1] || own[0] || free[0] || lead,
  };
}

async function runEnsemble(lead, convo, ui, sys, signal) {
  const { planner, drafter, polisher } = pickEnsembleModels(lead);
  ui.stageBar.hidden = false;
  const stages = {
    plan: $('[data-stage="plan"]', ui.stageBar),
    draft: $('[data-stage="draft"]', ui.stageBar),
    polish: $('[data-stage="polish"]', ui.stageBar),
  };
  const setStage = (name, cls) => {
    stages[name].className = `stage ${cls}`;
    refreshIcons();
  };

  // ---------- stage 1: plan ----------
  setStage('plan', 'active');
  const planCard = makeNoteCard(`Plan · ${planner.name}`, 'list-tree', true);
  ui.tools.appendChild(planCard);
  let plan = '';
  try {
    const planRes = await chatOnce(planner, [
      { role: 'system', content: buildSystemPrompt() + '\n\nYou are the PLANNING stage of a multi-model pipeline. Produce a concise plan (bullet points) for how to best answer the user. Do not write the answer itself.' },
      ...convo.history.slice(-24),
    ], { signal });
    plan = planRes.content;
    planCard.querySelector('.tool-body').textContent = plan || '(empty plan)';
    planCard.classList.add('open');
    setStage('plan', 'done');
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    planCard.querySelector('.tool-body').textContent = 'Planning stage skipped.';
    setStage('plan', 'done');
  }

  // ---------- stage 2: draft (with tools) ----------
  setStage('draft', 'active');
  const draftCard = makeNoteCard(`Draft · ${drafter.name}`, 'pen-line', true);
  ui.tools.appendChild(draftCard);
  const baseLen = convo.history.length;
  const draftConvo = { history: [...convo.history] };
  if (plan) draftConvo.history.push({ role: 'user', content: `[Pipeline guidance — a planning model produced this approach; follow it if sensible]\n${plan}` });
  let draft = '';
  try {
    const draftBody = draftCard.querySelector('.tool-body');
    draftBody.classList.add('md');
    const draftUi = {
      el: draftCard,
      reasoning: ui.reasoning, reasoningBody: ui.reasoningBody, reasoningLabel: ui.reasoningLabel,
      tools: ui.tools, content: draftBody, stageBar: ui.stageBar, msgReasoning: undefined,
    };
    draftCard.classList.add('open');
    await agentLoop(drafter, draftConvo, draftUi, sys, signal, { showTools: true });
    // extract the final draft text; keep tool exchanges, drop the synthetic plan message
    const finalMsg = draftConvo.history[draftConvo.history.length - 1];
    if (finalMsg && finalMsg.role === 'assistant' && !finalMsg.tool_calls) draftConvo.history.pop();
    draft = (finalMsg && finalMsg.role === 'assistant') ? (finalMsg.content || '') : '';
    for (const m of draftConvo.history.slice(baseLen + 1)) convo.history.push(m);
    draftBody.classList.remove('md');
    draftBody.innerHTML = renderMarkdown(draft.slice(0, 4000) || '*(empty draft)*');
    setStage('draft', 'done');
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    draftCard.querySelector('.tool-body').textContent = 'Draft stage failed — continuing with plan only.';
    setStage('draft', 'done');
  }
  if (!draft) draft = plan || '';

  // ---------- stage 3: polish ----------
  setStage('polish', 'active');
  const polishPrompt = [
    { role: 'system', content: buildSystemPrompt() + '\n\nYou are the FINAL POLISH stage of a multi-model pipeline. Take the draft below and produce the definitive answer: correct errors, connect ideas, improve structure and flow, and make sure it fully addresses the user. Write the final answer directly — do not mention the pipeline or the draft.' },
    ...convo.history.slice(-24),
    { role: 'user', content: `[Draft to polish and improve — do not just repeat it]\n${draft.slice(0, 12000)}` },
  ];
  let polishModel = polisher;
  if (modelUid(polishModel) === modelUid(lead)) polishModel = lead; // dedupe
  try {
    const polishRes = await chatOnce(polishModel, polishPrompt, {
      signal,
      onReasoning: (r, done) => updateReasoning(ui, r, done),
      onContent: (c, done) => updateContent(ui, c, done, false),
    });
    const finalContent = polishRes.content || draft;
    convo.history.push({
      role: 'assistant',
      content: finalContent,
      reasoning: polishRes.reasoning || undefined,
      modelInfo: { name: `${polishModel.name} (auto)`, company: polishModel.company, icon: polishModel.icon },
      toolCards: collectToolCards(ui),
    });
    setStage('polish', 'done');
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    // polisher failed — try once more with the lead model before falling back to the raw draft
    if (modelUid(polishModel) !== modelUid(lead)) {
      try {
        const retry = await chatOnce(lead, polishPrompt, {
          signal,
          onReasoning: (r, done) => updateReasoning(ui, r, done),
          onContent: (c, done) => updateContent(ui, c, done, false),
        });
        const finalContent = retry.content || draft;
        convo.history.push({
          role: 'assistant',
          content: finalContent,
          reasoning: retry.reasoning || undefined,
          modelInfo: { name: `${lead.name} (auto)`, company: lead.company, icon: lead.icon },
          toolCards: collectToolCards(ui),
        });
        setStage('polish', 'done');
        return;
      } catch (e2) {
        if (e2.name === 'AbortError') throw e2;
      }
    }
    // fall back to the draft as the final answer
    if (draft) {
      ui.content.innerHTML = renderMarkdown(draft);
      convo.history.push({
        role: 'assistant',
        content: draft,
        modelInfo: { name: `${drafter.name} (auto, unpolished)`, company: drafter.company, icon: drafter.icon },
        toolCards: collectToolCards(ui),
      });
    } else {
      throw e;
    }
    setStage('polish', 'done');
  }
}

/* ---------------- streaming UI helpers ---------------- */

function updateReasoning(ui, text, done) {
  if (!ui.reasoning) return;
  ui.reasoning.hidden = false;
  if (done) {
    ui.reasoning.classList.remove('live', 'open');
    const secs = ui.reasoningStart ? Math.max(1, Math.round((Date.now() - ui.reasoningStart) / 1000)) : null;
    ui.reasoningLabel.textContent = secs ? `Thought for ${secs}s` : 'Thought process';
    ui.reasoningBody.textContent = text;
  } else {
    if (!ui.reasoning.classList.contains('live')) {
      ui.reasoning.classList.add('live', 'open');
      ui.reasoningStart = Date.now();
      ui.reasoningLabel.textContent = 'Thinking…';
    }
    ui.reasoningBody.textContent = text;
    scrollToBottom(true);
  }
}

function updateContent(ui, text, done, first) {
  if (first && !ui.contentShown) {
    ui.content.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    ui.contentShown = true;
    scrollToBottom(true);
  }
  if (text) {
    ui.content.innerHTML = renderMarkdown(text) + (done ? '' : ' <span class="caret"></span>');
    refreshIcons();
    scrollToBottom(true);
  }
}

let autoScroll = true;
messagesEl.addEventListener('scroll', () => {
  autoScroll = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
});
function scrollToBottom(force = false) {
  if (force || autoScroll) messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ---------------- misc wiring ---------------- */

function autoGrow() {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 200) + 'px';
}
promptInput.addEventListener('input', autoGrow);
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

$('#btnSend').addEventListener('click', handleSend);

$('#btnNewChat').addEventListener('click', newChat);

$('#btnAbout').addEventListener('click', () => $('#aboutDialog').showModal());
$('#aboutClose').addEventListener('click', () => $('#aboutDialog').close());
$('#aboutDialog').addEventListener('click', (e) => {
  if (e.target === $('#aboutDialog')) $('#aboutDialog').close();
});

$$('.suggestion').forEach(btn => btn.addEventListener('click', () => {
  promptInput.value = btn.dataset.prompt || '';
  autoGrow();
  promptInput.focus();
  handleSend();
}));

/* code copy delegation */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.code-copy');
  if (!btn) return;
  const pre = btn.closest('pre');
  const code = pre ? pre.querySelector('code') : null;
  if (code) {
    navigator.clipboard?.writeText(code.textContent || '').then(() => {
      btn.innerHTML = '<i data-lucide="check"></i>Copied';
      refreshIcons();
      setTimeout(() => { btn.innerHTML = '<i data-lucide="copy"></i>Copy'; refreshIcons(); }, 1600);
    });
  }
});

/* mobile sidebar */
function closeSidebarMobile() {
  $('#sidebar').classList.remove('open');
  $('#sidebarScrim').classList.remove('visible');
}
$('#btnMenu').addEventListener('click', () => {
  $('#sidebar').classList.add('open');
  $('#sidebarScrim').hidden = false;
  requestAnimationFrame(() => $('#sidebarScrim').classList.add('visible'));
});
$('#sidebarScrim').addEventListener('click', closeSidebarMobile);

/* ---------------- boot ---------------- */

async function boot() {
  loadPersisted();
  await loadMyModels();
  await loadFreeModels();
  const m = defaultModel();
  if (m && !state.selectedModelId) state.selectedModelId = modelUid(m);
  updateModelChip();
  $('#thoughtChipLabel').textContent = (THOUGHT_LEVELS.find(l => l.id === state.thoughtLevel) || THOUGHT_LEVELS[2]).name;
  renderChatList();
  // open the most recent conversation if one exists
  if (state.conversations.length) {
    openConversation(state.conversations[0].id);
  } else {
    showEmpty(true);
  }
  refreshIcons();
  autoGrow();
}

boot();
