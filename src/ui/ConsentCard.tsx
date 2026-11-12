import { useState } from 'react';

import { loadConsent } from '../lesson/consent';
import { Bubble, Card } from './kit';
import { C } from './theme';

const POINTS: [string, string, string][] = [
  ['👀', C.sky, 'Stay with your child. ◀ ▶ redo or skip any step.'],
  ['🌱', C.mint, 'A practice buddy, not a speech therapist. No diagnosis.'],
  ['✨', C.butter, "Mibo's replies and notes are written by AI."],
  ['🔒', C.rose, 'Listening happens on this device only. Voices are never kept or sent.'],
];

/**
 * The grown-up's consent card: supervision points, the "I'm a grown-up"
 * tick, and the listen switch. Shown once, at first app start.
 * `onDone` gets the listen choice; the caller saves it (lesson/consent.ts).
 */
export function ConsentCard({ buttonLabel, onDone }: { buttonLabel: string; onDone: (hear: boolean) => void }) {
  const [ok, setOk] = useState(false);
  const [hear, setHear] = useState(() => loadConsent()?.hear ?? true);
  return (
    <>
      <Card className="consent">
        <h2>For the grown-up 👋</h2>
        {POINTS.map(([icon, bg, text]) => (
          <div key={icon} className="point">
            <span className="point-chip" style={{ backgroundColor: bg }}>{icon}</span>
            <span>{text}</span>
          </div>
        ))}
        <button type="button" className="check" role="checkbox" aria-checked={ok} onClick={() => setOk(v => !v)}>
          <span className={`box${ok ? ' on' : ''}`}>{ok && '✓'}</span>
          <span>{"I'm a grown-up and I'll stay with my child."}</span>
        </button>
        <button type="button" className="check mic" role="switch" aria-checked={hear} onClick={() => setHear(v => !v)}>
          <span className={`box${hear ? ' on' : ''}`}>{hear && '✓'}</span>
          <span>🎤 Let Mibo listen (on this device only)</span>
        </button>
      </Card>
      <div className="row">
        <Bubble label={buttonLabel} bg={C.peach} deep={C.peachDeep} disabled={!ok} onPress={() => onDone(hear)} />
      </div>
    </>
  );
}
