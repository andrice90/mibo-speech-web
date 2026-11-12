import { useEffect, useMemo, useState } from 'react';

import { deviceAiStatus, type DeviceAi } from '../ai/device';
import { cloudError, firebaseReady } from '../ai/firebase';
import { writeNotes, type Notes } from '../ai/report';
import { allResults, clearResults, summarise, wordsToBringBack } from '../lesson/results';
import { go } from '../lib/router';
import { loadNotes, saveNotes } from '../lesson/notes';
import { Bubble, Card, Column, Dialog, ZoneBar } from '../ui/kit';
import { Working } from '../ui/Working';
import { C, SOUND } from '../ui/theme';

const DOWNLOADING = [
  "Downloading this browser's built-in AI…", 'This only happens the first time.', 'It is a big download, so it can take a few minutes.',
  'After this, Mibo writes his notes right here on this device.',
];
const NOTING = [
  'Mibo is reading the practice log…', 'Spotting what went well…', 'Looking for the tricky bits…',
  'Thinking about what to try next…', 'Dreaming up lesson ideas…',
];
const pct = (n: number, of: number) => `${of ? (100 * n) / of : 0}%`;

/**
 * Grown-up zone: how practice is going. The counts are worked out here from
 * the practice log with plain code. Mibo's notes (what the counts mean, where
 * the child struggled, what to focus on next) are written by the model
 * inside the device, so the log never leaves it; where there is no such
 * model, the grown-up can choose the cloud after seeing what would be sent.
 * The notes then feed the cloud lesson planner with a short topic and the
 * words worth bringing back.
 */
