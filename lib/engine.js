// Reel control core for a 4th-generation (4号機) A-type pachislot.
// Spec and sources: reports/4号機Aタイプ規制とリール制御.md
import { Stopper } from './stop.js';

                                                                        
                                                      
/** [role name, count]. Counts are out of rngRange; whatever is left over is a miss (ハズレ). */
                                       

                       
               
             
                                                                                        
                             
                                      
              
 

                          
                                                                                                                           
                    
                
                                                                                                   
                                      
                                                                                                                         
                         
                                                                                                       
                           
                                    
                    
                   
                     
                                                                                                   
                        
     
                                                                                              
                                                                                                    
     
                                                         
     
                                                                                                   
                                                                                              
     
                                       
                                          
                                           
 

                              
                   
              
                                                                                                               
                  
 

                             
                                    
               
                 
 

const RNG_RANGE = 65536;
const MAX_SLIP = 4; // 190 ms at 80 rpm with 21 koma
const MAX_PAYOUT = 15;
const PRIORITY         = ['replay', 'jacin', 'jac', 'small', 'big', 'reg'];
const BIG = { games: 30, jacins: 3 };
const JAC_END = { games: 12, wins: 8 };
const isBonus = (r             ) => r?.kind === 'big' || r?.kind === 'reg';

const relevantCache = new WeakMap                                    ();
const stopperCache = new WeakMap                                     ();

function role(m         , name        )       {
  const r = m.roles.find((x) => x.name === name);
  if (!r) throw new Error(`unknown role in lottery table: ${name}`);
  return r;
}

export function carryTables(m         )          {
  return m.carryLottery ?? m.lottery.normal.map((t) => t.filter(([n]) => !isBonus(role(m, n))));
}

/** Roles that pay (and so must be kicked when not flagged) in a state. */
export function relevantRoles(m         , state           )         {
  let c = relevantCache.get(m);
  if (!c) {
    const of = (tables         ) => new Set(tables.flat().map(([n]) => role(m, n)));
    c = {
      normal: [...new Set([...of(m.lottery.normal), ...of(carryTables(m))])],
      bigSmall: [...of(m.lottery.bigSmall)],
      jac: [...of(m.lottery.jac)],
    };
    relevantCache.set(m, c);
  }
  return c[state];
}

export function symbolAt(m         , reel        , center        , row        )         {
  const s = m.reels[reel];
  return s[(center + row - 1 + s.length) % s.length];
}

/** True when every stopped reel on this line shows the role's symbol (all reels stopped = aligned). */
function lineMatches(m         , r      , line          , pos                   )          {
  return pos.every((p, i) => p === null || r.pattern[i] === null || symbolAt(m, i, p, line[i]) === r.pattern[i]);
}

export function wins(m         , state           , bet        , pos          )         {
  const out         = [];
  for (const line of m.linesByBet[bet]) for (const r of relevantRoles(m, state)) if (lineMatches(m, r, line, pos)) out.push(r);
  return out;
}

const ctxKey = (ctx             ) => `${ctx.state}|${ctx.bet}|${ctx.allowed.map((r) => r.name).sort().join(',')}`;

/** Final stop is legal: only allowed roles, at most one role, payout within the limit, no reach-me without a bonus. */
function legal(m         , ctx             , pos          )          {
  const w = wins(m, ctx.state, ctx.bet, pos);
  if (m.reachMe && ctx.state === 'normal' && !ctx.allowed.some(isBonus) && m.reachMe(pos)) return false;
  return new Set(w).size <= 1 && w.every((r) => ctx.allowed.includes(r)) && w.reduce((a, r) => a + r.pay, 0) <= (m.maxPayout ?? MAX_PAYOUT);
}

/** The shared stop core for this context (蹴飛ばし and 引き込み checks, memoized per machine and context). */
function stopper(m         , ctx             )                {
  let byKey = stopperCache.get(m);
  if (!byKey) stopperCache.set(m, (byKey = new Map()));
  const key = ctxKey(ctx);
  let st = byKey.get(key);
  if (!st) {
    st = new Stopper      ({
      reels: m.reels,
      maxSlip: m.maxSlip ?? MAX_SLIP,
      lines: m.linesByBet[ctx.bet],
      legal: (pos) => legal(m, ctx, pos),
      onLine: (r, line, pos) => lineMatches(m, r, line, pos),
      aligned: (r, pos) => wins(m, ctx.state, ctx.bet, pos).includes(r),
    });
    byKey.set(key, st);
  }
  return st;
}

