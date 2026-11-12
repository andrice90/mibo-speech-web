/**
 * Turns a grown-up's words ("s words about farm animals") into a lesson plan
 * with Gemini in the cloud, through Firebase AI Logic. Planning a whole
 * lesson is the heavy job in this app, so it gets the big model; what goes
 * up is only the short topic the grown-up typed or accepted.
 *
 * The plan comes back for the grown-up to check before any voice is made.
 * Guardrails: teaching lines only, no diagnosis or therapy language, simple
 * words for ages 4-7, and validatePlan() has the final say.
 */
import { getGenerativeModel, Schema, type GenerativeModel } from 'firebase/ai';

import { validatePlan, type LessonPlan } from '../lesson/plan';
import { firebaseReady, miboAI, MODELS, withTimeout } from './firebase';

const SYSTEM = `You design ONE short speech-practice lesson for Mibo, a friendly cartoon practice buddy for children aged 4-7, supervised by a grown-up. The grown-up describes the kind of words to work on. This is playful educational practice: never mention diagnosis, therapy, treatment, disorders, or that any word is hard for a particular child.

Return a lesson plan:
- title: short and fun (max 6 words). subtitle: one short line saying what the lesson practises.
- emoji: one emoji for the lesson.
- introLine: Mibo's hello for this lesson (max 22 words, warm, names the theme).
- warmupLine: a silly mouth warm-up line (max 22 words).
- byeLine: a celebration line for the end (max 22 words). Do not promise a sticker or reward beyond praise.
- words: 5 single words the child will practise, fitting the grown-up's request, common and pictureable for a 4-7 year old, each with one emoji. Follow the grown-up's request faithfully: if they ask for multi-syllable words, give multi-syllable words (strawberry, sunflower, banana, elephant).
- modelText for each word: how Mibo models it. For s/th/sh/z words stretch the first sound then say the word, e.g. "Sssss... sun!" or "Shhhhh... shoe!". For multi-syllable words say it chunk by chunk, then whole, e.g. "Straw... ber... ry! Strawberry!". For other words say it slowly then whole, e.g. "Buh... ball! Ball!". The word itself must appear in modelText.
Simple words a 4 year old knows. No scary, rude or medical words.`;

const SCHEMA = Schema.object({
  properties: {
    title: Schema.string(), subtitle: Schema.string(), emoji: Schema.string(),
    introLine: Schema.string(), warmupLine: Schema.string(), byeLine: Schema.string(),
    words: Schema.array({
      items: Schema.object({ properties: { word: Schema.string(), emoji: Schema.string(), modelText: Schema.string() } }),
    }),
  },
});

let model: GenerativeModel | null = null;
function planModel(): GenerativeModel {
  model ??= getGenerativeModel(miboAI(), {
    model: MODELS.plan,
    systemInstruction: SYSTEM,
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA },
  });
  return model;
}

export async function generatePlan(topic: string): Promise<LessonPlan> {
  if (!firebaseReady) throw new Error('Making lessons needs the Firebase setup (see the README).');
  const result = await withTimeout(planModel().generateContent(JSON.stringify({ wordsToWorkOn: topic })), 30000, 'plan');
  const plan = validatePlan(JSON.parse(result.response.text() || '{}'), topic);
  if (!plan) throw new Error('Mibo could not dream up that lesson. Try different words.');
  return plan;
}
