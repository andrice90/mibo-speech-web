import { useEffect, useRef, useState } from 'react';

import { cloudError, firebaseReady } from '../ai/firebase';
import { generatePlan } from '../ai/plan';
import { speak } from '../ai/tts';
import { newLessonId, saveCustomLesson, type CustomLesson } from '../lesson/custom';
import { clipTexts, TOPIC_MAX, validTopic, type LessonPlan } from '../lesson/plan';
import { go } from '../lib/router';
import { deleteAudio, putAudio } from '../lib/store';
import { Bubble, Card, Column, ZoneBar } from '../ui/kit';
import { Working } from '../ui/Working';
import { C } from '../ui/theme';
import { makeTemplate, type Templates } from '../voice/wordcheck';

type Stage = 'ask' | 'planning' | 'review' | 'voicing' | 'error';
const PLANNING = [
  'Mibo is picking the words…', 'Finding a picture for each one…', 'Thinking up a silly warm-up…',
  'Writing a cheer for every word…', 'Making a listening game…', 'Checking it is all kid-friendly…',
];
const VOICING = [
  'Mibo is warming up his voice…', 'Saying each word nice and slowly…', 'Recording a cheer for every word…',
  'Working out how his mouth moves…', 'Listening back to each line…', 'Saving the lesson on this device…',
];
const EXAMPLES = ['S words about animals', 'Food words', 'Sh words about the sea', 'Words about vehicles', 'Z words at the zoo'];

/**
 * Make a lesson (grown-up zone, the cloud half of the hybrid split). The
 * grown-up says what words to work on; Gemini in the cloud writes a plan;
 * the grown-up checks it; only then does the cloud voice speak its lines.
 * Everything the lesson will ever say is made here and saved on the device,
 * along with a template for each word, so the kid zone can play and check
 * the lesson with no AI at all.
 *
 * `?topic=` and `?bringBack=` arrive from Mibo's notes: a lesson idea the
 * on-device model suggested, and words from the practice log worth another go.
 */
