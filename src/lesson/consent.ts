/**
 * The grown-up's consent, given once on this device (first app start): the
 * supervision checklist, the "I'm a grown-up" tick, and whether Mibo may
 * listen. Kept on this device only. After this, lessons start without asking.
 */
import { readJson, writeJson } from '../lib/store';

export type Consent = { at: number; hear: boolean };
const KEY = 'mibo-consent-v1';

export const loadConsent = () => readJson<Consent | null>(KEY, null);
export const hasConsent = () => loadConsent() !== null;
export const saveConsent = (hear: boolean) => { writeJson(KEY, { at: Date.now(), hear }); };