/** True when, from these stops, the remaining reels can always align `target` legally whatever the player presses. For checking machine data. */
export const canAlign = (m         , ctx             , target      , pos                   )          => stopper(m, ctx).sure(target)(pos);

/** True when the strips can always kick in this context, whatever the player presses. For checking machine data. */
export const kickable = (m         , ctx             )          => stopper(m, ctx).safe([null, null, null]);

/**
 * 検索方式 (control method) stop decision. Candidates are the press position and up to
 * maxSlip koma after it. Order: 1) kick: keep only safe candidates, 2) pull-in, by role
 * priority: prefer a candidate from which the role is sure to align whatever the player
 * presses next, then one that keeps it live on an active line, 3) the smallest slip.
 * Missing a flagged role (取りこぼし) happens when no candidate keeps it live. `firstReel` is the
 * reel stopped first this game; it decides 逆押し for missOnLeftPress.
 */
export function decideStop(m         , game             , stopped                   , reel        , press        , firstReel = 0)         {
  const miss = m.missOnLeftPress;
  const reduced = { ...game, allowed: game.allowed.filter((r) => !miss?.kinds.includes(r.kind)) };
  const reverse = firstReel === 2 && reel === 0 && stopped[1] !== null; // right, center, left
  const canKick = () => stopper(m, reduced).candidates(stopped, reel, press).some(stopper(m, reduced).safe);
  const ctx = miss && reverse && miss.presses.includes(press) && canKick() ? reduced : game;
  const priority = m.pullPriority ?? PRIORITY;
  const targets = [...ctx.allowed].sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind));
  const best = stopper(m, ctx).choose(stopped, reel, press, targets);
  if (best < 0) {
    const names = ctx.allowed.map((r) => r.name).join(',') || 'none';
    throw new Error(`reel strips cannot kick: state=${ctx.state} bet=${ctx.bet} allowed=${names} reel=${reel} press=${press}`);
  }
  return best;
}

export function validateMachine(m         )       {
  const fail = (msg        ) => {
    throw new Error(`invalid machine: ${msg}`);
  };
  const range = m.rngRange ?? RNG_RANGE;
  const maxSlip = m.maxSlip ?? MAX_SLIP;
  if (m.reels.length !== 3) fail('A-type needs 3 reels');
  if (!Number.isInteger(maxSlip) || maxSlip < 0 || maxSlip > 4) fail('maxSlip must be 0..4 (190 ms rule)');
  for (const r of m.reels) if (r.length <= maxSlip) fail('reel shorter than maxSlip');
  for (const r of m.roles) {
    if (r.pattern.length !== 3) fail(`${r.name}: pattern needs 3 symbols`);
    if (r.pay < 0 || r.pay > (m.maxPayout ?? MAX_PAYOUT)) fail(`${r.name}: pay over the per-game limit`);
  }
  for (const [state, max] of Object.entries(m.maxBet)) if (max < 1 || max > 3 || !m.linesByBet[max]?.length) fail(`${state}: maxBet must be 1..3 with lines`);
  for (const line of m.linesByBet.flat()) if (line.length !== 3 || line.some((row) => row < 0 || row > 2)) fail('line rows must be 0..2');
  for (const [state, tables] of [...Object.entries(m.lottery), ['carry', carryTables(m)]         ]) {
    if (tables.length !== 6) fail(`${state}: needs one table per setting 1..6`);
    for (const t of tables) {
      if (t.some(([, c]) => !Number.isInteger(c) || c < 0)) fail(`${state}: counts must be non-negative integers`);
      if (t.reduce((a, [, c]) => a + c, 0) > range) fail(`${state}: counts exceed rngRange`);
    }
  }
  relevantRoles(m, 'normal'); // throws on unknown role names
}

