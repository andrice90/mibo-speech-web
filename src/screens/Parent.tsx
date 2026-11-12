import { useEffect, useState } from 'react';

import { DEVICE_LABEL, deviceAiStatus, type DeviceAi } from '../ai/device';
import { firebaseReady } from '../ai/firebase';
import { loadConsent, saveConsent } from '../lesson/consent';
import { deleteCustomLesson, listCustomLessons, type CustomLesson } from '../lesson/custom';
import { allResults } from '../lesson/results';
import { go, goHome } from '../lib/router';
import { lock, setPin, validPin } from '../lib/zone';
import { Bubble, Card, Column, Dialog } from '../ui/kit';
import { PinPad } from '../ui/PinPad';
import { C } from '../ui/theme';

/**
 * The grown-up zone: Mibo's notes (written on this device), new lessons
 * (planned and voiced in the cloud), and the settings. "My child is ready"
 * locks the zone and hands the device back to the child.
 */
export function Parent() {
  const [made, setMade] = useState<CustomLesson[]>(listCustomLessons);
  const [del, setDel] = useState<CustomLesson | null>(null);
  const [hear, setHear] = useState(() => loadConsent()?.hear ?? true);
  const [device, setDevice] = useState<DeviceAi | null>(null);
  const [newPin, setNewPin] = useState<null | { first: string }>(null);
  const [pinSaved, setPinSaved] = useState(false);
  const practised = allResults().length;

  useEffect(() => { void deviceAiStatus().then(setDevice); }, []);

  return (
    <div className="screen">
      <Column>
        <div className="zone-bar">
          <h1>Grown-up zone</h1>
        </div>
        <div className="scroll"><div className="list">
          <div className="row"><Bubble label="My child is ready ▶" bg={C.mint} deep={C.mintDeep} onPress={() => { lock(); goHome(); }} /></div>

          <button type="button" className="lesson" style={{ backgroundColor: '#f1ecff', borderColor: C.lavenderDeep }} onClick={() => go('report')}>
            <span className="badge">📒</span>
            <span className="text">
              <span className="title" style={{ color: C.lavenderDeep }}>{"Mibo's notes"}</span>
              <span className="subtitle">How practice is going and what to focus on next</span>
              <span className="meta">{practised ? `${practised} word${practised === 1 ? '' : 's'} and games in the practice log` : 'Nothing practised yet'}</span>
            </span>
            <span className="go" style={{ color: C.lavenderDeep }}>Read</span>
          </button>
          <button type="button" className="lesson" style={{ backgroundColor: '#ffeef4', borderColor: C.roseDeep }} onClick={() => go('create')}>
            <span className="badge">✨</span>
            <span className="text">
              <span className="title" style={{ color: C.roseDeep }}>Make a new lesson</span>
              <span className="subtitle">Choose the words; Mibo plans and voices it</span>
            </span>
            <span className="go" style={{ color: C.roseDeep }}>Make</span>
          </button>

          {made.length > 0 && (
            <Card className="stack">
              <h2>Lessons you made</h2>
              {made.map(l => (
                <div key={l.id} className="made-row">
                  <span style={{ fontSize: 28 }}>{l.plan.emoji}</span>
                  <span className="t"><b>{l.plan.title}</b><span>{l.plan.words.map(w => w.word).join(' · ')}</span></span>
                  <button type="button" className="del" style={{ color: C.roseDeep, fontWeight: 700, fontSize: 24 }} onClick={() => setDel(l)} aria-label={`Delete ${l.plan.title}`}>×</button>
                </div>
              ))}
            </Card>
          )}

          <Card className="stack">
            <h2>Settings</h2>
            <button type="button" className="check mic" role="switch" aria-checked={hear} onClick={() => { saveConsent(!hear); setHear(!hear); }}>
              <span className={`box${hear ? ' on' : ''}`}>{hear && '✓'}</span>
              <span>🎤 Let Mibo listen (on this device only)</span>
            </button>
            <div className="setting">
              <span>{pinSaved ? 'PIN changed ✓' : 'Grown-up PIN'}</span>
              <button type="button" className="link" onClick={() => { setPinSaved(false); setNewPin({ first: '' }); }}>Change</button>
            </div>
          </Card>

          <p className="ai-status">
            {!firebaseReady
              ? <><b>Firebase is not set up in this build.</b> Lessons still play; notes and new lessons need it.</>
              : device === null ? ' '
              : device === 'unavailable'
                ? <><b>☁️ {DEVICE_LABEL[device]}.</b> The practice log stays on this device unless you choose, each time, to let the cloud write the notes. New lessons are planned and voiced in the cloud.</>
                : <><b>🔒 {DEVICE_LABEL[device]}.</b> Mibo reads the practice log and writes his notes on this device. New lessons are planned and voiced in the cloud.</>}
            {' '}Lessons themselves use no AI.
          </p>
        </div></div>

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
        {newPin && (
          <Dialog onClose={() => setNewPin(null)}>
            <PinPad key={newPin.first ? 'again' : 'first'} title={newPin.first ? 'Type it once more' : 'Choose a new PIN'}
              onEntered={async pin => {
                if (!newPin.first) { if (!validPin(pin)) return false; setNewPin({ first: pin }); return true; }
                if (pin !== newPin.first) { setNewPin({ first: '' }); return false; }
                await setPin(pin); setNewPin(null); setPinSaved(true); return true;
              }} />
          </Dialog>
        )}
      </Column>
    </div>
  );
}
