import { useEffect, useMemo, useState } from 'react';

import { hasConsent, loadConsent } from '../lesson/consent';
import { listCustomLessons } from '../lesson/custom';
import { LESSONS, type LessonInfo } from '../lesson/lessons';
import { loadProgress } from '../lesson/progress';
import { go } from '../lib/router';
import { hasPin, lock } from '../lib/zone';
import { MiboStage } from '../puppet/MiboStage';
import { newPuppet } from '../puppet/mibo';
import { Bubble, Column, Dialog } from '../ui/kit';
import { Onboarding } from '../ui/Onboarding';
import { C } from '../ui/theme';

/**
 * Home is the kid zone: the lessons, and where each one was left off. On
 * first use it shows the three-step setup for the grown-up (ui/Onboarding). Opening this screen always locks that zone.
 */
export function Home() {
  const puppet = useMemo(newPuppet, []);
  const saved = useMemo(() => Object.fromEntries(LESSONS.map(l => [l.id, loadProgress(l.id)])), []);
  const made = useMemo(listCustomLessons, []);
  const [ask, setAsk] = useState<LessonInfo | null>(null);
  const [setup, setSetup] = useState<'welcome' | 'pin' | 'done'>(() => (!hasConsent() ? 'welcome' : !hasPin() ? 'pin' : 'done'));

  useEffect(lock, []);

  const listenParam = () => (loadConsent()?.hear === false ? '0' : '1');
  const open = (l: LessonInfo, resume: boolean) => go('lesson', { lesson: l.id, from: String(resume ? saved[l.id]?.step ?? 0 : 0), listen: listenParam() });
  const pick = (l: LessonInfo) => { if ((saved[l.id]?.step ?? 0) > 0) setAsk(l); else open(l, false); };

  return (
    <div className="screen">
      <Column>
        <div className="hero">
          <div className="mini"><MiboStage puppet={puppet} /></div>
          <div className="hero-text">
            <h1>Mibo</h1>
            <p>{setup === 'done' ? 'Pick a lesson to play' : 'First, a grown-up sets things up'}</p>
          </div>
          {setup === 'done' && (
            <button type="button" className="zone-btn" onClick={() => go('parent')}>
              <span className="lock">🔒</span>
              <span><b>Grown-up Zone</b><small>New lessons, progress reports</small></span>
            </button>
          )}
        </div>
        <div className="scroll"><div className="list">
          {setup !== 'done' && <Onboarding from={setup} onDone={() => setSetup('done')} />}
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
                <button key={l.id} type="button" className="lesson" style={{ backgroundColor: C.teal, borderColor: C.tealDeep }}
                  aria-label={`${l.plan.title}: ${l.plan.subtitle}`} onClick={() => go('lesson', { custom: l.id, listen: listenParam() })}>
                  <span className="badge">{l.plan.emoji}</span>
                  <span className="text">
                    <span className="title" style={{ color: C.tealDeep }}>{l.plan.title}</span>
                    <span className="subtitle">{l.plan.subtitle}</span>
                  </span>
                  <span className="go" style={{ color: C.tealDeep }}>Play</span>
                </button>
              ))}
            </>
          )}
        </div></div>

        {ask && (
          <Dialog onClose={() => setAsk(null)}>
            <div className="big">{ask.emoji}</div>
            <h2>Pick up where you left off?</h2>
            <p>{`${ask.title}, step ${(saved[ask.id]?.step ?? 0) + 1} of ${ask.steps}`}</p>
            <div className="row"><Bubble label="Continue" bg={C.mint} deep={C.mintDeep} onPress={() => open(ask, true)} /></div>
            <div className="row"><Bubble small label="Start over" bg={C.lavender} deep={C.lavenderDeep} onPress={() => open(ask, false)} /></div>
          </Dialog>
        )}
      </Column>
    </div>
  );
}
