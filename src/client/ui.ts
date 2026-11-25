// Small rendering helpers shared by the host screen and the player phones.

import { avatarUrl, type PublicPlayer, type PublicState } from '../shared/protocol';

export const app = document.getElementById('app')!;
const toastEl = document.getElementById('toast')!;

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const r2 = (n: number) => Math.round(n * 100) / 100;
export function money(n: number, signed = false): string {
  const v = r2(Math.abs(n));
  const s = '$' + (Number.isInteger(v) ? String(v) : v.toFixed(2));
  if (n < -0.004) return '−' + s;
  return signed && n > 0.004 ? '+' + s : s;
}
export const oddsText = (o: number) => (o === 0 ? '—' : '×' + o.toFixed(2));
export const cls = (n: number) => (n > 0.004 ? 'pos' : n < -0.004 ? 'neg' : '');

/** A horse's number on its saddle-cloth colour. */
export const horse = (h: number, extra = '') => `<span class="horse h${h} ${extra}">${h}</span>`;

export const store = {
  get<T>(k: string): T | null {
    try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
  },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

let toastTimer = 0;
export function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 3200);
}

/** Replace the page; keep the focused text box focused (bets are typed live). */
export function render(html: string) {
  const a = document.activeElement as HTMLInputElement | null;
  const id = a?.id;
  const sel = a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
  app.innerHTML = html;
  if (id) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) {
      el.focus();
      if (sel && sel[0] !== null) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not text */ }
    }
  }
}

const INITIAL_BG = ['#c8442f', '#2f5d8a', '#3f7d4a', '#b7832f', '#7a4b8c', '#2f7d7a'];

/** A player's photo, or their initial on a colour picked from their name. */
export function avatar(code: string, p: Pick<PublicPlayer, 'id' | 'name' | 'avatar'>, extra = '') {
  if (p.avatar) return `<img class="avatar ${extra}" src="${avatarUrl(code, p.id, p.avatar)}" alt="" />`;
  let h = 0;
  for (const ch of p.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initial = esc([...p.name.trim()][0]?.toUpperCase() ?? '?');
  return `<span class="avatar initial ${extra}" style="background:${INITIAL_BG[h % INITIAL_BG.length]}">${initial}</span>`;
}

export function playerList(s: PublicState, show: (p: PublicPlayer) => string = () => '', you = '') {
  if (!s.players.length) return '<p class="muted">Nobody has joined yet.</p>';
  return `<ul class="players">${s.players.map((p) => `
    <li class="${p.connected ? '' : 'away'} ${p.id === you ? 'me' : ''}">
      ${avatar(s.code, p)}
      <span class="name">${esc(p.name)}${p.id === you ? ' <span class="tag">you</span>' : ''}</span>
      <span class="aside">${show(p)}</span>
    </li>`).join('')}</ul>`;
}

export function leaderboard(s: PublicState, you: string, showLast = true) {
  const ranked = s.players.slice().sort((a, b) => b.balance - a.balance);
  let rank = 0, prev = Infinity;
  return `<ol class="leaders">${ranked.map((p, i) => {
    if (p.balance < prev - 1e-9) { rank = i + 1; prev = p.balance; }
    const last = p.history[p.history.length - 1];
    return `<li class="${p.id === you ? 'me' : ''}">
      <span class="rank">${rank}</span>
      ${avatar(s.code, p)}
      <span class="name">${esc(p.name)}</span>
      ${showLast ? `<span class="delta ${cls(last ?? 0)}">${last == null ? '–' : money(last, true)}</span>` : ''}
      <span class="bal">${money(p.balance)}</span>
    </li>`;
  }).join('')}</ol>`;
}

/** Everyone's bets this round, like a race sheet in the spreadsheet. */
export function betsTable(s: PublicState, winner: number | null = null) {
  const players = s.players.filter((p) => p.playing);
  if (!players.length) return '<p class="muted">No bets this round.</p>';
  const head = Array.from({ length: 6 }, (_, h) => `<th class="${winner === h + 1 ? 'win' : ''}">${horse(h + 1)}</th>`).join('');
  // Budget: what each player had to bet with when this round's betting opened.
  const body = players.map((p) => `<tr><td class="name">${esc(p.name)}</td><td class="budget">${money(p.budget)}</td>${(p.bets ?? []).map((b, h) =>
    `<td class="${winner === h + 1 ? 'win' : ''}">${b ? money(b) : ''}</td>`).join('')}</tr>`).join('');
  return `<div class="scroll"><table class="table grid"><thead><tr><th></th><th class="budget">Budget</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Start, then each race's result and running sum, like the Results sheet. */
export function historyTable(s: PublicState) {
  const ranked = s.players.slice().sort((a, b) => b.balance - a.balance);
  const rounds = Math.max(0, ...s.players.map((p) => p.history.length));
  const head = Array.from({ length: rounds }, (_, i) => `<th>R${i + 1}</th><th>Σ${i + 1}</th>`).join('');
  const rows = ranked.map((p) => {
    let bal = s.startBalance;
    const cells = Array.from({ length: rounds }, (_, i) => {
      const n = p.history[i];
      if (n != null) bal += n;
      return `<td class="${cls(n ?? 0)}">${n == null ? '–' : money(n, true)}</td><td>${money(bal)}</td>`;
    }).join('');
    return `<tr><td class="name">${esc(p.name)}</td><td>${money(s.startBalance)}</td>${cells}</tr>`;
  }).join('');
  return `<div class="scroll"><table class="table grid"><thead><tr><th></th><th>Start</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
