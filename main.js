// 漢字会館: the hall screen (islands of machine cards, past days) and the machine screen
// (reels, counters, controls). State lives in store.js; reels.js draws; sound.js plays.
import { sound } from './sound.js';
import { createReelView, symbolCanvas } from './reels.js';
import { symbolAt } from './lib/engine.js';
import { ISLANDS, LEND, MODELS, begin, decideEffects, decideNotice, decideStopFlash, engineFor, finish, loadState, nextDay, saveState, today } from './store.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('ja-JP');
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n));
const WAIT_MS = 4100;
const FONTS = ['400 40px "Yuji Syuku"', '400 40px "Zen Antique"', '400 40px "Dela Gothic One"', '700 40px "Kaisei Decol"', '400 40px "Hachi Maru Pop"'];

let s = loadState();
let md = null; // machine data of the seat being played
let e = null; // its engine
let view = null;
let g = null; // game in progress: begin() result, notice and result
let phase = 'idle'; // idle | wait | spin
let lastSpin = -Infinity;
let busyUntil = 0; // payout still counting
let lastPayout = 0;
let lastDraw = '−';
let audioOn = false; // browsers allow audio only after a user action
let saveWarned = false;

/** Small element builder; children are text (escaped) or nodes. */
function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k in n ? (n[k] = v) : n.setAttribute(k, v);
  n.append(...kids.flat().filter((k) => k != null && k !== false).map((k) => (k instanceof Node ? k : String(k))));
  return n;
}

function persist() {
  if (saveState(s) || saveWarned) return;
  saveWarned = true;
  $('hall-message').textContent = 'このブラウザでは保存できません。ページを閉じるとメダルとデータは消えます。';
}

