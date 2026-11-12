import { useEffect, useMemo, useRef, useState } from 'react';

import { onCloudBusy } from '../ai/firebase';
import { MiboStage } from '../puppet/MiboStage';
import { newPuppet } from '../puppet/mibo';

const MIN_SHOW = 2000;   // ms a status line stays on screen at the least

/**
 * What the grown-up sees while Mibo works on something slow: Mibo thinking,
 * a progress bar, and a plain-words line that changes every few seconds.
 *
 * `progress` (0..1) is real progress when the job has countable steps (voice
 * lines made). Without it the bar fills on a curve against `estimate`
 * seconds: quick at first, slowing, never quite full until the job ends.
 * When the cloud is busy and a call is being tried again, the line says so.
 * The line fades in only when it changes to a different line, and each
 * line stays up for at least two seconds.
 */
export function Working({ messages, progress, estimate = 20, title, detail }: {
  messages: string[]; progress?: number; estimate?: number; title: string;
  /** A figure that changes often (a download percentage). It sits beside the bar and updates in place. */
  detail?: string;
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
  const wanted = busy ? 'The cloud is busy just now. Mibo is asking again…' : messages[Math.floor(t / 3.5) % messages.length];

  // every line stays up for at least MIN_SHOW, however quickly the job moves on, so none flashes past unread
  const [line, setLine] = useState(wanted);
  const since = useRef(Date.now());
  useEffect(() => {
    if (wanted === line) return;
    const wait = Math.max(0, MIN_SHOW - (Date.now() - since.current));
    const timer = setTimeout(() => { since.current = Date.now(); setLine(wanted); }, wait);
    return () => clearTimeout(timer);
  }, [wanted, line]);

  return (
    <div className="working" role="status" aria-live="polite">
      <div className="working-mibo"><MiboStage puppet={puppet} /></div>
      <h2>{title}</h2>
      <div className="working-bar">
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)}>
          <i style={{ width: `${shown * 100}%` }} />
        </div>
        {detail && <span className="working-detail">{detail}</span>}
      </div>
      {/* keyed by the line, so the fade plays when the line changes and never when a number ticks */}
      <p key={line} className="working-line">{line}</p>
      {t > 45 && <p className="note">This is taking a little longer than usual. Mibo is still working on it.</p>}
    </div>
  );
}