export function Report() {
  const [results, setResults] = useState(allResults);
  const sum = useMemo(() => summarise(results), [results]);
  const [device, setDevice] = useState<DeviceAi | null>(null);
  const [notes, setNotes] = useState<Notes | null>(loadNotes);
  const [busy, setBusy] = useState<'device' | 'cloud' | null>(null);
  const bringBack = useMemo(() => wordsToBringBack(sum), [sum]);
  const goHome = () => go('parent', {}, { replace: true });   // one step up: the dashboard
  const plan = (topic: string) => go('create', { topic, ...(bringBack.length ? { bringBack: bringBack.join(',') } : {}) });
  const [download, setDownload] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [askCloud, setAskCloud] = useState(false);
  const [askClear, setAskClear] = useState(false);

  useEffect(() => { void deviceAiStatus().then(setDevice); }, []);

  const write = async (where: 'device' | 'cloud') => {
    setAskCloud(false); setBusy(where); setError(''); setDownload(null);
    try {
      const n = await writeNotes(sum, where === 'cloud', f => setDownload(f));
      setNotes(n); saveNotes(n);
    } catch (e) {
      console.warn('[notes]', e);
      setError(where === 'device' && !/^Mibo/.test((e as Error).message)
        ? 'The on-device model could not write the notes just now. Try again in a moment.'
        : cloudError(e, 'Mibo could not reach the cloud just now. Check the connection and try again.'));
    } finally {
      setBusy(null); setDownload(null);
      void deviceAiStatus().then(setDevice);
    }
  };

  const downloading = busy === 'device' && download !== null && download < 1;
  const onDevice = device === 'available' || device === 'downloadable' || device === 'downloading';
  const tricky = sum.words.filter(w => w.notYet > 0 || w.firstTry < w.times).slice(0, 8);

  return (
    <div className="screen">
      <Column>
        <ZoneBar title="Mibo's notes" onBack={goHome} />
        <div className="scroll"><div className="body">
          <p className="center soft" style={{ fontSize: 15, lineHeight: '21px' }}>
            A look at how practice is going. Mibo's notes are a guide for you at home, and they are saved on this device.
          </p>

          {sum.total === 0 ? (
            <Card className="stack center">
              <div style={{ fontSize: 44 }}>🌱</div>
              <h2>Nothing to read yet</h2>
              <p className="soft">Play a lesson with your child and come back. Mibo keeps track as you go.</p>
              <div className="row"><Bubble label="Back" bg={C.mint} deep={C.mintDeep} onPress={goHome} /></div>
            </Card>
          ) : (
            <>
              <Card className="stack">
                <h2>So far</h2>
                <p className="soft" style={{ fontSize: 14 }}>
                  {`${sum.total} word${sum.total === 1 ? '' : 's'} and games over ${sum.days} day${sum.days === 1 ? '' : 's'} · ${sum.lessons.join(', ')}`}
                </p>
                {sum.sounds.map(s => (
                  <div key={s.sound} className="stat">
                    <div className="head"><span>{SOUND[s.sound].name}</span><span>{`${s.firstTry} of ${s.words} first try`}</span></div>
                    <div className="bar" role="img" aria-label={`${s.firstTry} first try, ${s.neededHelp} with another go, ${s.notYet} not yet`}>
                      <i style={{ width: pct(s.firstTry, s.words), backgroundColor: C.mintDeep }} />
                      <i style={{ width: pct(s.neededHelp, s.words), backgroundColor: C.butterDeep }} />
                      <i style={{ width: pct(s.notYet, s.words), backgroundColor: '#d8cfc0' }} />
                    </div>
                  </div>
                ))}
                {sum.games.played > 0 && (
                  <div className="stat">
                    <div className="head"><span>Listening games</span><span>{`${sum.games.firstTry} of ${sum.games.played} first try`}</span></div>
                    <div className="bar"><i style={{ width: pct(sum.games.firstTry, sum.games.played), backgroundColor: C.mintDeep }} /></div>
                  </div>
                )}
                <div className="legend">
                  <span><i style={{ backgroundColor: C.mintDeep }} />First try</span>
                  <span><i style={{ backgroundColor: C.butterDeep }} />After another go</span>
                  <span><i style={{ backgroundColor: '#d8cfc0' }} />Not yet</span>
                </div>
                {tricky.length > 0 && (
                  <p className="soft" style={{ fontSize: 14 }}>{`Worth another play: ${tricky.map(w => w.target).join(', ')}`}</p>
                )}
              </Card>

              <Card className="stack notes">
                <h2>What Mibo noticed</h2>
                {notes && !busy && (
                  <>
                    <span className={`tag ${notes.where}`}>
                      {notes.where === 'device' ? '🔒 Written on this device' : '☁️ Written in the cloud'}
                    </span>
                    <p className="headline">{notes.headline}</p>
                    {notes.goingWell.length > 0 && <><h3>Going well</h3><ul>{notes.goingWell.map(x => <li key={x}>{x}</li>)}</ul></>}
                    {notes.trickySpots.length > 0 && <><h3>Where it was tricky</h3><ul>{notes.trickySpots.map(x => <li key={x}>{x}</li>)}</ul></>}
                    {notes.focusNext.length > 0 && <><h3>What to focus on next</h3><ul>{notes.focusNext.map(x => <li key={x}>{x}</li>)}</ul></>}
                    {notes.tip && <p className="tip">💡 {notes.tip}</p>}
                    {notes.lessonIdeas.length > 0 && (
                      <>
                        <h3>Make the next lesson from these notes</h3>
                        <div className="chips">
                          {notes.lessonIdeas.map(x => <button key={x} type="button" className="idea" onClick={() => plan(x)}>✨ {x}</button>)}
                        </div>
                        <p className="note">
                          {bringBack.length
                            ? `Tap an idea to start a new lesson. It will include another go at ${bringBack.join(', ')}.`
                            : 'Tap an idea to start a new lesson.'}
                        </p>
                      </>
                    )}
                    <p className="note">{`Written ${new Date(notes.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} by AI. You know your child best, so take it as a starting point.`}</p>
                  </>
                )}
                {busy && (
                  <Working title={busy === 'cloud' ? 'Writing the notes in the cloud' : downloading ? 'Getting ready to write the notes' : 'Reading the practice log on this device'}
                    messages={downloading ? DOWNLOADING : NOTING}
                    progress={downloading ? download! : undefined} detail={downloading ? `${Math.round(download! * 100)}%` : undefined}
                    estimate={busy === 'device' ? 25 : 15} />
                )}
                {!!error && <p className="err">{error}</p>}
                {!busy && !firebaseReady && <p className="err">This build has no Firebase setup yet, so Mibo cannot write notes (see the README).</p>}
                {!busy && firebaseReady && device !== null && (onDevice ? (
                  <>
                    <div className="row">
                      <Bubble small={!!notes} label={notes ? 'Write fresh notes' : 'Write the notes on this device'} bg={C.mint} deep={C.mintDeep}
                        onPress={() => void write('device')} />
                    </div>
                    <p className="note">
                      🔒 Mibo writes these notes with the AI built into your browser, so they stay on this device.
                      {device !== 'available' && ' The first time takes a while because the AI has to download.'}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="note">
                      This browser has no built-in AI, so Mibo can write the notes in the cloud if you'd like.
                    </p>
                    <div className="row">
                      <Bubble small label={notes ? 'Write fresh notes in the cloud…' : 'Write the notes in the cloud…'} bg={C.sky} deep="#2f7fb8"
                        onPress={() => setAskCloud(true)} />
                    </div>
                  </>
                ))}
              </Card>

              <button type="button" className="skip" onClick={() => setAskClear(true)}>Clear the practice log</button>
            </>
          )}
        </div></div>

        {askCloud && (
          <Dialog onClose={() => setAskCloud(false)}>
            <div className="big">☁️</div>
            <h2>Write the notes in the cloud?</h2>
            <p>
              Mibo will send the numbers on this page to Gemini to write the notes. That includes the lesson names, the
              words practised and how many goes each one took.
            </p>
            <div className="row"><Bubble label="Yes, write the notes" bg={C.sky} deep="#2f7fb8" onPress={() => void write('cloud')} /></div>
            <div className="row"><Bubble small label="No thanks" bg={C.mint} deep={C.mintDeep} onPress={() => setAskCloud(false)} /></div>
          </Dialog>
        )}
        {askClear && (
          <Dialog onClose={() => setAskClear(false)}>
            <div className="big">🧹</div>
            <h2>Clear the practice log?</h2>
            <p>{"This removes the practice history and Mibo's notes from this device. Your lessons stay."}</p>
            <div className="row">
              <Bubble label="Clear it" bg={C.rose} deep={C.roseDeep}
                onPress={() => { clearResults(); saveNotes(null); setNotes(null); setResults([]); setAskClear(false); }} />
            </div>
            <div className="row"><Bubble small label="Keep it" bg={C.mint} deep={C.mintDeep} onPress={() => setAskClear(false)} /></div>
          </Dialog>
        )}
      </Column>
    </div>
  );
}
