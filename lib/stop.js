// Stop decision core shared by the 4号機 engine (engine.ts) and the 5.5号機・6号機 engine (modern.ts):
// 蹴飛ばし (safe), 引き込み (sure) and the 検索方式 candidate scoring. It works on plain reel strips and
// callbacks, so it knows nothing about lotteries, states or bonuses.

/** Stop positions (center index) per reel; null while the reel still spins. */
                                      
                                            

                               
                                                                                                                           
                    
                  
                                                                                     
                    
                                                                       
                                    
                                                                                                  
                                                           
                                                                        
                                                
 

/**
 * Memoized "the engine can always finish this" check: whatever order and positions the
 * player presses the remaining reels in, some candidate within maxSlip keeps the property,
 * and the final stop satisfies `terminal`.
 */
export function guarantee(reels            , maxSlip        , terminal                            )        {
  const memo = new Map                 ();
  const width = Math.max(...reels.map((r) => r.length)) + 1;
  const ok = (pos       )          => {
    const k = pos.reduce        ((a, p) => a * width + (p ?? width - 1), 0);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const rest = pos.flatMap((p, i) => (p === null ? [i] : []));
    const result =
      rest.length === 0
        ? terminal(pos            )
        : rest.every((reel) => {
            const n = reels[reel].length;
            const good = Array.from({ length: n }, (_, q) => ok(pos.map((p, i) => (i === reel ? q : p))));
            return good.every((_, press) => Array.from({ length: maxSlip + 1 }, (_, s) => good[(((press - s) % n) + n) % n]).some(Boolean));
          });
    memo.set(k, result);
    return result;
  };
  return ok;
}

/** Stop decisions for one game context (state, bet, flagged roles). Keep one per context: the checks are memoized. */
export class Stopper    {
  /** 蹴飛ばし guarantee: the remaining reels can always be stopped legally. */
           safe       ;
                   sures = new Map          ();
                   model              ;

  constructor(model              ) {
    this.model = model;
    this.safe = guarantee(model.reels, model.maxSlip, model.legal);
  }

  /** Pull-in guarantee: the remaining reels can always be stopped legally with `role` aligned. */
  sure(role   )        {
    let c = this.sures.get(role);
    if (!c) {
      const { reels, maxSlip, legal, lines, onLine } = this.model;
      const aligned = this.model.aligned ?? ((r   , pos          ) => lines.some((line) => onLine(r, line, pos)));
      this.sures.set(role, (c = guarantee(reels, maxSlip, (pos) => legal(pos) && aligned(role, pos))));
    }
    return c;
  }

  /** The stops reachable by pressing `reel` at `press`: press position first, then each koma of slip. */
  candidates(stopped       , reel        , press        )          {
    const n = this.model.reels[reel].length;
    return Array.from({ length: this.model.maxSlip + 1 }, (_, s) => stopped.map((p, i) => (i === reel ? (((press - s) % n) + n) % n : p)));
  }

  /**
   * 検索方式 stop decision. Order: 1) kick: keep only safe candidates, 2) pull-in, by the order of
   * `targets`: prefer a candidate from which the role is sure to align whatever the player presses
   * next, then one that keeps it live on an active line, 3) the smallest slip.
   * With `sureFirst`, any role that is sure beats every role that is only live (5号機以降: align
   * whatever can be aligned); without it, a higher role kept live beats a lower one made sure (4号機).
   * Returns the stop position, or -1 when no candidate is safe.
   */
  choose(stopped       , reel        , press        , targets     , sureFirst = false)         {
    const { lines, onLine } = this.model;
    const sure = targets.map((t) => this.sure(t));
    let best = -1;
    let bestScore = Infinity;
    for (const pos of this.candidates(stopped, reel, press)) {
      if (!this.safe(pos)) continue;
      const score = Math.min(
        2 * targets.length,
        ...targets.map((t, i) => (sure[i](pos) ? (sureFirst ? i : 2 * i) : lines.some((line) => onLine(t, line, pos)) ? (sureFirst ? targets.length + i : 2 * i + 1) : Infinity)),
      );
      if (score < bestScore) [best, bestScore] = [pos[reel] , score];
    }
    return best;
  }
}
