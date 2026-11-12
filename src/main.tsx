import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './ui/styles.css';

import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import { App } from './App';
import { unlockAudio } from './voice/player';

// browsers only allow sound after a tap: every tap or key press (re)opens the audio
for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(ev, unlockAudio, { passive: true });

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(<App />);
