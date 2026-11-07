const $ = selector => document.querySelector(selector);
const names = { user: 'You', codex: 'Codex', claude: 'Claude Code', both: 'Codex and Claude' };
let state = { rooms: [], auth: {}, runtime: {} }, selected = localStorage.getItem('roundtable-room'), posting = false, requesting = false;
let connected = true;
let menuRoom = null;
function closeMenu() { $('#room-menu').hidden = true; menuRoom = null; }
function removeRoom(id) {
  state.rooms = state.rooms.filter(room => room.id !== id);
  if (selected === id) {
    selected = [...state.rooms].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id || null;
    if (selected) localStorage.setItem('roundtable-room', selected); else localStorage.removeItem('roundtable-room');
    $('#message').value = '';
  }
  if (menuRoom === id) closeMenu();
  render();
}
function showRoomMenu(event, room, button) {
  event.preventDefault(); menuRoom = room.id;
  const menu = $('#room-menu'); menu.hidden = false;
  const bounds = button.getBoundingClientRect();
  const x = event.clientX || bounds.left + 12, y = event.clientY || bounds.bottom;
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
  $('#delete-room').disabled = state.runtime.active?.room === room.id;
  $('#delete-room').title = $('#delete-room').disabled ? 'Stop the active response first' : 'Move this transcript to the Recycle Bin';
  $('#rename-room').focus();
}
const escapeHTML = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function format(text) {
  // Escape first; never interpret model-generated HTML or load remote images.
  return text.split(/(```[\s\S]*?```)/g).map(part => {
    if (part.startsWith('```')) return `<pre><code>${escapeHTML(part.replace(/^```[^\n]*\n?/, '').replace(/```$/, ''))}</code></pre>`;
    return escapeHTML(part).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  }).join('');
}
function notice(text = '') { $('#notice').textContent = text; $('#notice').hidden = !text; }
async function api(url, data) {
  const res = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Roundtable-Token': state.csrf }, body: JSON.stringify(data) });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Request failed');
  return result;
}
function current() { return state.rooms.find(r => r.id === selected); }
function choose(id) { selected = id; localStorage.setItem('roundtable-room', id); render(); $('#conversation').scrollTop = $('#conversation').scrollHeight; }
function upsert(room) { const i = state.rooms.findIndex(r => r.id === room.id); if (i < 0) state.rooms.push(room); else state.rooms[i] = room; }
function render() {
  const room = current(), active = state.runtime.active;
  $('#rooms').replaceChildren(...[...state.rooms].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(room => {
    const button = document.createElement('button'); button.className = `room${room.id === selected ? ' selected' : ''}`;
    button.textContent = room.title; button.title = room.title; button.onclick = () => { closeMenu(); choose(room.id); };
    button.setAttribute('aria-haspopup', 'menu');
    button.oncontextmenu = event => showRoomMenu(event, room, button);
    button.onkeydown = event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showRoomMenu(event, room, button); };
    return button;
  }));
  $('#welcome').hidden = Boolean(room?.messages.length);
  const pane = $('#conversation'), nearBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 100;
  const messageList = $('#messages');
  if (messageList.dataset.room !== (room?.id || '')) { messageList.replaceChildren(); messageList.dataset.room = room?.id || ''; }
  for (const msg of room?.messages || []) {
    let container = messageList;
    if (msg.round) {
      container = document.getElementById(`round-${msg.round}`);
      if (!container) {
        container = document.createElement('section'); container.id = `round-${msg.round}`;
        container.className = 'independent-pair'; container.setAttribute('aria-label', 'Independent replies');
        messageList.append(container);
      }
    }
    let article = document.getElementById(`message-${msg.id}`);
    if (!article) {
      article = document.createElement('article'); article.id = `message-${msg.id}`;
      article.innerHTML = `<span class="avatar ${msg.speaker === 'user' ? 'you' : msg.speaker}">${msg.speaker === 'user' ? 'Y' : msg.speaker === 'codex' ? 'C' : '✳'}</span><div class="message-main"><div class="message-heading"><span class="speaker"></span><time class="timestamp"></time></div><div class="message-body"></div><div class="message-status"></div></div>`;
      container.append(article);
    }
    article.className = `message ${msg.speaker} ${msg.status}`;
    article.querySelector('.speaker').textContent = names[msg.speaker];
    article.querySelector('time').textContent = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const body = article.querySelector('.message-body');
    const visibleText = msg.text;
    if (body.dataset.text !== visibleText) { body.innerHTML = format(visibleText); body.dataset.text = visibleText; }
    const status = article.querySelector('.message-status');
    status.textContent = msg.status === 'pending' ? 'Waiting...' : msg.activity || (msg.status === 'stopped' ? 'Stopped' : ''); status.className = `message-status ${msg.status}`;
  }
  if (nearBottom) pane.scrollTop = pane.scrollHeight;
  const pending = (state.runtime.queue || []).reduce((n,j) => n + j.turns.length, 0);
  $('#turn-status').textContent = !connected ? 'Reconnecting to local server…' : active ? `${names[active.agent]} ${active.stopping ? 'is stopping' : (active.agent === 'both' ? 'are responding' : 'is responding')}${active.room !== selected ? ' in another conversation' : ''}${pending ? ` · ${pending} ${pending === 1 ? 'reply' : 'replies'} queued` : ''}` : 'Your turn';
  $('#stop').hidden = !active; $('#stop').disabled = Boolean(active?.stopping);
  for (const target of ['codex', 'claude', 'both']) {
    const ready = target === 'both' ? state.auth.codex?.ok && state.auth.claude?.ok : state.auth[target]?.ok;
    $(`#ask-${target}`).disabled = !connected || posting || requesting || Boolean(active) || !room?.messages.length || !ready;
  }
  $('#send').disabled = posting || !connected;
  for (const agent of ['codex', 'claude']) {
    const auth = state.auth[agent], el = $(`#${agent}-status`);
    el.textContent = `${auth?.ok ? '●' : '○'} ${agent === 'codex' ? 'Codex' : 'Claude'} · ${auth?.ok ? 'connected' : 'not connected'}`;
    el.className = auth?.ok ? 'ok' : 'error'; el.title = auth?.detail || 'Checking login';
    const context = room?.agents[agent]?.context;
    const label = $(`#${agent}-context`), meter = $(`#${agent}-meter`);
    const known = Number.isFinite(context?.inputTokens), capacity = context?.contextWindow;
    const percent = known && capacity ? Math.round(context.inputTokens / capacity * 100) : null;
    label.textContent = context?.compacting ? 'Compacting...' : known ? `${percent === null ? '' : percent + '% - '}${context.inputTokens.toLocaleString()}${capacity ? ' / ' + capacity.toLocaleString() : ''} tokens` : 'Context unavailable';
    meter.hidden = percent === null || Boolean(context?.compacting);
    meter.value = Math.min(percent || 0, 100);
    label.title = context?.measuredAt ? `Last reported input context: ${new Date(context.measuredAt).toLocaleString()}. Includes cached input; not cumulative usage or subscription allowance.` : 'Available after this agent next reports usage.';
    const compacted = $(`#${agent}-compacted`);
    compacted.hidden = !context?.lastCompactedAt;
    compacted.textContent = context?.lastCompactedAt ? `Compacted ${new Date(context.lastCompactedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}` : '';
    compacted.title = context?.lastCompactedAt ? `Last compaction: ${new Date(context.lastCompactedAt).toLocaleString()}` : '';

  }
}
function openProject() { $('#project').value = current()?.project || state.defaultProject || ''; $('#conversation-name').value = ''; $('#project-error').textContent = ''; $('#project-dialog').showModal(); }
let renameRoom = null;
$('#rename-room').onclick = () => {
  const room = state.rooms.find(r => r.id === menuRoom); if (!room) return;
  renameRoom = room.id; closeMenu();
  $('#rename-name').value = room.title; $('#rename-error').textContent = '';
  $('#rename-dialog').showModal(); $('#rename-name').select();
};
$('#cancel-rename').onclick = () => $('#rename-dialog').close();
$('#rename-form').onsubmit = async event => {
  event.preventDefault(); $('#save-rename').disabled = true;
  try { const room = await api('/api/rename-room', { room: renameRoom, name: $('#rename-name').value }); upsert(room); render(); $('#rename-dialog').close(); }
  catch (error) { $('#rename-error').textContent = error.message; }
  finally { $('#save-rename').disabled = false; }
};
document.addEventListener('pointerdown', event => { if (!$('#room-menu').contains(event.target)) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
window.addEventListener('resize', closeMenu);
$('#rooms').addEventListener('scroll', closeMenu);
$('#delete-room').onclick = async () => {
  const id = menuRoom; if (!id) return;
  $('#delete-room').disabled = true;
  try { const result = await api('/api/delete-room', { room: id }); removeRoom(id); notice(result.message); }
  catch (error) { closeMenu(); notice(error.message); }
};
$('#new-chat').onclick = openProject;
$('#close-dialog').onclick = () => $('#project-dialog').close();
$('#project-form').onsubmit = async event => {
  event.preventDefault();
  try { const room = await api('/api/rooms', { project: $('#project').value, name: $('#conversation-name').value }); upsert(room); choose(room.id); $('#project-dialog').close(); $('#message').focus(); }
  catch (error) { $('#project-error').textContent = error.message; }
};
$('#composer').onsubmit = async event => {
  event.preventDefault(); if (posting) return;
  const text = $('#message').value.trim(); if (!text) return;
  if (!current()) { openProject(); return; }
  posting = true; notice(); render();
  try { await api('/api/message', { room: selected, text }); $('#message').value = ''; $('#conversation').scrollTop = $('#conversation').scrollHeight; }
  catch (error) { notice(error.message); }
  finally { posting = false; render(); $('#message').focus(); }
};
$('#message').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#composer').requestSubmit(); } };
for (const target of ['codex', 'claude', 'both']) $(`#ask-${target}`).onclick = async () => {
  if (requesting) return;
  if ($('#message').value.trim()) { notice('Send your draft first, then choose who responds.'); $('#message').focus(); return; }
  requesting = true; notice(); render();
  try { await api('/api/respond', { room: selected, target }); }
  catch (error) { notice(error.message); }
  finally { requesting = false; render(); }
};
$('#stop').onclick = async () => { try { await api('/api/stop', {}); } catch (error) { notice(error.message); } };
$('#recheck').onclick = async () => { try { $('#recheck').disabled = true; state.auth = await api('/api/auth', {}); render(); } catch (error) { notice(error.message); } finally { $('#recheck').disabled = false; } };
for (const button of document.querySelectorAll('[data-prompt]')) button.onclick = () => { $('#message').value = button.dataset.prompt; $('#message').focus(); };
try {
  state = await api('/api/state');
  if (!current() && state.rooms.length) selected = [...state.rooms].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0].id;
  render();
  const events = new EventSource('/api/events');
  events.onmessage = event => {
    const update = JSON.parse(event.data);
    if (update.type === 'deleted') removeRoom(update.roomId);
    if (update.room) upsert(update.room);
    if (update.runtime) state.runtime = update.runtime;
    if (update.auth) state.auth = update.auth;
    render();
  };
  events.onerror = () => { connected = false; render(); };
  events.onopen = async () => { connected = true; try { state = await api('/api/state'); render(); } catch (error) { notice(error.message); } };
} catch (error) { connected = false; render(); notice(`Cannot connect to Roundtable: ${error.message}`); }
