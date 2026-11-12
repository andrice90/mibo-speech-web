/** Soft, bright pastels that sit well next to Mibo's mint and the paper stage. */
export const C = {
  paper: '#fff8ee',
  card: '#fffdf8',
  ink: '#3b3355',
  soft: '#7a7194',
  line: '#efe5d6',
  mint: '#9ff0cf',
  mintDeep: '#2fa57a',
  lavender: '#e4dbff',
  lavenderDeep: '#7b61d1',
  peach: '#ffd2bd',
  peachDeep: '#ec7d55',
  butter: '#ffe999',
  butterDeep: '#d9a514',
  sky: '#d4efff',
  teal: '#c8f1ee',
  tealDeep: '#1f8a86',
  /** Red is kept for destructive actions (delete, clear, reset). */
  rose: '#ffc7d6',
  roseDeep: '#c94f7c',
  white: '#ffffff',
};

/** Each sound gets its own colour, used on its words and progress dots. */
export const SOUND = {
  s: { bg: C.mint, deep: C.mintDeep, name: 'Snake sound (s)' },
  th: { bg: C.lavender, deep: C.lavenderDeep, name: 'Tongue sound (th)' },
  sh: { bg: C.lavender, deep: C.lavenderDeep, name: 'Quiet sound (sh)' },
  z: { bg: C.butter, deep: C.butterDeep, name: 'Buzzy sound (z)' },
  rhyme: { bg: C.peach, deep: C.peachDeep, name: 'Rhyming pairs' },
  twisty: { bg: C.sky, deep: '#2f7fb8', name: 'Twisty words' },
  custom: { bg: C.teal, deep: C.tealDeep, name: 'Made-lesson words' },
};