// ---- Credit counter: payouts count up at the pace of the payout sound ----
let shown = s.medals;
let rate = 1e9;
let raf = 0;
function showCredit() {
  cancelAnimationFrame(raf);
  let last = performance.now();
  const step = (t) => {
    shown = shown > s.medals ? s.medals : Math.min(s.medals, shown + (rate * Math.max(0, t - last)) / 1000);
    last = t;
    $('credit').textContent = fmt(Math.floor(shown));
    if (shown < s.medals) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

// ---- Sound ----
function music() {
  if (!audioOn || !sound.enabled) return;
  if (!md) {
    sound.humOff();
    sound.bgm('hall');
  } else if (e.state === 'normal') {
    sound.bgmStop();
  } else {
    // The ongoing bonus is history[0]; its label maps back to the role name, which is also the BGM key (big7 / bigKan).
    const labels = MODELS[md.model].labels;
    const big = Object.keys(labels).find((k) => labels[k] === md.history[0]?.type && k !== 'reg') ?? 'big';
    sound.bgm(e.state === 'jac' ? 'reg' : big); // every JAC game, BIG's included, uses the REG music
  }
}
function startAudio() {
  if (audioOn) return;
  audioOn = true;
  music();
}

// ---- Hall ----
const faceUrls = {};
const faceUrl = (ch) => (faceUrls[ch] ??= symbolCanvas(ch).toDataURL());
const stat = (label, value) => h('span', { className: 'stat' }, h('small', {}, label), h('b', {}, fmt(value)));

function card(m) {
  const model = MODELS[m.model];
  const mine = s.seat === m.no;
  return h('article', { className: 'card' },
    h('div', { className: 'lamp' },
      h('h3', {}, m.no),
      h('p', { className: 'row' }, stat('BIG', m.big), stat('REG', m.reg)),
      h('p', { className: 'row' }, stat('回転', m.since), stat('総回転', m.games)),
      h('button', { className: 'link', type: 'button', onclick: () => openHistory(m), 'aria-label': `${m.no}番台のボーナス履歴` }, '履歴')),
    h('div', { className: 'model' },
      h('div', { className: 'faces', 'aria-hidden': 'true' }, [0, 1, 2].map(() => h('img', { src: faceUrl(model.face), alt: '' }))),
      h('p', {}, model.name),
      h('button', { className: mine ? 'sit mine' : 'sit', type: 'button', onclick: () => sit(m.no), 'aria-label': `${m.no}番台${mine ? 'に戻る' : 'に座る'}` }, mine ? 'あなたの台に戻る' : '座る')));
}

let pastTab = 0;
function renderPast() {
  const days = s.past;
  pastTab = Math.min(pastTab, Math.max(0, days.length - 1));
  $('tabs').replaceChildren(...days.map((d, i) =>
    h('button', { className: 'tab', type: 'button', 'aria-pressed': String(i === pastTab), onclick: () => ((pastTab = i), renderPast()) }, `${d.day}日目（${d.date.slice(5).replace('-', '/')}）`)));
  const d = days[pastTab];
  if (!d) return $('past').replaceChildren(h('p', { className: 'empty' }, 'まだありません。閉店すると、その日の設定と最終データがここに公開されます。'));
  const cols = ['台番号', '設定', '回転', 'BIG', 'REG', '差枚（あなた）'];
  $('past').replaceChildren(h('table', {},
    h('caption', { className: 'empty', style: 'text-align:left;padding:0 0 8px' }, `${d.day}日目（${d.date}）`),
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, d.machines.map((m) => h('tr', {},
      h('td', {}, m.no), h('td', { className: m.setting >= 5 ? 'hi' : '' }, m.setting), h('td', {}, fmt(m.games)),
      h('td', {}, m.big), h('td', {}, m.reg), h('td', {}, m.net == null ? '−' : signed(m.net)))))));
}

function renderHall() {
  $('day').textContent = `${s.day}日目`;
  $('medals').textContent = fmt(s.medals);
  $('lent').textContent = fmt(s.lent);
  $('net').textContent = signed(s.medals - s.lent);
  $('islands').replaceChildren(...ISLANDS.map((island) => {
    const model = MODELS[island.model];
    return h('section', { className: 'island', 'aria-label': `${model.name} の島` },
      h('div', { className: 'section-head' }, h('h2', {}, `${model.name} の島`), h('p', {}, `${island.numbers.length}台。今日の設定は非公開で、翌日になると公開される`)),
      h('div', { className: 'cards' }, island.numbers.map((no) => card(s.machines[no]))));
  }));
  renderPast();
}

function historyItems(m) {
  if (!m.history.length) return [h('li', { className: 'empty' }, 'まだボーナスはありません')];
  return m.history.map((x) => h('li', {}, h('b', { className: x.type === 'REG' ? 'reg' : '' }, x.type), h('span', {}, `${x.games}G`), h('span', {}, `${signed(x.medals)}枚`)));
}

function openHistory(m) {
  $('dialog-title').textContent = `${m.no}番台 ${s.day}日目（${s.date.slice(5).replace('-', '/')}）のボーナス履歴`;
  $('dialog-list').replaceChildren(...historyItems(m));
  $('history-dialog').showModal();
}

// Reel strip chart: engine numbers 0..20 top to bottom, the center row of each reel framed.
function openStrips() {
  const { reels } = MODELS[md.model].machine;
  $('strip-rows').replaceChildren(
    ...reels[0].map((_, i) => h('tr', {}, h('td', {}, String(i)), ...reels.map((r, j) => h('td', { className: md.positions[j] === i ? 'now' : '' }, h('img', { src: faceUrl(r[i]), alt: r[i] }))))),
  );
  $('strip-dialog').showModal();
}

function lend() {
  s.medals += LEND;
  s.lent += LEND;
  shown += LEND;
  sound.coin();
  persist();
  if (md) {
    showCredit();
    toast(`${LEND}枚借りました（貸出の合計 ${fmt(s.lent)}枚）`);
  } else renderHall();
}

function closeDay() {
  if (!confirm(`${s.day}日目を閉店して、翌日へ進みますか？今日の設定とデータは「前日までのデータ」に公開されます。`)) return;
  sound.nextDay();
  $('hall-message').textContent = '閉店作業中です…';
  $('close-day').disabled = true;
  // Let the message paint before the other customers' games run.
  setTimeout(() => {
    nextDay(s);
    pastTab = 0;
    persist();
    renderHall();
    $('close-day').disabled = false;
    $('hall-message').textContent = `${s.day}日目の営業を始めました。前日の設定を公開しました。`;
  }, 50);
}

function show(screen) {
  s.screen = screen;
  $('hall').hidden = screen !== 'hall';
  $('machine').hidden = screen !== 'machine';
}

// ---- Machine ----
const say = (text) => ($('message').textContent = text);
let toastTimer = 0;
/** Short notices that must be seen even with the explanation off; drawn over the reels so nothing moves. */
function toast(text) {
  say(text);
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 2500);
}
function setExplain(on) {
  s.explain = on;
  $('message').hidden = !on;
  $('explain').setAttribute('aria-pressed', String(on));
  $('explain').textContent = on ? '説明 ON' : '説明 OFF';
}
const lineCount = () => e.machine.linesByBet[e.machine.maxBet[e.state]].length;

