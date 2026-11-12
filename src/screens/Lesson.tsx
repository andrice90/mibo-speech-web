import { useEffect, useMemo, useState } from 'react';

import { planFor, stepSounds } from '../lesson/content';
import { buildSteps, dynClips as madeClips, getCustomLesson } from '../lesson/custom';
import { LESSONS } from '../lesson/lessons';
import { nameClip } from '../lesson/name';
import { clearProgress, loadProgress, saveProgress } from '../lesson/progress';
import { useLesson } from '../lesson/useLesson';
import { go, goHome } from '../lib/router';
import { MiboStage } from '../puppet/MiboStage';
import { listenCaptions, newPuppet } from '../puppet/mibo';
import { Arrow, Bubble, Card, Column, HomeButton, Pill, Spinner } from '../ui/kit';
import { C, SOUND } from '../ui/theme';
import { releaseMic } from '../voice/listen';

const STICKERS = ['🦄', '🐙', '🦕', '🐝', '🌈', '🚀', '🐸', '🦁'];
const WHERE = { device: '🔒 Reply written on this device', cloud: '☁️ Reply written in the cloud', bundled: '💬 Bundled reply', '': '' };

/**
 * The lesson: Mibo fills the stage for the child and a speech bubble shows
 * what he says. In a picture game two big pictures sit under him for the
 * child to tap. The grown-up's ◀ ▶ arrows stay on screen the whole time, as
 * the fallback for when Mibo's listening gets it wrong.
 */
export function Lesson({ params }: { params: Record<string, string> }) {
  const puppet = useMemo(newPuppet, []);
  const made = useMemo(() => (params.custom ? getCustomLesson(params.custom) : null), [params.custom]);
  const lessonId = made ? `custom-${made.id}` : (params.lesson ?? 's-th');
  const title = made ? made.plan.title : LESSONS.find(l => l.id === lessonId)?.title ?? 'Lesson';
  const steps = useMemo(() => (made ? buildSteps(made.plan) : planFor(lessonId)), [made, lessonId]);
  const dyn = useMemo(() => (made ? madeClips(made) : undefined), [made]);
  // each step's sound: the progress dots take that sound's colour
  const sounds = useMemo(() => stepSounds(steps).map(s => SOUND[s]), [steps]);
  const from = Math.max(0, Math.min(steps.length - 1, Number(params.from) || 0));
  // combined intro: the name greeting (when there is one) plays here, right before the lesson's own first line
  const introClip = useMemo(() => (made ? null : nameClip('hi')), [made]);
  const { ui, start, resume, stop, nav, choose, total } = useLesson(puppet, {
    steps, title, dynClips: dyn, introClip, listen: params.listen !== '0', from, stars: from ? loadProgress(lessonId)?.stars ?? 0 : 0,
    // remember the place on this device, so the home screen can offer "continue"
    onProgress: (step, stars) => saveProgress(lessonId, { step, stars }),
    onDone: () => clearProgress(lessonId),
  });
  const [caption, setCaption] = useState('');

  useEffect(() => {
    listenCaptions(puppet, text => setCaption(prev => (prev === text ? prev : text)));
    const t = setTimeout(resume, 600);
    return () => { clearTimeout(t); listenCaptions(puppet, null); };
  }, [puppet, resume]);
  useEffect(() => releaseMic, []);   // leaving the lesson lets go of the microphone

  const listening = ui.phase === 'listening';
  const sound = ui.ex ? SOUND[ui.ex.sound] : ui.pick ? SOUND[ui.pick.sound] : sounds[ui.step];
  const badge = ui.ex ? { emoji: ui.ex.emoji, word: ui.ex.target } : ui.pick?.word ?? null;
  const bubble = ui.phase === 'loading' ? 'Getting my voice ready…'
    : listening ? 'Your turn!' : ui.phase === 'thinking' ? caption || '…' : caption;

  return (
    <div className="screen">
      <Column max={680}>
        <div className="lesson-screen column">
          <div className="top">
            <HomeButton onPress={() => { stop(); goHome(); }} />
            <Pill className="dots">
              {Array.from({ length: total }, (_, i) => (
                <i key={i} className={`dot${i === ui.step ? ' now' : ''}`} style={{ backgroundColor: i <= ui.step ? sounds[i].deep : sounds[i].bg }} />
              ))}
            </Pill>
            <Pill bg={C.butter}><span className="stars">⭐ {ui.stars}</span></Pill>
          </div>

          <div className="lesson-stage">
            <MiboStage puppet={puppet} />
            {badge && (
              <div className="word-badge" style={{ backgroundColor: sound.bg, borderColor: sound.deep, color: sound.deep }}>
                <span>{badge.emoji}</span>{badge.word}
              </div>
            )}
          </div>

          {ui.pick && ui.phase !== 'done' && (
            <div className="choices">
              {ui.pick.choices.map((ch, i) => {
                const tapped = ui.picked?.i === i;
                const right = tapped && ui.picked!.ok, miss = tapped && !ui.picked!.ok, other = !tapped && !!ui.picked?.ok;
                return (
                  <button key={ch.word} type="button" className={`choice${miss ? ' miss' : ''}${other ? ' dim' : ''}`} onClick={() => choose(i)}
                    disabled={ui.phase !== 'picking'} aria-label={ch.word}
                    style={{ borderColor: sound.deep, color: sound.deep, ...(right ? { backgroundColor: sound.bg } : {}) }}>
                    <span>{ch.emoji}</span>{ch.word}
                  </button>
                );
              })}
            </div>
          )}

          {ui.phase === 'done' ? (
            <Card className="done">
              <div className="sticker">{STICKERS[ui.stars % STICKERS.length]}</div>
              <h2>You earned a sticker!</h2>
              <p>{ui.stars ? `${'⭐'.repeat(Math.min(ui.stars, 12))}  ${ui.stars} star${ui.stars === 1 ? '' : 's'} today` : 'Lovely practising today!'}</p>
              <div className="row">
                <Bubble label="Play again" bg={C.mint} deep={C.mintDeep} onPress={start} />
                <Bubble label="Finish" bg={C.lavender} deep={C.lavenderDeep} onPress={goHome} />
              </div>
              <button type="button" className="skip" onClick={() => go('report', {}, { replace: true })}>{"Grown-ups: read Mibo's notes"}</button>
            </Card>
          ) : (
            <>
              <div className="speech">
                <div className="tail" />
                <div className="bubble-box">
                  {ui.phase === 'loading' && <Spinner />}
                  <div className={`caption${bubble.length > 70 ? ' long' : ''}`}>{bubble}</div>
                </div>
              </div>

              <Card tint={listening ? C.lavender : C.card} className="parent">
                <div className="nav-row">
                  <Arrow dir="back" bg={C.peachDeep} deep="#c45f3c" onPress={() => nav('back')} />
                  <div className="status">
                    {listening && ui.mic ? (
                      <div className="meter">
                        {[0.15, 0.35, 0.55, 0.75, 0.9].map((th, i) => (
                          <i key={i} className={ui.level > th ? 'on' : ''} style={{ height: 12 + i * 7 }} />
                        ))}
                      </div>
                    ) : (
                      <div className="where">{WHERE[ui.live]}</div>
                    )}
                  </div>
                  <Arrow dir="fwd" bg={C.mintDeep} deep="#1f7d5a" onPress={() => nav('fwd')} />
                </div>
              </Card>
            </>
          )}
        </div>
      </Column>
    </div>
  );
}
