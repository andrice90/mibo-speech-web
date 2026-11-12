import { useEffect, useState } from 'react';

/**
 * A four-digit keypad. `onEntered` gets the PIN once four digits are in and
 * answers whether to accept it; a refusal shakes the dots and clears them.
 * The title and hint take a fixed amount of room, so the keys stay in the
 * same place when one PIN step follows another (choose, then confirm).
 */
export function PinPad({ title, hint, onEntered }: { title: string; hint?: string; onEntered: (pin: string) => Promise<boolean> | boolean }) {
  const [pin, setPinValue] = useState('');
  const [bad, setBad] = useState(false);

  useEffect(() => {
    if (pin.length < 4) return;
    let live = true;
    void Promise.resolve(onEntered(pin)).then(ok => {
      if (!live) return;
      if (!ok) { setBad(true); setTimeout(() => { if (live) setBad(false); }, 450); }
      setPinValue('');
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const press = (d: string) => setPinValue(p => (p.length < 4 ? p + d : p));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPinValue(p => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="pinpad">
      <h2>{title}</h2>
      <p className="soft pin-hint">{hint ?? ''}</p>
      <div className={`pin-dots${bad ? ' bad' : ''}`} aria-label={`${pin.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map(i => <i key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      <div className="pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <button key={d} type="button" onClick={() => press(d)}>{d}</button>)}
        <span />
        <button type="button" onClick={() => press('0')}>0</button>
        <button type="button" className="back" onClick={() => setPinValue(p => p.slice(0, -1))} aria-label="Delete">⌫</button>
      </div>
    </div>
  );
}