function sit(no, withSound = true) {
  if (!view) return void ($('hall-message').textContent = 'この端末ではリールを表示できないため、遊技できません（WebGL が必要です）。');
  if (withSound) sound.move();
  md = s.machines[no];
  e = engineFor(md);
  s.seat = md.no;
  show('machine');
  $('model-name').textContent = MODELS[md.model].name;
  $('no').textContent = `No.${md.no}`;
  view.setPositions(md.positions);
  view.setLamp(!!md.notice?.lit);
  view.setMood(e.state);
  view.setLines(lineCount(), []);
  shown = s.medals;
  lastPayout = 0;
  showCredit();
  say(e.state === 'normal' ? 'スペースでレバー、J・K・L で左・中・右を止めます' : 'ボーナスの続きから遊べます');
  renderMachine();
  persist();
  music();
  $('model-name').focus();
}

function leave() {
  if (phase !== 'idle' || performance.now() < busyUntil) return toast('ゲームが終わってから移動できます');
  sound.move();
  md = e = null;
  show('hall');
  if (s.date !== today()) {
    nextDay(s);
    $('hall-message').textContent = `日付が変わったので、${s.day}日目の営業を始めました。`;
  }
  persist();
  renderHall();
  music();
  $('hall-title').focus();
}

function renderMachine() {
  const big = e.machine.big ?? { games: 30, jacins: 3 };
  const jacEnd = e.machine.jacEnd ?? { games: 12, wins: 8 };
  $('payout').textContent = fmt(lastPayout);
  $('games').textContent = fmt(md.since);
  $('left').textContent = e.state === 'bigSmall' ? big.games - e.bigGames : e.state === 'jac' ? jacEnd.games - e.jacGames : '-';
  $('bigs').textContent = fmt(md.big);
  $('regs').textContent = fmt(md.reg);
  const chip = $('state');
  chip.dataset.state = e.state;
  chip.textContent = { normal: '通常', bigSmall: 'BIG', jac: e.jacFromBig ? 'BIG・JAC' : 'REG' }[e.state];
  $('bonus-info').textContent =
    e.state === 'bigSmall' ? `BIG ${e.bigGames}/${big.games}G・JACIN ${e.bigJacins}/${big.jacins}`
    : e.state === 'jac' ? `JAC ${e.jacGames}/${jacEnd.games}G・入賞 ${e.jacWins}/${jacEnd.wins}${e.jacFromBig ? `（JACIN ${e.bigJacins}/${big.jacins}）` : ''}`
    : '';
  $('history').replaceChildren(...historyItems(md));
  const names = MODELS[md.model].names;
  $('debug').textContent = `内部: 持ち越し ${e.carried ? names[e.carried.name] : 'なし'}／今回の抽選 ${lastDraw}／告知 ${{ pre: '先告知', post: '後告知', none: '無告知' }[md.notice?.mode] ?? '−'}`;
}