export class Engine {
  state            = 'normal';
  /** Bonus flag carried until it aligns (持ち越し). */
  carried              = null;
  /** This game's small/replay/JAC flag; gone after the game (取りこぼし). */
  flag              = null;
  bet = 0;
  /** A replay won last game: the next game is played with the same bet and no medals. */
  replay = false;
  bigGames = 0;
  bigJacins = 0;
  jacGames = 0;
  jacWins = 0;
  jacFromBig = false;
  /** Stop positions (center index) of the game in progress; empty between games. */
  stops                    = [];
  /** The reel stopped first in the game in progress. */
  firstReel = 0;
           machine         ;
  setting        ;
          random              ;

  constructor(machine         , setting        , random               = Math.random) {
    validateMachine(machine);
    if (!Number.isInteger(setting) || setting < 1 || setting > 6) throw new Error('setting must be 1..6');
    this.machine = machine;
    this.setting = setting;
    this.random = random;
  }

  /** Start a game: take the bet and draw this game's role (内部抽選). Returns the drawn role, or null for a miss. */
  lever(bet = this.machine.maxBet[this.state])              {
    const m = this.machine;
    if (this.stops.length) throw new Error('game in progress');
    if (!this.replay) {
      if (!Number.isInteger(bet) || bet < 1 || bet > m.maxBet[this.state]) throw new Error(`bet must be 1..${m.maxBet[this.state]}`);
      this.bet = bet;
    }
    this.replay = false;
    const tables = this.state === 'normal' && this.carried ? carryTables(m) : m.lottery[this.state];
    const n = Math.floor(this.random() * (m.rngRange ?? RNG_RANGE));
    let acc = 0;
    const drawn = tables[this.setting - 1].find(([, c]) => n < (acc += c));
    const r = drawn ? role(m, drawn[0]) : null;
    this.flag = isBonus(r) ? null : r;
    if (isBonus(r) && !this.carried) this.carried = r; // a bonus drawn while one is carried counts as a miss
    this.stops = [null, null, null];
    return r;
  }

  /** Press the stop button of `reel` while `press` is on the center line. Returns where the reel stops, plus the result after the last reel. */
  stop(reel        , press        )                                            {
    const m = this.machine;
    if (!Number.isInteger(reel) || reel < 0 || reel >= m.reels.length) throw new Error('reel out of range');
    if (this.stops[reel] !== null) throw new Error(this.stops.length ? 'reel already stopped' : 'pull the lever first');
    if (!Number.isInteger(press) || press < 0 || press >= m.reels[reel].length) throw new Error('press position out of range');
    const allowed = [this.flag, this.carried].filter((r)            => r !== null);
    if (this.stops.every((p) => p === null)) this.firstReel = reel;
    const position = decideStop(m, { state: this.state, bet: this.bet, allowed }, this.stops, reel, press, this.firstReel);
    this.stops[reel] = position;
    if (this.stops.some((p) => p === null)) return { position };
    return { position, result: this.settle() };
  }

          settle()             {
    const m = this.machine;
    const w = wins(m, this.state, this.bet, this.stops            );
    const payout = w.reduce((a, r) => a + r.pay, 0);
    const won = (k      ) => w.some((r) => r.kind === k);
    const big = m.big ?? BIG;
    const jacEnd = m.jacEnd ?? JAC_END;
    this.stops = [];
    this.flag = null;
    if (won('replay')) this.replay = true;
    if (this.state === 'normal' && this.carried && w.includes(this.carried)) {
      const bonus = this.carried;
      this.carried = null;
      if (bonus.kind === 'big') [this.state, this.bigGames, this.bigJacins] = ['bigSmall', 0, 0];
      else this.startJac(false);
    } else if (this.state === 'bigSmall') {
      this.bigGames++; // the game that wins JACIN counts toward the 30
      if (won('jacin')) {
        this.bigJacins++;
        this.startJac(true);
      } else if (this.bigGames >= big.games) this.state = 'normal';
    } else if (this.state === 'jac') {
      this.jacGames++;
      if (won('jac')) this.jacWins++;
      if (this.jacGames >= jacEnd.games || this.jacWins >= jacEnd.wins) {
        const back = this.jacFromBig && this.bigJacins < big.jacins && this.bigGames < big.games;
        this.state = back ? 'bigSmall' : 'normal';
      }
    }
    return { wins: w, payout };
  }

          startJac(fromBig         )       {
    [this.state, this.jacGames, this.jacWins, this.jacFromBig] = ['jac', 0, 0, fromBig];
  }
}
