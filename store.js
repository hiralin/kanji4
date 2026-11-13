// Hall state: the store's medal pool, every machine's data lamp and engine state, and the
// business days. No DOM here, so test/store.test.ts can drive it in Node.
import { Engine } from './lib/engine.js';
import { kanji4 } from './lib/kanji4.js';

export const MODELS = {
  kanji4: {
    name: 'KANJI4号機',
    machine: kanji4,
    face: '七',
    // History labels, and role names for the message line.
    labels: { big7: 'BIG7', bigKan: 'BIG漢', reg: 'REG' },
    names: { big7: 'BIG（七）', bigKan: 'BIG（漢）', reg: 'REG（吉）', replay: 'リプレイ', bell: 'ベル', melon: '瓜', cherry: '桜', bell15: 'ベル', jacin: 'JACIN', jac: 'JAC' },
  },
};
// The hall floor. Adding a model to MODELS and an entry here adds an island.
export const ISLANDS = [{ model: 'kanji4', numbers: [101, 102, 103, 104, 105, 106] }];
export const LEND = 50;
export const PAST_DAYS = 7;
const KEY = 'kanji4-hall-v1';
const ENGINE_KEYS = ['state', 'bet', 'replay', 'bigGames', 'bigJacins', 'jacGames', 'jacWins', 'jacFromBig'];
const STATES = ['normal', 'bigSmall', 'jac'];

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Reading `localStorage` itself throws when site data is blocked.
const defaultStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function saveState(s, storage = defaultStorage()) {
  try {
    storage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

function readState(storage) {
  try {
    const s = JSON.parse(storage.getItem(KEY));
    return s?.v === 1 && s.machines && Array.isArray(s.past) ? s : null;
  } catch {
    return null;
  }
}

export function engineFor(md, random = Math.random) {
  const m = MODELS[md.model].machine;
  const e = new Engine(m, md.setting, random);
  if (md.engine) {
    for (const k of ENGINE_KEYS) if (k in md.engine) e[k] = md.engine[k];
    e.carried = m.roles.find((r) => r.name === md.engine.carried) ?? null;
    if (!STATES.includes(e.state)) throw new Error('bad saved engine state');
  }
  return e;
}

export const snapshot = (e) => ({ ...Object.fromEntries(ENGINE_KEYS.map((k) => [k, e[k]])), carried: e.carried?.name ?? null });

/** Lever with the auto bet. Returns what finish() needs to update the data lamp. */
export function begin(e) {
  const before = e.state;
  const free = e.replay;
  const hadBonus = e.carried;
  e.lever();
  return { before, bet: free ? 0 : e.bet, carried: e.carried, newBonus: hadBonus ? null : e.carried };
}

/** Data lamp, history and the player's net after one game. Returns the bonus role that aligned, if any. */
export function finish(md, e, g, payout, day, byPlayer) {
  const aligned = g.before === 'normal' && e.state !== 'normal' ? g.carried : null;
  if (g.before === 'normal') {
    md.games++;
    md.since++;
  } else if (md.history[0]) md.history[0].medals += payout - g.bet;
  if (aligned) {
    md.history.unshift({ day, games: md.since, type: MODELS[md.model].labels[aligned.name] ?? aligned.name, medals: 0 });
    md.since = 0;
    if (aligned.kind === 'big') md.big++;
    else md.reg++;
    md.notice = null;
  }
  if (byPlayer) {
    md.net += payout - g.bet;
    md.played = true;
  }
  md.engine = snapshot(e);
  return aligned;
}

// Lever chance effects in the normal state, by what this game holds. 予告音 is a chance, not a
// confirmation; the reel blackout count (消灯) leans toward rarer roles and bonuses.
const YOKOKU = { none: 1 / 64, replay: 1 / 32, bell: 1 / 16, cherry: 1 / 4, melon: 1 / 3, carried: 1 / 6, bonus: 1 / 2 };
const DARK = { none: [94, 5, 1, 0], replay: [90, 8, 2, 0], bell: [85, 11, 4, 0], cherry: [35, 30, 25, 10], melon: [30, 0, 42, 28], carried: [50, 15, 20, 15], bonus: [15, 20, 30, 35] };

const ROLE_FLASH = ['replay', 'bell', 'melon', 'cherry'];
const FAKE_FLASH = 1 / 4; // per normal game while a bonus is flagged or carried

/**
 * Third-stop flash: the aligned small role's own pattern (bell15 never occurs in the normal state).
 * Only while a bonus is flagged or carried, 1/4 of games show a pattern that contradicts the result
 * (a flash on a miss, or another role's flash), so a contradiction confirms a bonus.
 */
export function decideStopFlash(g, e, wins, random = Math.random) {
  if (g.before !== 'normal') return null;
  const won = wins.find((r) => ROLE_FLASH.includes(r.name))?.name ?? null;
  if ((g.newBonus || e.carried) && random() < FAKE_FLASH) {
    const others = ROLE_FLASH.filter((f) => f !== won);
    return others[Math.floor(random() * others.length)];
  }
  return won;
}

/** { yokoku, dark } for this game: whether the lever plays 予告音, and how many reels go dark as they stop (0..3). */
export function decideEffects(e, g, random = Math.random) {
  if (g.before !== 'normal') return { yokoku: false, dark: 0 };
  const key = g.newBonus ? 'bonus' : e.flag && YOKOKU[e.flag.name] ? e.flag.name : e.carried ? 'carried' : 'none';
  const yokoku = random() < YOKOKU[key];
  let r = random() * 100;
  const dark = DARK[key].findIndex((w) => (r -= w) < 0);
  return { yokoku, dark: dark < 0 ? 0 : dark, key };
}

/**
 * Notice for this game ('pre' at the lever, 'post' after the third stop, or null). Decided once per
 * flagged bonus: pre 1/5, post 2/5, none 2/5; under none, each later game while carried has a 1/6 post.
 */
export function decideNotice(md, g, random = Math.random) {
  if (g.newBonus) {
    const r = random();
    md.notice = { mode: r < 0.2 ? 'pre' : r < 0.6 ? 'post' : 'none', lit: false };
    return md.notice.mode === 'none' ? null : md.notice.mode;
  }
  if (md.notice && !md.notice.lit && md.notice.mode === 'none' && random() < 1 / 6) return 'post';
  return null;
}

const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/** Other customers: free play (random order and presses) for 300..1500 games, never leaving mid-bonus. */
export function simulateCustomers(md, day, random = Math.random) {
  const e = engineFor(md, random);
  const m = e.machine;
  const games = 300 + Math.floor(random() * 1201);
  for (let n = 0; n < games || e.state !== 'normal'; n++) {
    const g = begin(e);
    let result;
    for (const reel of ORDERS[Math.floor(random() * 6)]) {
      const r = e.stop(reel, Math.floor(random() * m.reels[reel].length));
      md.positions[reel] = r.position;
      result = r.result;
    }
    finish(md, e, g, result.payout, day, false);
  }
  // A bonus the customer left behind stays carried, with no notice given yet.
  md.notice = e.carried ? { mode: 'none', lit: false } : null;
}

function newMachine(model, no, day, random) {
  const md = { no, model, setting: 1 + Math.floor(random() * 6), games: 0, since: 0, big: 0, reg: 0, net: 0, played: false, history: [], notice: null, engine: null, positions: [0, 0, 0] };
  md.positions = MODELS[model].machine.reels.map((r) => Math.floor(random() * r.length));
  simulateCustomers(md, day, random);
  return md;
}

/** Adds machines that ISLANDS lists but the state lacks (a new island opens mid-day too), drops removed ones. */
function placeMachines(s, random) {
  const wanted = new Map(ISLANDS.flatMap((i) => i.numbers.map((no) => [String(no), i.model])));
  for (const no of Object.keys(s.machines)) if (wanted.get(no) !== s.machines[no].model) delete s.machines[no];
  for (const [no, model] of wanted) s.machines[no] ??= newMachine(model, Number(no), s.day, random);
  if (s.seat != null && !s.machines[s.seat]) [s.seat, s.screen] = [null, 'hall'];
}

export function freshState(random = Math.random) {
  const s = { v: 1, day: 1, date: today(), medals: 0, lent: 0, seat: null, screen: 'hall', sound: true, past: [], machines: {} };
  placeMachines(s, random);
  return s;
}

/** Closes the day: today's settings and final data become public, then the next day opens with new settings. */
export function nextDay(s, random = Math.random) {
  const machines = Object.values(s.machines).map(({ no, model, setting, games, big, reg, net, played, history }) => ({ no, model, setting, games, big, reg, net: played ? net : null, history }));
  s.past.unshift({ day: s.day, date: s.date, machines });
  s.past.length = Math.min(s.past.length, PAST_DAYS);
  s.day++;
  s.date = today();
  s.seat = null;
  s.screen = 'hall';
  s.machines = {};
  placeMachines(s, random);
}

/** Saved state (or a fresh store), with missing machines placed and the day advanced when the date changed. */
export function loadState(storage = defaultStorage(), random = Math.random) {
  const s = readState(storage);
  if (!s) return freshState(random);
  try {
    placeMachines(s, random);
    for (const md of Object.values(s.machines)) engineFor(md); // rejects a broken engine snapshot
    if (s.date !== today()) nextDay(s, random);
    return s;
  } catch {
    return freshState(random);
  }
}