function lever() {
  if (!md || phase !== 'idle' || performance.now() < busyUntil) return;
  if (!e.replay && s.medals < e.machine.maxBet[e.state]) return toast(`メダルが足りません。「メダルを借りる」で${LEND}枚借りられます`);
  g = begin(e);
  const names = MODELS[md.model].names;
  g.flag = e.flag; // this game's small flag, for the explanation after the third stop
  lastDraw = e.flag ? names[e.flag.name] : g.newBonus ? names[g.newBonus.name] : 'ハズレ';
  if (g.bet) {
    s.medals -= g.bet;
    sound.bet(g.bet);
    showCredit();
  }
  sound.lever();
  $('lever').classList.add('pulled');
  setTimeout(() => $('lever').classList.remove('pulled'), 180);
  g.notice = decideNotice(md, g);
  g.fx = decideEffects(e, g);
  g.stopped = 0;
  if (g.notice === 'pre') {
    // Flash = bonus confirmed; 予告音 alone is only a chance.
    md.notice.lit = true;
    view.setLamp(true);
    view.flash('lever');
    sound.notice();
  } else if (g.fx.yokoku) sound.notice();
  lastPayout = 0;
  view.setLines(lineCount(), []);
  say(g.bet ? '' : 'リプレイ（メダルは減りません）');
  const wait = lastSpin + WAIT_MS - performance.now();
  phase = 'wait';
  $('wait').hidden = wait <= 0;
  setTimeout(() => {
    $('wait').hidden = true;
    lastSpin = performance.now();
    view.startSpin();
    if (audioOn && sound.enabled) sound.humOn(); // the reel motor sounds only while the reels turn
    phase = 'spin';
    lightStops();
  }, Math.max(0, wait));
  renderMachine();
}

function stop(i) {
  if (phase !== 'spin' || e.stops[i] !== null) return;
  const press = view.pressIndex(i);
  if (press == null) return; // still speeding up
  const r = e.stop(i, press);
  view.stopAt(i, r.position);
  lightStops();
  if (g.stopped++ < g.fx.dark) view.setDark(i, true); // the first N reels to stop go dark (消灯)
  md.positions[i] = r.position;
  if (r.result) g.result = r.result;
}

/** Lines (indexes into the bet's lines) on which a winning role is aligned. */
function wonLines(wins) {
  const m = e.machine;
  return m.linesByBet[e.bet].flatMap((line, k) =>
    wins.some((r) => r.pattern.every((sym, i) => sym === null || symbolAt(m, i, md.positions[i], line[i]) === sym)) ? [k] : []);
}

/** Stop buttons light while their reel can be stopped, like the cabinet. */
function lightStops() {
  [0, 1, 2].forEach((i) => ($(`stop${i}`).dataset.lit = String(phase === 'spin' && e.stops[i] === null)));
}

function settle() {
  if (phase !== 'spin' || !g?.result) return;
  phase = 'idle';
  sound.humOff();
  const m = e.machine;
  const model = MODELS[md.model];
  const { payout, wins } = g.result;
  const before = g.before;
  const stopFlash = decideStopFlash(g, e, wins); // before finish(): a bonus aligning now still counts as flagged
  const aligned = finish(md, e, g, payout, s.day, true);
  s.medals += payout;
  lastPayout = payout;
  view.setLines(m.linesByBet[e.bet].length, wonLines(wins));
  view.setMood(e.state);
  const center = md.positions.map((p, i) => symbolAt(m, i, p, 1)).join('・');
  const won = [...new Set(wins.map((r) => model.names[r.name] ?? r.name))].join('・');
  let text = `中段 ${center}。` + (won ? `${won}${payout ? ` ${payout}枚` : ''}` : '');
  // Explanation detail: this game's small flag and whether it aligned. A flagged bonus is not shown here (内部を見る does that).
  const flagName = g.flag ? model.names[g.flag.name] ?? g.flag.name : null;
  text += !flagName ? ' 小役の成立なし。' : wins.includes(g.flag) ? ` 成立役 ${flagName}：入賞。` : ` 成立役 ${flagName}：取りこぼし。`;
  if (payout) {
    const secs = sound.payout(payout);
    rate = payout / Math.max(secs, 0.1);
    busyUntil = performance.now() + secs * 1000;
    showCredit();
  }
  if (wins.some((r) => r.kind === 'replay')) sound.replay();
  if (aligned) {
    view.clearDark();
    view.setLamp(false);
    view.flash(aligned.kind === 'big' ? 'big' : 'reg');
    if (aligned.kind === 'big') sound.big();
    else sound.reg();
    text = `${model.names[aligned.name]} 揃い！ ${text}`;
    setTimeout(music, 1500); // after the fanfare
  } else if (before === 'bigSmall' && e.state === 'jac') {
    sound.jacin();
    view.flash('jacin');
  } else if (before === 'jac' && wins.some((r) => r.kind === 'jac')) {
    sound.jac();
    view.flash('win');
  } else if (stopFlash) view.flash(stopFlash);
  else if (payout) view.flash('win');
  // JACIN inside BIG and the end of that JAC switch the music between BIG and REG.
  if (!aligned && before !== 'normal' && e.state !== 'normal' && before !== e.state) setTimeout(music, 1200);
  if (before !== 'normal' && e.state === 'normal') {
    sound.bgmStop();
    const last = md.history[0];
    const endSec = sound.end(last?.type?.startsWith('BIG') ? 'big' : 'reg'); // BIG ends with a fanfare
    text += ` ${last?.type ?? 'ボーナス'}終了。獲得 ${signed(last?.medals ?? 0)}枚`;
    setTimeout(music, Math.max(1200, endSec * 1000));
  }
  if (!aligned && g.notice === 'post' && md.notice) {
    md.notice.lit = true;
    view.setLamp(true);
    view.flash('notice');
    sound.kitchou();
    text += ' 吉兆が灯った！';
  }
  say(text);
  g = null;
  renderMachine();
  persist();
}

