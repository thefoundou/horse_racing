// Lobby chat. Players chat from a slide-up panel on their phones. New messages
// pop up as bubbles: scattered around the race while it runs (on the big
// screen and on phones), and in a stack in the corner of the big screen the
// rest of the time.
//
// The chat lives outside #app, so re-rendering the game never wipes what
// you're typing.

import { MAX_CHAT, type ChatMsg, type PublicState } from '../shared/protocol';
import { avatar, esc } from './ui';

let root: HTMLElement | null = null;
let list: HTMLElement | null = null;
let badge: HTMLElement | null = null;
let popsFree: HTMLElement | null = null;
let popsStack: HTMLElement | null = null;
let send: (text: string) => void = () => {};

let room = '';
let open = false;
/** Newest message id already handled (popped or skipped). */
let seen = -1;
/** Newest message id read in the panel. */
let readTo = 0;
let listKey = '';
let slot = 0;

/** Where race-time bubbles go, in turn (% of the screen): above and below the track, not over the horses. */
const SLOTS: [number, number][] = [[4, 7], [58, 80], [32, 8], [6, 82], [60, 7], [32, 86], [18, 12], [44, 78]];

function mount() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'chat';
  root.className = 'chat';
  root.innerHTML = `
    <button class="chat-toggle" id="chatToggle" aria-label="Open chat" aria-expanded="false">💬<span class="chat-badge" hidden></span></button>
    <section class="chat-panel" aria-label="Lobby chat">
      <header class="chat-head"><b>Chat</b><button class="chat-close" id="chatClose" aria-label="Close chat">✕</button></header>
      <ol class="chat-list" aria-live="polite"></ol>
      <form class="chat-form" autocomplete="off">
        <input id="chatInput" maxlength="${MAX_CHAT}" placeholder="Say something…" enterkeyhint="send" aria-label="Chat message" />
        <button class="primary" type="submit">Send</button>
      </form>
    </section>`;
  const pops = document.createElement('div');
  pops.id = 'chatPops';
  pops.setAttribute('aria-hidden', 'true');
  pops.innerHTML = '<div class="pops-free"></div><div class="pops-stack"></div>';
  document.body.append(root, pops);
  list = root.querySelector('.chat-list');
  badge = root.querySelector('.chat-badge');
  popsFree = pops.querySelector('.pops-free');
  popsStack = pops.querySelector('.pops-stack');

  const input = root.querySelector<HTMLInputElement>('#chatInput')!;
  root.querySelector('#chatToggle')!.addEventListener('click', () => setOpen(!open));
  root.querySelector('#chatClose')!.addEventListener('click', () => setOpen(false));
  root.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) return;
    send(text);
    input.value = '';
    input.focus();
  });
}

function setOpen(on: boolean) {
  open = on;
  root?.classList.toggle('open', on);
  root?.querySelector('#chatToggle')?.setAttribute('aria-expanded', String(on));
  if (on) {
    readTo = Math.max(readTo, seen);
    updateBadge(0);
    list?.lastElementChild?.scrollIntoView({ block: 'end' });
    root?.querySelector<HTMLInputElement>('#chatInput')?.focus();
  }
}

function updateBadge(n: number) {
  if (!badge) return;
  badge.hidden = n === 0;
  badge.textContent = n > 9 ? '9+' : String(n);
}

const who = (s: PublicState, m: ChatMsg) => s.players.find((p) => p.id === m.from) ?? { id: m.from, name: '?', avatar: null };

function bubble(s: PublicState, m: ChatMsg) {
  const p = who(s, m);
  return `${avatar(s.code, p)}<span><b>${esc(p.name)}</b> ${esc(m.text)}</span>`;
}

/** Pop a new message up on screen for a few seconds. */
function pop(s: PublicState, m: ChatMsg, around: boolean) {
  const el = document.createElement('div');
  el.className = 'chat-pop' + (around ? ' around' : '');
  el.innerHTML = bubble(s, m);
  if (around && popsFree) {
    const [x, y] = SLOTS[slot++ % SLOTS.length];
    el.style.left = `${x + Math.random() * 6}%`;
    el.style.top = `${y + Math.random() * 6}%`;
    el.style.setProperty('--tilt', `${(Math.random() * 6 - 3).toFixed(1)}deg`);
    popsFree.append(el);
    while (popsFree.children.length > 6) popsFree.firstElementChild!.remove();
  } else if (popsStack) {
    popsStack.append(el);
    while (popsStack.children.length > 4) popsStack.firstElementChild!.remove();
  } else return;
  window.setTimeout(() => el.remove(), around ? 7000 : 9000);
}

/**
 * Bring the chat up to date. `racing`: the race is on screen, so bubbles pop
 * up around it. The big screen (`isHost`) has no panel: it only shows bubbles.
 */
export function updateChat(s: PublicState | null, you: string, opts: { isHost: boolean; racing: boolean; sendChat: (text: string) => void; visible: boolean }) {
  if (!s || !opts.visible) { if (root) root.hidden = true; return; }
  mount();
  send = opts.sendChat;
  root!.hidden = false;
  root!.classList.toggle('host', opts.isHost);
  if (room !== s.code) { room = s.code; seen = -1; readTo = 0; listKey = ''; popsFree!.innerHTML = ''; popsStack!.innerHTML = ''; }

  const newest = s.chat[s.chat.length - 1]?.id ?? 0;
  if (seen === -1) { seen = newest; readTo = newest; } // joining: don't replay old messages
  for (const m of s.chat) {
    if (m.id <= seen) continue;
    const mine = m.from === you;
    // Pop it up: always on the big screen; on a phone unless it's your own or the panel is open.
    if (opts.isHost || (!open && !mine)) pop(s, m, opts.racing);
    if (open || mine) readTo = m.id;
  }
  seen = Math.max(seen, newest);
  updateBadge(opts.isHost ? 0 : s.chat.filter((m) => m.id > readTo && m.from !== you).length);

  // The panel's message list, redrawn only when something changed.
  const key = `${newest}|${s.players.map((p) => `${p.name}${p.avatar}`).join()}`;
  if (list && key !== listKey) {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    listKey = key;
    list.innerHTML = s.chat.length
      ? s.chat.map((m) => `<li class="${m.from === you ? 'me' : ''}">${bubble(s, m)}</li>`).join('')
      : '<li class="chat-empty">No messages yet. Say hello!</li>';
    if (atBottom || open) list.scrollTop = list.scrollHeight;
  }
}

/** Leaving the lobby: hide the chat and clear its bubbles. */
export function hideChat() {
  if (root) { root.hidden = true; setOpen(false); }
  popsFree?.replaceChildren();
  popsStack?.replaceChildren();
  room = '';
}
