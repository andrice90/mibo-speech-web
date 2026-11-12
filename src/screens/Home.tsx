import { useEffect, useMemo, useState } from 'react';

import { DEVICE_LABEL, deviceAiStatus, type DeviceAi } from '../ai/device';
import { firebaseReady } from '../ai/firebase';
import { warmDeviceModel } from '../ai/reply';
import { hasConsent, loadConsent, saveConsent } from '../lesson/consent';
import { deleteCustomLesson, listCustomLessons, type CustomLesson } from '../lesson/custom';
import { LESSONS, type LessonInfo } from '../lesson/lessons';
import { loadProgress } from '../lesson/progress';
import { allResults } from '../lesson/results';
import { go } from '../lib/router';
import { MiboStage } from '../puppet/MiboStage';
import { newPuppet } from '../puppet/mibo';
import { ConsentCard } from '../ui/ConsentCard';
import { Bubble, Column, Dialog } from '../ui/kit';
import { C } from '../ui/theme';

/** Home: the lessons, where each one was left off, and the grown-up's corner. Everything shown is stored on this device only. */
export function Home() {
  const puppet = useMemo(newPuppet, []);
  const saved = useMemo(() => Object.fromEntries(LESSONS.map(l => [l.id, loadProgress(l.id)])), []);
  const [made, setMade] = useState<CustomLesson[]>(listCustomLessons);
  const [ask, setAsk] = useState<LessonInfo | null>(null);
  const [del, setDel] = useState<CustomLesson | null>(null);
  // the grown-up's consent is given once, at first app start; after that lessons just start
  const [consented, setConsented] = useState(hasConsent);
  const [device, setDevice] = useState<DeviceAi | null>(null);
  const practised = useMemo(() => allResults().length, []);

  useEffect(() => { void deviceAiStatus().then(setDevice); }, []);

  const open = (l: LessonInfo, resume: boolean) => {
    void warmDeviceModel();   // a tap: the browser may start fetching its on-device model now
    go('welcome', { lesson: l.id, resume: resume ? '1' : '0' });
  };
  const pick = (l: LessonInfo) => {
    if ((saved[l.id]?.step ?? 0) > 0) setAsk(l); else open(l, false);
  };

  return (
    <div className="screen">
      <Column>
        <div className="hero">
          <div className="mini"><MiboStage puppet={puppet} /></div>
          <div>
            <h1>Mibo</h1>
            <p>Pick a lesson to play</p>
          </div>
        </div>
        {!consented ? (
          <div className="scroll"><div className="list">
            <ConsentCard buttonLabel="Start playing" onDone={hear => { saveConsent(hear); setConsented(true); }} />
          </div></div>
        ) : (
          <div className="scroll"><div className="list">
            {LESSONS.map(l => {
              const p = saved[l.id];
              return (
                <button key={l.id} type="button" className="lesson" onClick={() => pick(l)}
                  style={{ backgroundColor: l.bg, borderColor: l.deep }} aria-label={`${l.title}: ${l.subtitle}`}>
                  <span className="badge">{l.emoji}</span>
                  <span className="text">
                    <span className="title" style={{ color: l.deep }}>{l.title}</span>
                    <span className="subtitle">{l.subtitle}</span>
                    {p && p.step > 0 && (
                      <span className="meta">
                        {`Step ${p.step + 1} of ${l.steps}`}{p.stars ? `  ·  ⭐ ${p.stars}` : ''}{p.name ? `  ·  ${p.name}` : ''}
                      </span>
                    )}
                  </span>
                  <span className="go" style={{ color: l.deep }}>{p && p.step > 0 ? 'Continue' : 'Play'}</span>
                </button>
              );
            })}
            {made.map(l => (
              <div key={l.id} className="lesson" style={{ backgroundColor: C.rose, borderColor: C.roseDeep }}>
                <button type="button" className="main" aria-label={`${l.plan.title}: ${l.plan.subtitle}`}
                  onClick={() => { void warmDeviceModel(); go('lesson', { custom: l.id, listen: loadConsent()?.hear === false ? '0' : '1' }); }}>
                  <span className="badge">{l.plan.emoji}</span>
                  <span className="text">
                    <span className="title" style={{ color: C.roseDeep }}>{l.plan.title}</span>
                    <span className="subtitle">{l.plan.subtitle}</span>
                    <span className="meta">{l.plan.words.map(w => w.word).join(' · ')}</span>
                  </span>
                  <span className="go" style={{ color: C.roseDeep }}>Play</span>
                </button>
                <button type="button" className="del" style={{ color: C.roseDeep }} onClick={() => setDel(l)} aria-label={`Delete ${l.plan.title}`}>×</button>
              </div>
            ))}
            <button type="button" className="lesson dashed" style={{ backgroundColor: '#ffeef4', borderColor: C.roseDeep }} onClick={() => go('create')}>
              <span className="badge">✨</span>
              <span className="text">
                <span className="title" style={{ color: C.roseDeep }}>Make a new lesson</span>
                <span className="subtitle">Grown-ups: choose the words, Mibo plans it</span>
              </span>
              <span className="go" style={{ color: C.roseDeep }}>Make</span>
            </button>
            <button type="button" className="lesson dashed" style={{ backgroundColor: '#f1ecff', borderColor: C.lavenderDeep }} onClick={() => go('report')}>
              <span className="badge">📒</span>
              <span className="text">
                <span className="title" style={{ color: C.lavenderDeep }}>{"Mibo's notes"}</span>
                <span className="subtitle">Grown-ups: how practice is going</span>
                {practised > 0 && <span className="meta">{`${practised} word${practised === 1 ? '' : 's'} and games practised`}</span>}
              </span>
              <span className="go" style={{ color: C.lavenderDeep }}>Read</span>
            </button>
            <p className="ai-status">
              {!firebaseReady
                ? <><b>Offline mode:</b> Firebase is not set up in this build, so Mibo uses his bundled lines.</>
                : device === null ? ' '
                : device === 'available'
                  ? <><b>🔒 {DEVICE_LABEL[device]}.</b> Mibo writes his replies and notes on this device; his voice and new lessons come from the cloud.</>
                  : <><b>☁️ {DEVICE_LABEL[device]}.</b> Mibo writes his replies in the cloud for now. Practice results stay on this device.</>}
            </p>
          </div></div>
        )}

        {ask && (
          <Dialog onClose={() => setAsk(null)}>
            <div className="big">{ask.emoji}</div>
            <h2>Pick up where you left off?</h2>
            <p>
              {`${ask.title}, step ${(saved[ask.id]?.step ?? 0) + 1} of ${ask.steps}`}
              {saved[ask.id]?.name ? ` with ${saved[ask.id]?.name}` : ''}
            </p>
            <div className="row"><Bubble label="Continue" bg={C.mint} deep={C.mintDeep} onPress={() => open(ask, true)} /></div>
            <div className="row"><Bubble small label="Start over" bg={C.peach} deep={C.peachDeep} onPress={() => open(ask, false)} /></div>
          </Dialog>
        )}
        {del && (
          <Dialog onClose={() => setDel(null)}>
            <div className="big">{del.plan.emoji}</div>
            <h2>Delete this lesson?</h2>
            <p>{`“${del.plan.title}” and Mibo's voice for it will be removed from this device.`}</p>
            <div className="row">
              <Bubble label="Delete lesson" bg={C.rose} deep={C.roseDeep}
                onPress={() => { deleteCustomLesson(del.id); setDel(null); setMade(listCustomLessons()); }} />
            </div>
            <div className="row"><Bubble small label="Keep it" bg={C.mint} deep={C.mintDeep} onPress={() => setDel(null)} /></div>
          </Dialog>
        )}
      </Column>
    </div>
  );
}
