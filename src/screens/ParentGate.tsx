import { useEffect, useState, type ReactNode } from 'react';

import { goHome } from '../lib/router';
import { hasPin, pinPause, resetEverything, unlock, useParentZone } from '../lib/zone';
import { Bubble, Card, Column, Dialog, ZoneBar } from '../ui/kit';
import { PinPad } from '../ui/PinPad';
import { C } from '../ui/theme';

/** The door to the grown-up zone: shows its children only once the PIN has been entered. */
export function ParentGate({ children }: { children: ReactNode }) {
  const open = useParentZone();
  const [pause, setPause] = useState(pinPause);
  const [askReset, setAskReset] = useState(false);

  useEffect(() => { if (!hasPin()) goHome(); }, []);   // first use is not finished: home sets the PIN up
  useEffect(() => {
    if (pause <= 0) return;
    const t = setInterval(() => setPause(pinPause()), 500);
    return () => clearInterval(t);
  }, [pause]);

  if (open) return <>{children}</>;
  return (
    <div className="screen">
      <Column max={420}>
        <ZoneBar title="Grown-up zone" onBack={goHome} />
        <div className="scroll"><div className="body">
          <Card>
            <PinPad title="Grown-ups only 🔒"
              hint={pause > 0 ? `Too many tries. Wait ${pause} seconds.` : "Enter your PIN to make lessons and read Mibo's notes."}
              onEntered={async pin => { const ok = await unlock(pin); setPause(pinPause()); return ok; }} />
          </Card>
          <button type="button" className="skip" onClick={() => setAskReset(true)}>Forgot the PIN?</button>
        </div></div>
        {askReset && (
          <Dialog onClose={() => setAskReset(false)}>
            <div className="big">🧹</div>
            <h2>Start again from scratch?</h2>
            <p>There's no way to look up a forgotten PIN. Starting again clears the PIN, your lessons and Mibo's notes from this device.</p>
            <div className="row"><Bubble label="Remove everything" bg={C.rose} deep={C.roseDeep} onPress={() => void resetEverything().then(goHome)} /></div>
            <div className="row"><Bubble small label="Keep it" bg={C.mint} deep={C.mintDeep} onPress={() => setAskReset(false)} /></div>
          </Dialog>
        )}
      </Column>
    </div>
  );
}
