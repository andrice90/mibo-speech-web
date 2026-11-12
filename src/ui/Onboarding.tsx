import { useState } from 'react';

import { saveConsent } from '../lesson/consent';
import { setPin, validPin } from '../lib/zone';
import { Bubble, Card } from './kit';
import { MicSwitch } from './MicSwitch';
import { PinPad } from './PinPad';
import { C } from './theme';

const POINTS: [string, string, string][] = [
  ['👀', C.sky, 'Sit with your child while they play. The ◀ ▶ arrows let you repeat or skip a step.'],
  ['🌱', C.mint, "Mibo is for practice at home. For advice about your child's speech, talk to a speech therapist."],
  ['🔒', C.lavender, 'Mibo listens to your child on this device, and lessons run without any AI.'],
  ['✨', C.butter, 'AI helps out in the grown-up zone, where Mibo writes notes for you and makes new lessons.'],
];

export type Step = 'welcome' | 'consent' | 'pin';

/**
 * First use, in three steps for the grown-up: what Mibo is, the choices
 * (both off until chosen), and the PIN for the grown-up zone.
 */
export function Onboarding({ from, onDone }: { from: Step; onDone: () => void }) {
  const [step, setStep] = useState<Step>(from);
  const [grownUp, setGrownUp] = useState(false);
  const [hear, setHear] = useState(false);
  const [first, setFirst] = useState('');   // the PIN as first typed, waiting to be typed again
  const n = step === 'welcome' ? 1 : step === 'consent' ? 2 : 3;

  return (
    <>
      <div className="steps" aria-label={`Step ${n} of 3`}>
        {[1, 2, 3].map(i => <i key={i} className={i === n ? 'now' : i < n ? 'done' : ''} />)}
      </div>

      {step === 'welcome' && (
        <>
          <Card className="consent">
            <h2>Welcome to Mibo! 👋</h2>
            <p className="soft" style={{ fontSize: 15, marginBottom: 4 }}>Mibo is a friendly monster who helps little ones practise tricky sounds. Before you start:</p>
            {POINTS.map(([icon, bg, text]) => (
              <div key={icon} className="point">
                <span className="point-chip" style={{ backgroundColor: bg }}>{icon}</span>
                <span>{text}</span>
              </div>
            ))}
          </Card>
          <div className="row"><Bubble label="Continue" bg={C.mint} deep={C.mintDeep} onPress={() => setStep('consent')} /></div>
        </>
      )}

      {step === 'consent' && (
        <>
          <Card className="consent">
            <h2>Your choices</h2>
            <button type="button" className="check" role="checkbox" aria-checked={grownUp} onClick={() => setGrownUp(v => !v)}>
              <span className={`box${grownUp ? ' on' : ''}`}>{grownUp && '✓'}</span>
              <span>{"I'm a grown-up and I'll stay with my child."}</span>
            </button>
            <p className="mic-help">Needed to continue.</p>
            <MicSwitch on={hear} onChange={setHear} />
          </Card>
          <div className="row">
            <Bubble label="Continue" bg={C.mint} deep={C.mintDeep} disabled={!grownUp} onPress={() => { saveConsent(hear); setStep('pin'); }} />
          </div>
          <p className="note center">You can change this later in Settings.</p>
        </>
      )}

      {step === 'pin' && (
        <Card>
          <PinPad key={first ? 'again' : 'first'} title={first ? 'Confirm PIN' : 'Choose a grown-up PIN 🔒'}
            hint={first ? 'Enter the same four digits again.' : "Pick four digits. You'll use them to open the grown-up zone."}
            onEntered={async pin => {
              if (!first) { if (!validPin(pin)) return false; setFirst(pin); return true; }
              if (pin !== first) { setFirst(''); return false; }
              await setPin(pin); onDone(); return true;
            }} />
        </Card>
      )}
    </>
  );
}
