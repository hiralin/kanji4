// KANJI4号機: an original A-type machine whose symbols are kanji and hiragana.
// Each reel has one 七, one 漢 and one 吉; the right reel has the runs 桜再七 and 吉再漢
// (not 再桜七: 再 on the top row would put 七 on the bottom, which is a reach-me).
// The left reel has the runs 瓜鈴再漢桜吉 and 瓜鈴再七桜 with 5 koma between them on both sides.
// The left-reel fill was searched so that kicking always works, replay/JACIN never miss at max
// bet when the left reel stops first, bell/15-medal bell/JAC never miss when the left reel stops
// first, and the right reel always pulls 瓜 in when it stops last with 瓜 still live.
// JACIN外し: in BIG, 逆押し (right, center, left) with the left reel pressed while 七 is on the
// center or top row (press 14 or 15) kicks JACIN.
                                                         

// 七 / 漢 = BIG, 吉 = REG, 再 = replay / JACIN, 鈴 = bell, 瓜 = watermelon, 桜 = cherry, ん = blank
const reels = ['瓜鈴再漢桜吉鈴再鈴再ん瓜鈴再七桜瓜鈴再ん再','漢再ん鈴再再鈴ん鈴再七鈴吉再瓜鈴ん再瓜瓜鈴', '再ん瓜鈴桜再七瓜鈴再鈴瓜吉再漢鈴瓜再ん鈴瓜'].map((s) => [...s]);

const roles         = [
  { name: 'big7', kind: 'big', pattern: ['七', '七', '七'], pay: 15 },
  { name: 'bigKan', kind: 'big', pattern: ['漢', '漢', '漢'], pay: 15 },
  { name: 'reg', kind: 'reg', pattern: ['吉', '吉', '吉'], pay: 15 },
  { name: 'replay', kind: 'replay', pattern: ['再', '再', '再'], pay: 0 },
  { name: 'bell', kind: 'small', pattern: ['鈴', '鈴', '鈴'], pay: 8 },
  { name: 'melon', kind: 'small', pattern: ['瓜', '瓜', '瓜'], pay: 15 },
  { name: 'cherry', kind: 'small', pattern: ['桜', null, null], pay: 4 },
  { name: 'bell15', kind: 'small', pattern: ['鈴', '鈴', '鈴'], pay: 15 },
  { name: 'jacin', kind: 'jacin', pattern: ['再', '再', '再'], pay: 15 },
  { name: 'jac', kind: 'jac', pattern: ['再', '鈴', '鈴'], pay: 15 },
];

const bigCounts = [221, 228, 240, 252, 256, 280]; // 1/297 .. 1/234
const regCounts = [132, 140, 150, 164, 176, 186]; // 1/496 .. 1/352
const normal          = bigCounts.map((big, i) => [
  ['big7', big >> 1],
  ['bigKan', big - (big >> 1)],
  ['reg', regCounts[i]],
  ['replay', 8978], // 1/7.3
  ['bell', 5958], // 1/11
  ['melon', 512], // 1/128
  ['cherry', 1638], // 1/40
]);
const same = (t       )          => Array.from({ length: 6 }, () => t);

const MID = [1, 1, 1];
const TOP = [0, 0, 0];
const BOT = [2, 2, 2];
const DOWN = [0, 1, 2];
const UP = [2, 1, 0];

const BONUS_SYMBOLS = ['七', '漢', '吉'];
const ALL_LINES = [MID, TOP, BOT, DOWN, UP];
const SMALL_PATTERNS = [['鈴', '鈴', '鈴'], ['再', '再', '再'], ['瓜', '瓜', '瓜']];
const at = (pos          , reel        , row        ) => reels[reel][(pos[reel] + row - 1 + reels[reel].length) % reels[reel].length];

/**
 * リーチ目, judged on all five lines whatever the bet: 七 on the bottom of the right reel, 漢 on the
 * top of the left reel with 漢 on the bottom of the right reel (漢 diagonal; it comes with a cherry, as 桜 sits under 漢),
 * 吉 on the top of the left reel with 吉再漢 on the right reel (the right reel's only 吉 sits on 再漢),
 * a line of three bonus symbols, or a miss with two or more kinds of small role (鈴, 再, 瓜) one reel
 * short on some line (small-role double/triple tenpai miss). Kicking these without a bonus also means
 * a double tenpai only forms when a bonus or one of the two roles is flagged.
 */
function reachMe(pos          )          {
  if (at(pos, 2, 2) === '七') return true;
  if (at(pos, 0, 0) === '漢' && at(pos, 2, 2) === '漢') return true;
  if (at(pos, 0, 0) === '吉' && at(pos, 2, 0) === '吉') return true;
  const line = (l          ) => l.map((row, reel) => at(pos, reel, row));
  if (ALL_LINES.some((l) => line(l).every((s) => BONUS_SYMBOLS.includes(s)))) return true;
  // A miss with two or more kinds of small role (鈴, 再, 瓜) one reel short on some line.
  if (ALL_LINES.some((l) => roles.some((r) => r.kind !== 'jac' && r.pattern.every((p, i) => p === null || p === line(l)[i])))) return false; // JAC pays only in JAC games
  const kinds = new Set(SMALL_PATTERNS.filter((p) => ALL_LINES.some((l) => line(l).filter((s, i) => s === p[i]).length === 2)).map((p) => p[0]));
  return kinds.size >= 2;
}

export const kanji4          = {
  reels,
  roles,
  reachMe,
  missOnLeftPress: { kinds: ['jacin'], presses: [14, 15] },
  lottery: {
    normal,
    bigSmall: same([
      ['jacin', 13107], // 1/5
      ['bell15', 32768], // 1/2
    ]),
    jac: same([['jac', 65536]]), // every JAC game is flagged (no miss)
  },
  linesByBet: [[], [MID], [MID, TOP, BOT], [MID, TOP, BOT, DOWN, UP]],
  maxBet: { normal: 3, bigSmall: 3, jac: 1 },
};
