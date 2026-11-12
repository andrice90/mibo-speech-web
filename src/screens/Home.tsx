import { useEffect, useMemo, useState } from 'react';

import { hasConsent, loadConsent, saveConsent } from '../lesson/consent';
import { listCustomLessons } from '../lesson/custom';
import { LESSONS, type LessonInfo } from '../lesson/lessons';
import { loadProgress } from '../lesson/progress';
import { go } from '../lib/router';
import { hasPin, lock, setPin, validPin } from '../lib/zone';
import { MiboStage } from '../puppet/MiboStage';
import { newPuppet } from '../puppet/mibo';
import { ConsentCard } from '../ui/ConsentCard';
import { Bubble, Card, Column, Dialog } from '../ui/kit';
import { PinPad } from '../ui/PinPad';
import { C } from '../ui/theme';

/**
 * Home is the kid zone: the lessons, and where each one was left off. On
 * first use the grown-up agrees to the ground rules and chooses the PIN
 * that guards the grown-up zone. Opening this screen always locks that zone.
 */
export function Home() {
  const puppet = useMemo(newPuppet, []);
  const saved = useMemo(() => Object.fromEntries(LESSONS.map(l => [l.id, loadProgress(l.id)])), []);
  const made = useMemo(listCustomLessons, []);
  const [ask, setAsk] = useState<LessonInfo | null>(null);
  const [setup, setSetup] = useState<'consent' | 'pin' | 'done'>(() => (!hasConsent() ? 'consent' : !hasPin() ? 'pin' : 'done'));
  const [first, setFirst] = useState('');   // the PIN as first typed, waiting to be typed again

  useEffect(lock, []);

  const listenParam = () => (loadConsent()?.hear === false ? '0' : '1');
  const open = (l: LessonInfo, resume: boolean) => go('lesson', { lesson: l.id, from: String(resume ? saved[l.id]?.step ?? 0 : 0), listen: listenParam() });
  const pick = (l: LessonInfo) => { if ((saved[l.id]?.step ?? 0) > 0) setAsk(l); else open(l, false); };

  return (
    <div className="screen">
      <Column>
        <div className="hero">
          <div className="mini"><MiboStage puppet={puppet} /></div>
          <div>
            <h1>Mibo</h1>
            <p>{setup === 'done' ? 'Pick a lesson to play' : 'First, a grown-up sets things up'}</p>
          </div>
        </div>
        <div className="scroll"><div className="list">
          {setup === 'consent' && (
            <ConsentCard buttonLabel="Next" onDone={hear => { saveConsent(hear); setSetup(hasPin() ? 'done' : 'pin'); }} />
          )}
          {setup === 'pin' && (
            <Card>
              <PinPad key={first ? 'again' : 'first'} title={first ? 'Type it once more' : 'Choose a grown-up PIN 🔒'}
                hint={first ? 'Just to be sure.' : "Four digits. It opens the grown-up zone, where lessons are made and Mibo's notes are kept."}
                onEntered={async pin => {
                  if (!first) { if (!validPin(pin)) return false; setFirst(pin); return true; }
                  if (pin !== first) { setFirst(''); return false; }
                  await setPin(pin); setSetup('done'); return true;
                }} />
            </Card>
          )}
          {setup === 'done' && (
            <>
              {LESSONS.map(l => {
                const p = saved[l.id];
                return (
                  <button key={l.id} type="button" className="lesson" onClick={() => pick(l)}
                    style={{ backgroundColor: l.bg, borderColor: l.deep }} aria-label={`${l.title}: ${l.subtitle}`}>
                    <span className="badge">{l.emoji}</span>
                    <span className="text">
                      <span className="title" style={{ color: l.deep }}>{l.title}</span>
                      <span className="subtitle">{l.subtitle}</span>
                      {p && p.step > 0 && <span className="meta">{`Step ${p.step + 1} of ${l.steps}`}{p.stars ? `  ·  ⭐ ${p.stars}` : ''}</span>}
                    </span>
                    <span className="go" style={{ color: l.deep }}>{p && p.step > 0 ? 'Continue' : 'Play'}</span>
                  </button>
                );
              })}
              {made.map(l => (
                <button key={l.id} type="button" className="lesson" style={{ backgroundColor: C.rose, borderColor: C.roseDeep }}
                  aria-label={`${l.plan.title}: ${l.plan.subtitle}`} onClick={() => go('lesson', { custom: l.id, listen: listenParam() })}>
                  <span className="badge">{l.plan.emoji}</span>
                  <span className="text">
                    <span className="title" style={{ color: C.roseDeep }}>{l.plan.title}</span>
                    <span className="subtitle">{l.plan.subtitle}</span>
                  </span>
                  <span className="go" style={{ color: C.roseDeep }}>Play</span>
                </button>
              ))}
              <button type="button" className="grownups" onClick={() => go('parent')}>🔒 Grown-ups</button>
            </>
          )}
        </div></div>

        {ask && (
          <Dialog onClose={() => setAsk(null)}>
            <div className="big">{ask.emoji}</div>
            <h2>Pick up where you left off?</h2>
            <p>{`${ask.title}, step ${(saved[ask.id]?.step ?? 0) + 1} of ${ask.steps}`}</p>
            <div className="row"><Bubble label="Continue" bg={C.mint} deep={C.mintDeep} onPress={() => open(ask, true)} /></div>
            <div className="row"><Bubble small label="Start over" bg={C.peach} deep={C.peachDeep} onPress={() => open(ask, false)} /></div>
          </Dialog>
        )}
      </Column>
    </div>
  );
}
