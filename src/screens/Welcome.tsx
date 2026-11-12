import { useEffect, useMemo, useState } from 'react';

import { firebaseReady } from '../ai/firebase';
import { preloadClips } from '../lesson/clips';
import { hasConsent, loadConsent, saveConsent } from '../lesson/consent';
import { clipsFor, planFor } from '../lesson/content';
import { LESSONS } from '../lesson/lessons';
import { forgetLearnedName, forgetName, learnedNames, makeNameLines, pickLearnedName, restoreName, savedName, validName } from '../lesson/name';
import { clearProgress, loadProgress, saveProgress } from '../lesson/progress';
import { go, goHome } from '../lib/router';
import { MiboStage } from '../puppet/MiboStage';
import { newPuppet } from '../puppet/mibo';
import { ConsentCard } from '../ui/ConsentCard';
import { Bubble, Card, Column, HomeButton, Spinner } from '../ui/kit';
import { C } from '../ui/theme';
import { stopAudio } from '../voice/player';

type Stage = 'ask' | 'making' | 'ready';
const CHIP = [C.mint, C.lavender, C.butter, C.peach, C.sky, C.rose];

/**
 * Before a lesson. The grown-up picks or types the child's name (or skips),
 * silently: nothing is spoken on this screen. The greeting and the lesson's
 * first line play as one combined intro on the lesson screen.
 * Resuming (?resume=1) skips the name: the saved one and its clips are used.
 */
export function Welcome({ params }: { params: Record<string, string> }) {
  const puppet = useMemo(newPuppet, []);
  const lessonId = params.lesson ?? 's-th';
  const resume = useMemo(() => (params.resume === '1' ? loadProgress(lessonId) : null), [params.resume, lessonId]);
  const [stage, setStage] = useState<Stage>(resume ? 'making' : 'ask');
  const [name, setName] = useState('');
  const [known, setKnown] = useState<string[]>(learnedNames);

  const start = (hear: boolean) => {
    stopAudio(); puppet.stop();
    go('lesson', { listen: hear ? '1' : '0', lesson: lessonId, from: String(resume?.step ?? 0) }, { replace: true });
  };

  const intro = async (useName: boolean, restored = false) => {
    setStage('making');
    puppet.setMood('thinking');
    const named = restored ? !!savedName() : useName && await makeNameLines(name);
    // remember the name and its clips with this lesson's progress, on this device only
    const sn = savedName();
    if (named && sn) saveProgress(lessonId, { name: sn.name, nameLines: sn.lines });
    if (hasConsent()) { start(loadConsent()?.hear ?? true); return; }
    setStage('ready');
  };

  useEffect(() => {
    if (resume) {
      // picking up where they left off: the saved name (if any), no questions
      restoreName(resume.name, resume.nameLines);
      void intro(false, true);
    } else {
      clearProgress(lessonId);   // starting over: forget the old place and name
      forgetName();
      // the name step is the grown-up's: Mibo just waves and stays quiet until it is done
      puppet.setMood('happy');
      puppet.act('wave');
    }
    void preloadClips(clipsFor(planFor(lessonId)));   // the lesson's voice, while the grown-up types
    return () => { stopAudio(); puppet.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puppet]);

  return (
    <div className="screen">
      <Column>
        <HomeButton floating onPress={() => { stopAudio(); puppet.stop(); goHome(); }} />
        {stage !== 'ready' && (
          <div className="title-block">
            <h1>{"Hi, I'm Mibo!"}</h1>
            <p>{LESSONS.find(l => l.id === lessonId)?.subtitle ?? 'Let’s practise together'}</p>
          </div>
        )}
        <div className="welcome-stage" style={stage === 'ready' ? { maxHeight: 220 } : undefined}>
          <MiboStage puppet={puppet} />
        </div>
        <div className="sheet">
          {stage === 'ask' && (
            <Card className="stack">
              <h2>{known.length ? "Who's playing? 😊" : firebaseReady ? "What's your name? 😊" : 'Ready to play? 😊'}</h2>
              {known.length > 0 && (
                <div className="chips">
                  {known.map((n, i) => (
                    <div key={n} className="name-chip" style={{ backgroundColor: CHIP[i % CHIP.length] }}>
                      <button type="button" className="n" onClick={() => { if (pickLearnedName(n)) void intro(false, true); }} aria-label={`Play as ${n}`}>{n}</button>
                      <button type="button" className="x" onClick={() => { forgetLearnedName(n); setKnown(learnedNames()); }} aria-label={`Forget ${n}`}>×</button>
                    </div>
                  ))}
                </div>
              )}
              {firebaseReady && (
                <>
                  <input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={20} autoCapitalize="words"
                    autoCorrect="off" autoComplete="off" enterKeyHint="done" placeholder={known.length ? 'Add a new name' : "Your child's first name"}
                    onKeyDown={e => { if (e.key === 'Enter' && validName(name)) void intro(true); }} />
                  <p className="note">
                    Grown-up: type the first name so Mibo can say it. It is sent once to the cloud voice (Gemini, through Firebase) to make
                    four spoken lines, then kept on this device. It never goes to the AI that writes his replies or his notes.
                  </p>
                  <div className="row">
                    <Bubble label="Let's go!" bg={C.mint} deep={C.mintDeep} disabled={!validName(name)} onPress={() => void intro(true)} />
                  </div>
                </>
              )}
              {firebaseReady
                ? <button type="button" className="skip" onClick={() => void intro(false)}>Skip</button>
                : <div className="row"><Bubble label="Let's go!" bg={C.mint} deep={C.mintDeep} onPress={() => void intro(false)} /></div>}
            </Card>
          )}
          {stage === 'making' && (
            <Card className="busy"><Spinner /><span>{resume ? 'Getting ready…' : 'Mibo is learning your name…'}</span></Card>
          )}
          {stage === 'ready' && <ConsentCard buttonLabel="Let's play!" onDone={hear => { saveConsent(hear); start(hear); }} />}
        </div>
      </Column>
    </div>
  );
}
