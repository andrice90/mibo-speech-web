import { useState } from 'react';

import { firebaseReady } from '../ai/firebase';
import { generatePlan } from '../ai/plan';
import { speak } from '../ai/tts';
import { loadConsent } from '../lesson/consent';
import { newLessonId, saveCustomLesson, type CustomLesson } from '../lesson/custom';
import { clipTexts, TOPIC_MAX, validTopic, type LessonPlan } from '../lesson/plan';
import { go, goHome } from '../lib/router';
import { deleteAudio, putAudio } from '../lib/store';
import { Bubble, Card, Column, HomeButton, Spinner } from '../ui/kit';
import { C } from '../ui/theme';

type Stage = 'ask' | 'planning' | 'review' | 'voicing' | 'error';
const EXAMPLES = ['S words about animals', 'Food words', 'Sh words about the sea', 'Words about vehicles', 'Z words at the zoo'];

/**
 * Make a lesson (grown-up flow): type the kind of words to work on, Gemini
 * in the cloud writes a plan, the grown-up checks it, and only on "make the
 * voice" does the cloud voice speak its lines. The finished lesson is saved
 * on this device. `?topic=` arrives from an idea in Mibo's notes.
 */
export function Create({ params }: { params: Record<string, string> }) {
  const [topic, setTopic] = useState((params.topic ?? '').slice(0, TOPIC_MAX));
  const [stage, setStage] = useState<Stage>('ask');
  const [plan, setPlan] = useState<LessonPlan | null>(null);
  const [error, setError] = useState('');
  const [voiced, setVoiced] = useState(0);

  const makePlan = async (t: string) => {
    const what = t.trim();
    if (!validTopic(what)) return;
    setTopic(what); setStage('planning'); setError('');
    try {
      setPlan(await generatePlan(what)); setStage('review');
    } catch (e) {
      console.warn('[plan]', e);
      const msg = (e as Error).message;
      setError(/dream up|Firebase/.test(msg) ? msg : 'Mibo could not reach the cloud to plan that lesson. Check the connection and try again.');
      setStage('error');
    }
  };

  const accept = async () => {
    if (!plan) return;
    setStage('voicing'); setError(''); setVoiced(0);
    const id = newLessonId(), keys: string[] = [];
    try {
      const clips: CustomLesson['clips'] = {};
      await Promise.all(Object.entries(clipTexts(plan)).map(async ([cid, text]) => {
        const s = await speak(text);
        const key = `lesson-${id}-${cid}`;
        keys.push(key);
        await putAudio(key, s.wav);
        clips[cid] = { uri: `idb:${key}`, text, visemes: s.visemes, seconds: s.seconds };
        setVoiced(n => n + 1);
      }));
      if (!saveCustomLesson({ id, createdAt: Date.now(), plan, clips })) throw new Error('This device is out of space for new lessons.');
      go('lesson', { custom: id, listen: loadConsent()?.hear === false ? '0' : '1' }, { replace: true });
    } catch (e) {
      console.warn('[voice]', e);
      keys.forEach(k => void deleteAudio(k));
      const msg = (e as Error).message;
      setError(/out of space/.test(msg) ? msg : /resting|429/.test(msg)
        ? "Mibo's voice has hit its free limit for the moment. Wait a minute and try again."
        : "Mibo's voice failed just now. Try again.");
      setStage('review');
    }
  };

  const lines = plan ? Object.keys(clipTexts(plan)).length : 0;

  return (
    <div className="screen">
      <Column>
        <HomeButton floating onPress={goHome} />
        <div className="scroll"><div className="body">
          <h1 className="center" style={{ fontSize: 32, fontWeight: 700 }}>Make a new lesson ✨</h1>
          <p className="center soft" style={{ fontSize: 15, lineHeight: '21px' }}>
            For the grown-up: tell Mibo what words to work on. Gemini writes a plan in the cloud for you to check. Only the words
            you type here are sent, and nothing is made until you say yes.
          </p>

          {(stage === 'ask' || stage === 'error' || stage === 'planning') && (
            <Card className="stack">
              <h2>What words shall we practise?</h2>
              <input className="input" value={topic} onChange={e => setTopic(e.target.value)} maxLength={TOPIC_MAX}
                placeholder="e.g. S words about animals" enterKeyHint="done" autoComplete="off"
                onKeyDown={e => { if (e.key === 'Enter') void makePlan(topic); }} />
              <div className="chips">
                {EXAMPLES.map(x => <button key={x} type="button" className="chip" onClick={() => void makePlan(x)}>{x}</button>)}
              </div>
              {stage === 'error' && <p className="err">{error}</p>}
              {!firebaseReady && <p className="err">This build has no Firebase setup yet, so new lessons cannot be made (see the README).</p>}
              <div className="row">
                <Bubble label={stage === 'planning' ? 'Mibo is thinking…' : 'Make my lesson plan'} bg={C.mint} deep={C.mintDeep}
                  disabled={!validTopic(topic) || stage === 'planning' || !firebaseReady} onPress={() => void makePlan(topic)} />
              </div>
              {stage === 'planning' && <Spinner />}
              <p className="note">Mibo is a practice buddy, not a speech therapist. Made lessons are AI-written: please check the words before playing.</p>
            </Card>
          )}

          {(stage === 'review' || stage === 'voicing') && plan && (
            <Card className="stack">
              <div className="plan-emoji">{plan.emoji}</div>
              <h2 className="center">{plan.title}</h2>
              <p className="center soft" style={{ fontWeight: 600 }}>{plan.subtitle}</p>
              <p className="plan-line">“{plan.introLine}”</p>
              <div className="words">
                {plan.words.map(w => <div key={w.word}><span>{w.emoji}</span>{w.word}</div>)}
              </div>
              <p className="plan-line">Game: “{plan.pick.askLine}”</p>
              <p className="plan-line">“{plan.byeLine}”</p>
              {!!error && <p className="err">{error}</p>}
              <div className="row">
                <Bubble label={stage === 'voicing' ? `Making Mibo's voice… ${voiced}/${lines}` : 'Yes, make the voice'} bg={C.mint} deep={C.mintDeep}
                  disabled={stage === 'voicing'} onPress={() => void accept()} />
              </div>
              {stage === 'voicing' && <Spinner />}
              <div className="row">
                <Bubble small label="Try different words" bg={C.peach} deep={C.peachDeep} disabled={stage === 'voicing'}
                  onPress={() => { setStage('ask'); setPlan(null); }} />
              </div>
              <div className="row">
                <Bubble small label="Re-roll this plan" bg={C.lavender} deep={C.lavenderDeep} disabled={stage === 'voicing'}
                  onPress={() => void makePlan(topic)} />
              </div>
            </Card>
          )}
        </div></div>
      </Column>
    </div>
  );
}
