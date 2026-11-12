import { useState } from 'react';

import { askForMic, canListen } from '../voice/listen';

type State = 'idle' | 'asking' | 'blocked';

/**
 * The "let Mibo listen" switch. Turning it on asks the browser for the
 * microphone there and then, and says where to look: the browser's own
 * pop-up appears near the address bar and is easy to miss. If the browser
 * says no, the switch stays off and explains how to allow it.
 */
export function MicSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const [state, setState] = useState<State>('idle');

  const toggle = async () => {
    if (state === 'asking') return;
    if (on) { onChange(false); setState('idle'); return; }
    setState('asking');
    const ok = await askForMic();
    setState(ok ? 'idle' : 'blocked');
    onChange(ok);
  };

  return (
    <div className="mic-switch">
      <button type="button" className="check mic" role="switch" aria-checked={on} onClick={() => void toggle()}>
        <span className={`box${on ? ' on' : ''}`}>{on && '✓'}</span>
        <span>🎤 Let Mibo listen to my child's tries</span>
      </button>
      {state === 'asking' && (
        <p className="mic-help ask">
          <b>Your browser is asking now.</b> Look for its pop-up near the address bar at the top of the window and choose <b>Allow</b>.
        </p>
      )}
      {state === 'blocked' && (
        <p className="mic-help blocked">
          {canListen()
            ? <><b>The browser did not allow the microphone.</b> Click the icon at the left end of the address bar, set Microphone to Allow, then switch this on again.</>
            : <><b>This browser cannot share the microphone with this page.</b> Mibo will rely on your ◀ ▶ arrows.</>}
        </p>
      )}
      {state === 'idle' && on && <p className="mic-help ok">Microphone allowed ✓ Mibo listens only while your child has a go.</p>}
      {state === 'idle' && !on && (
        <p className="mic-help">
          Optional. Mibo checks each try right here on this device. Your browser will ask for permission when you switch this on.
          Without it, you tell Mibo how each try went with the ◀ ▶ arrows.
        </p>
      )}
    </div>
  );
}