// ---- Wiring ----
/** Stop and lever buttons act on pointerdown (目押し timing); keyboard activation still comes as a click. */
function press(btn, fn) {
  btn.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    fn();
  });
  btn.addEventListener('click', (ev) => ev.detail === 0 && fn());
}

function setSound(on) {
  sound.enabled = on;
  s.sound = on;
  $('sound').setAttribute('aria-pressed', String(on));
  $('sound').textContent = on ? '音 ON' : '音 OFF';
  music();
}

async function init() {
  press($('lever'), lever);
  [0, 1, 2].forEach((i) => press($(`stop${i}`), () => stop(i)));
  $('leave').addEventListener('click', leave);
  $('lend').addEventListener('click', lend);
  $('lend-hall').addEventListener('click', lend);
  $('close-day').addEventListener('click', closeDay);
  $('sound').addEventListener('click', () => (setSound(!sound.enabled), persist()));
  $('strips').addEventListener('click', openStrips);
  $('explain').addEventListener('click', () => (setExplain(!s.explain), persist()));
  $('peek').addEventListener('click', () => {
    const on = $('debug').hidden;
    $('debug').hidden = !on;
    $('peek').setAttribute('aria-pressed', String(on));
  });
  addEventListener('pointerdown', startAudio, { once: true });
  addEventListener('keydown', startAudio, { once: true });
  addEventListener('keydown', (ev) => {
    if (s.screen !== 'machine' || ev.repeat || ev.altKey || ev.ctrlKey || ev.metaKey || document.querySelector('dialog[open]')) return;
    const k = ev.key.toLowerCase();
    if (k === ' ') {
      if (ev.target.closest?.('button, input, select, textarea, a')) return; // Space activates the focused control
      ev.preventDefault();
      lever();
    } else if (k.length === 1 && 'jkl'.includes(k)) {
      ev.preventDefault();
      stop('jkl'.indexOf(k));
    }
  });
  setSound(s.sound !== false);
  setExplain(s.explain === true);

  // Reel faces and card images are drawn once into canvases, so the fonts must be there first.
  await Promise.race([Promise.all(FONTS.map((f) => document.fonts.load(f, '七漢吉再鈴瓜桜ん兆'))), new Promise((r) => setTimeout(r, 4000))]).catch(() => {});
  try {
    // shortcut: one reel view built from KANJI4's strips; a second model needs its own view (or a rebuild on sit).
    const m = MODELS.kanji4.machine;
    view = createReelView($('reels'), m.reels, m.linesByBet[m.maxBet.normal]);
    view.onReelStop = () => sound.stop();
    view.onAllStopped = settle;
    $('loading').hidden = true;
  } catch {
    $('loading').textContent = 'この端末ではリールを表示できません（WebGL が必要です）';
  }
  renderHall();
  if (s.screen === 'machine' && s.seat != null && view) sit(s.seat, false);
  else show('hall');
  persist();
}

init();