export function Create({ params }: { params: Record<string, string> }) {
  const [topic, setTopic] = useState((params.topic ?? '').slice(0, TOPIC_MAX));
  const [bringBack, setBringBack] = useState(() => (params.bringBack ?? '').split(',').filter(w => /^[a-z][a-z'-]*$/.test(w)).slice(0, 3));
  const [stage, setStage] = useState<Stage>('ask');
  const [plan, setPlan] = useState<LessonPlan | null>(null);
  const [error, setError] = useState('');
  const [voiced, setVoiced] = useState(0);
  const here = useRef(true);
  useEffect(() => { here.current = true; return () => { here.current = false; }; }, []);

  const makePlan = async (t: string) => {
    const what = t.trim();
    if (!validTopic(what)) return;
    setTopic(what); setStage('planning'); setError('');
    try {
      const p = await generatePlan(what, bringBack);
      if (!here.current) return;
      setPlan(p); setStage('review');
    } catch (e) {
      console.warn('[plan]', e);
      if (!here.current) return;
      setError(cloudError(e, 'Mibo could not reach the cloud to plan that lesson. Check the connection and try again.'));
      setStage('error');
    }
  };

  const accept = async () => {
    if (!plan) return;
    setStage('voicing'); setError(''); setVoiced(0);
    const id = newLessonId(), keys: string[] = [];
    let failed = false;
    try {
      const clips: CustomLesson['clips'] = {}, templates: Templates = {};
      await Promise.all(Object.entries(clipTexts(plan)).map(async ([cid, text]) => {
        const s = await speak(text);
        if (failed || !here.current) return;   // another line failed, or the grown-up left: keep nothing
        const key = `lesson-${id}-${cid}`;
        keys.push(key);
        await putAudio(key, s.wav);
        clips[cid] = { uri: `idb:${key}`, text, visemes: s.visemes, seconds: s.seconds };
        // the word's template for the on-device check comes from Mibo's own model clip
        const word = /^dyn_word_(.+)$/.exec(cid)?.[1];
        const tpl = word ? makeTemplate(s.samples, s.sr) : null;
        if (word && tpl) templates[word] = tpl;
        setVoiced(n => n + 1);
      }));
      if (!here.current) { keys.forEach(k => void deleteAudio(k)); return; }
      if (!saveCustomLesson({ id, createdAt: Date.now(), plan, clips, templates })) throw new Error('This device is out of space for new lessons.');
      go('parent', {}, { replace: true });
    } catch (e) {
      failed = true;
      console.warn('[voice]', e);
      keys.forEach(k => void deleteAudio(k));
      if (!here.current) return;
      setError(cloudError(e, "Mibo's voice failed just now. Try again."));
      setStage('review');
    }
  };

  const lines = plan ? Object.keys(clipTexts(plan)).length : 0;

  return (
    <div className="screen">
      <Column>
        <ZoneBar title="Make a new lesson" onBack={() => go('parent', {}, { replace: true })} />
        <div className="scroll"><div className="body">
          <p className="center soft" style={{ fontSize: 15, lineHeight: '21px' }}>
            Tell Mibo what words to work on. Gemini writes a plan in the cloud for you to check. Only what you see on this
            page is sent, and nothing is made until you say yes.
          </p>

          {stage === 'planning' && (
            <Card><Working title={`Planning “${topic}”`} messages={PLANNING} estimate={18} /></Card>
          )}
          {stage === 'voicing' && plan && (
            <Card><Working title={`Giving “${plan.title}” its voice`} messages={VOICING} progress={lines ? voiced / lines : 0} estimate={40} /></Card>
          )}

          {(stage === 'ask' || stage === 'error') && (
            <Card className="stack">
              <h2>What words shall we practise?</h2>
              <input className="input" value={topic} onChange={e => setTopic(e.target.value)} maxLength={TOPIC_MAX}
                placeholder="e.g. S words about animals" enterKeyHint="done" autoComplete="off"
                onKeyDown={e => { if (e.key === 'Enter') void makePlan(topic); }} />
              <div className="chips">
                {EXAMPLES.map(x => <button key={x} type="button" className="chip" onClick={() => void makePlan(x)}>{x}</button>)}
              </div>
              {bringBack.length > 0 && (
                <>
                  <h3 style={{ fontWeight: 700, fontSize: 15 }}>Bring back from the practice log</h3>
                  <div className="chips">
                    {bringBack.map(w => (
                      <button key={w} type="button" className="idea" onClick={() => setBringBack(b => b.filter(x => x !== w))} aria-label={`Leave out ${w}`}>{w} ×</button>
                    ))}
                  </div>
                  <p className="note">These words took more than one go. They will be sent with your topic so the new lesson includes them. Tap one to leave it out.</p>
                </>
              )}
              {stage === 'error' && <p className="err">{error}</p>}
              {!firebaseReady && <p className="err">This build has no Firebase setup yet, so new lessons cannot be made (see the README).</p>}
              <div className="row">
                <Bubble label="Make my lesson plan" bg={C.mint} deep={C.mintDeep}
                  disabled={!validTopic(topic) || !firebaseReady} onPress={() => void makePlan(topic)} />
              </div>
              <p className="note">Mibo is a practice buddy, not a speech therapist. Made lessons are AI-written: please check the words before playing.</p>
            </Card>
          )}

          {stage === 'review' && plan && (
            <Card className="stack">
              <div className="plan-emoji">{plan.emoji}</div>
              <h2 className="center">{plan.title}</h2>
              <p className="center soft" style={{ fontWeight: 600 }}>{plan.subtitle}</p>
              <p className="plan-line">“{plan.introLine}”</p>
              <div className="words">
                {plan.words.map(w => <div key={w.word}><span>{w.emoji}</span>{w.word}</div>)}
              </div>
              {plan.words.map(w => <p key={w.word} className="plan-line soft">“{w.praiseLine}”</p>)}
              <p className="plan-line">Game: “{plan.pick.askLine}”</p>
              <p className="plan-line">“{plan.byeLine}”</p>
              {!!error && <p className="err">{error}</p>}
              <div className="row">
                <Bubble label="Yes, make the voice" bg={C.mint} deep={C.mintDeep} onPress={() => void accept()} />
              </div>
              <div className="row">
                <Bubble small label="Try different words" bg={C.lavender} deep={C.lavenderDeep}
                  onPress={() => { setStage('ask'); setPlan(null); }} />
              </div>
              <div className="row">
                <Bubble small label="Re-roll this plan" bg={C.lavender} deep={C.lavenderDeep}
                  onPress={() => void makePlan(topic)} />
              </div>
            </Card>
          )}
        </div></div>
      </Column>
    </div>
  );
}
