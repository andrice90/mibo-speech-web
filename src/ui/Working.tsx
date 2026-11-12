import { useEffect, useMemo, useState } from 'react';

import { onCloudBusy } from '../ai/firebase';
import { MiboStage } from '../puppet/MiboStage';
import { newPuppet } from '../puppet/mibo';

/**
 * What the grown-up sees while Mibo works on something slow: Mibo thinking,
 * a progress bar, and a plain-words line that changes every few seconds.
 *
 * `progress` (0..1) is real progress when the job has countable steps (voice
 * lines made). Without it the bar fills on a curve against `estimate`
 * seconds: quick at first, slowing, never quite full until the job ends.
 * When the cloud is busy and a call is being tried again, the line says so.
 */
export function Working({ messages, progress, estimate = 20, title }: {
  messages: string[]; progress?: number; estimate?: number; title: string;
}) {
  const puppet = useMemo(() => { const p = newPuppet(); p.setMood('thinking'); return p; }, []);
  const [t, setT] = useState(0);            // seconds waited
  const [busyAt, setBusyAt] = useState(-1);  // when the cloud last made us try again

  useEffect(() => {
    const t0 = Date.now();
    const timer = setInterval(() => setT((Date.now() - t0) / 1000), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => onCloudBusy(() => setBusyAt(Date.now())), []);

  const curve = 1 - Math.exp(-t / estimate);
  // real progress leads; a little time-based creep keeps the bar alive between steps
  const shown = progress === undefined ? 0.92 * curve : Math.min(0.98, progress * 0.94 + 0.04 * curve + 0.02);
  const busy = busyAt > 0 && Date.now() - busyAt < 6000;
  const line = busy ? 'The cloud is busy just now. Mibo is asking again…' : messages[Math.floor(t / 3.5) % messages.length];

  return (
    <div className="working" role="status" aria-live="polite">
      <div className="working-mibo"><MiboStage puppet={puppet} /></div>
      <h2>{title}</h2>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)}>
        <i style={{ width: `${shown * 100}%` }} />
      </div>
      <p key={line} className="working-line">{line}</p>
      {t > 45 && <p className="note">This is taking longer than usual. You can keep waiting; Mibo is still working.</p>}
    </div>
  );
}
