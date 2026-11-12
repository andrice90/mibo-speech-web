import { useEffect, useMemo, useState } from 'react';

import { deviceAiStatus, type DeviceAi } from '../ai/device';
import { firebaseReady } from '../ai/firebase';
import { loadConsent, saveConsent } from '../lesson/consent';
import { deleteCustomLesson, listCustomLessons, type CustomLesson } from '../lesson/custom';
import { loadNotes, practiceSinceNotes } from '../lesson/notes';
import { allResults, summarise, wordsToBringBack } from '../lesson/results';
import { go, goHome } from '../lib/router';
import { lock, setPin, validPin } from '../lib/zone';
import { Bubble, Card, Column, Dialog, ZoneBar } from '../ui/kit';
import { MicSwitch } from '../ui/MicSwitch';
import { PinPad } from '../ui/PinPad';
import { C } from '../ui/theme';

const ago = (at: number) => {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

/**
 * The grown-up zone, as a dashboard: practice at a glance, whether there is
 * new practice Mibo has not written notes on yet, the lesson his notes
 * suggest next, and the lessons already made. Settings sit behind the gear.
 * "Back to Mibo" locks the zone and hands the device back.
 */
export function Parent() {
  const [made, setMade] = useState<CustomLesson[]>(listCustomLessons);
  const [del, setDel] = useState<CustomLesson | null>(null);
  const [settings, setSettings] = useState(false);
  const [hear, setHear] = useState(() => loadConsent()?.hear ?? true);
  const [device, setDevice] = useState<DeviceAi | null>(null);
  const [newPin, setNewPin] = useState<null | { first: string }>(null);
  const [pinSaved, setPinSaved] = useState(false);

  const sum = useMemo(() => summarise(allResults()), []);
  const notes = useMemo(loadNotes, []);
  const pending = useMemo(() => practiceSinceNotes(notes), [notes]);
  const bringBack = useMemo(() => wordsToBringBack(sum), [sum]);
  const said = sum.sounds.reduce((n, s) => n + s.words, 0), first = sum.sounds.reduce((n, s) => n + s.firstTry, 0);

  useEffect(() => { void deviceAiStatus().then(setDevice); }, []);

  const plan = (topic?: string) => go('create', { ...(topic ? { topic } : {}), ...(topic && bringBack.length ? { bringBack: bringBack.join(',') } : {}) });
  const idea = notes?.lessonIdeas[0];

  return (
    <div className="screen">
      <Column>
        <ZoneBar title="Grown-up zone" onBack={() => { lock(); goHome(); }}>
          <button type="button" className="nav-pill icon" onClick={() => { setPinSaved(false); setSettings(true); }} aria-label="Settings">⚙️</button>
        </ZoneBar>
        <div className="scroll"><div className="list">
          <div className="tiles">
            <div className="tile"><b>{sum.total}</b><span>words and games practised</span></div>
            <div className="tile"><b>{said ? `${Math.round((100 * first) / said)}%` : '–'}</b><span>said right first try</span></div>
            <div className="tile"><b>{sum.days}</b><span>{sum.days === 1 ? 'day of practice' : 'days of practice'}</span></div>
          </div>

          <Card className="stack dash">
            <div className="dash-head">
              <h2>📒 {"Mibo's notes"}</h2>
              {sum.total > 0 && pending > 0 && <span className="badge-new">{notes ? `${pending} new since last notes` : 'New practice to read'}</span>}
              {notes && pending === 0 && <span className="badge-ok">Up to date</span>}
            </div>
            {sum.total === 0 ? (
              <p className="soft">No practice yet. Play a lesson and Mibo will have something to write about.</p>
            ) : notes ? (
              <>
                <p className="dash-quote">{notes.headline}</p>
                <p className="note">{`Written ${ago(notes.at)}, ${notes.where === 'device' ? 'on this device' : 'in the cloud'}.`}</p>
              </>
            ) : (
              <p className="soft">Mibo hasn't written any notes yet. He'll look at how practice went and suggest what to try next.</p>
            )}
            {sum.total > 0 && (
              <div className="row">
                <Bubble small label={!notes ? "Write Mibo's notes" : pending > 0 ? 'Read and update the notes' : 'Read the notes'}
                  bg={C.lavender} deep={C.lavenderDeep} onPress={() => go('report')} />
              </div>
            )}
          </Card>

          <Card className="stack dash">
            <div className="dash-head"><h2>✨ Next lesson</h2></div>
            {idea ? (
              <>
                <p className="soft">From his notes, Mibo suggests:</p>
                <p className="dash-quote">{idea}</p>
                {bringBack.length > 0 && <p className="note">{`With another go at ${bringBack.join(', ')}.`}</p>}
                <div className="row"><Bubble small label="Make this lesson" bg={C.mint} deep={C.mintDeep} onPress={() => plan(idea)} /></div>
                {notes!.lessonIdeas.length > 1 && (
                  <div className="chips">
                    {notes!.lessonIdeas.slice(1).map(x => <button key={x} type="button" className="idea" onClick={() => plan(x)}>✨ {x}</button>)}
                  </div>
                )}
                <button type="button" className="skip" onClick={() => plan()}>Choose my own words</button>
              </>
            ) : (
              <>
                <p className="soft">
                  {sum.total > 0 ? "Mibo will suggest a lesson once he's written his notes. You can also pick the words yourself." : 'Pick some words and Mibo will turn them into a lesson.'}
                </p>
                <div className="row"><Bubble small label="Make a new lesson" bg={C.mint} deep={C.mintDeep} onPress={() => plan()} /></div>
              </>
            )}
          </Card>

          {made.length > 0 && (
            <Card className="stack dash">
              <div className="dash-head"><h2>Lessons you made</h2></div>
              {made.map(l => (
                <div key={l.id} className="made-row">
                  <span style={{ fontSize: 28 }}>{l.plan.emoji}</span>
                  <span className="t"><b>{l.plan.title}</b><span>{l.plan.words.map(w => w.word).join(' · ')}</span></span>
                  <button type="button" style={{ color: C.roseDeep, fontWeight: 700, fontSize: 24, padding: '0 6px' }} onClick={() => setDel(l)} aria-label={`Delete ${l.plan.title}`}>×</button>
                </div>
              ))}
            </Card>
          )}
        </div></div>
        <div className="zone-foot row"><Bubble label="Back to Mibo" bg={C.mint} deep={C.mintDeep} onPress={() => { lock(); goHome(); }} /></div>

        {settings && !newPin && (
          <Dialog onClose={() => setSettings(false)}>
            <h2>Settings</h2>
            <div style={{ alignSelf: 'stretch', textAlign: 'left' }}><MicSwitch on={hear} onChange={v => { saveConsent(v); setHear(v); }} /></div>
            <div className="setting" style={{ alignSelf: 'stretch' }}>
              <span>{pinSaved ? 'PIN changed ✓' : 'Grown-up PIN'}</span>
              <button type="button" className="link" onClick={() => { setPinSaved(false); setNewPin({ first: '' }); }}>Change</button>
            </div>
            <p className="note" style={{ textAlign: 'left', marginBottom: 0 }}>
              {!firebaseReady
                ? 'Firebase is not set up in this build, so notes and new lessons are switched off.'
                : device === null ? ''
                : device === 'unavailable'
                  ? '☁️ This browser has no built-in AI, so Mibo will ask before writing his notes in the cloud.'
                  : '🔒 Mibo writes his notes on this device.'}
              {' '}New lessons are made in the cloud.
            </p>
            <div className="row"><Bubble small label="Done" bg={C.mint} deep={C.mintDeep} onPress={() => setSettings(false)} /></div>
          </Dialog>
        )}
        {newPin && (
          <Dialog onClose={() => setNewPin(null)}>
            <PinPad key={newPin.first ? 'again' : 'first'} title={newPin.first ? 'Confirm PIN' : 'Choose a new PIN'}
              hint={newPin.first ? 'Enter the same four digits again.' : 'Four digits.'}
              onEntered={async pin => {
                if (!newPin.first) { if (!validPin(pin)) return false; setNewPin({ first: pin }); return true; }
                if (pin !== newPin.first) { setNewPin({ first: '' }); return false; }
                await setPin(pin); setNewPin(null); setPinSaved(true); return true;
              }} />
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
