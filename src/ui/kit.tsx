import type { CSSProperties, ReactNode } from 'react';

import { goHome } from '../lib/router';
import { lock } from '../lib/zone';
import { C } from './theme';

/**
 * Keeps a screen's content to a readable, thumb-friendly width on tablets and
 * desktops: centred, full width on phones. The column itself spans the whole
 * window and its parts are what get the width, so a scrolling area scrolls
 * from anywhere on the page, not only when the pointer is over the content.
 */
export function Column({ children, max = 640 }: { children: ReactNode; max?: number }) {
  return <div className="column" style={{ '--max': `${max}px` } as CSSProperties}>{children}</div>;
}

export function Card({ children, className = '', tint = C.card, style }: { children: ReactNode; className?: string; tint?: string; style?: CSSProperties }) {
  return <div className={`card ${className}`} style={{ backgroundColor: tint, ...style }}>{children}</div>;
}

/** A chunky candy button: pastel face, deeper edge underneath that sinks when pressed. */
export function Bubble({ label, onPress, bg, deep, disabled, small }: {
  label: string; onPress: () => void; bg: string; deep: string; disabled?: boolean; small?: boolean;
}) {
  return (
    <button type="button" className={`bubble${small ? ' small' : ''}`} onClick={onPress} disabled={disabled}
      style={{ '--edge': deep, '--face': bg } as CSSProperties}>
      <span>{label}</span>
    </button>
  );
}

/** A white chalk arrow: a few rough passes, like chalk dragged over a board. */
function ChalkArrow({ dir }: { dir: 'back' | 'fwd' }) {
  const d = 'M7 22 L36 21.5 M25 10 L37 21.5 L24.5 33';
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden style={dir === 'back' ? { transform: 'scaleX(-1)' } : undefined}>
      <defs>
        <filter id="chalk" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" />
        </filter>
      </defs>
      <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" filter="url(#chalk)">
        <path d={d} strokeWidth="7" opacity="0.35" />
        <path d={d} strokeWidth="5" opacity="0.75" strokeDasharray="9 2.2 5 1.6" />
        <path d={d} strokeWidth="2.6" opacity="0.9" />
      </g>
    </svg>
  );
}

/** Squircle candy button with a chalk arrow, for the grown-up's ◀ ▶. */
export function Arrow({ dir, onPress, bg, deep }: { dir: 'back' | 'fwd'; onPress: () => void; bg: string; deep: string }) {
  return (
    <button type="button" className="arrow" onClick={onPress} aria-label={dir === 'fwd' ? 'Next' : 'Back'}
      style={{ '--edge': deep, '--face': bg } as CSSProperties}>
      <span><ChalkArrow dir={dir} /></span>
    </button>
  );
}

/** Round "home" button, top-left on every screen past home. */
export function HomeButton({ onPress, floating }: { onPress: () => void; floating?: boolean }) {
  return <button type="button" className={`home-btn${floating ? ' floating' : ''}`} onClick={onPress} aria-label="Home">🏠</button>;
}

export function Pill({ children, bg = C.white, className = '' }: { children: ReactNode; bg?: string; className?: string }) {
  return <div className={`pill ${className}`} style={{ backgroundColor: bg }}>{children}</div>;
}

export function Spinner() {
  return <div className="spinner" role="progressbar" aria-label="Loading" />;
}

/** A centred dialog over a soft scrim; tapping the scrim closes it. */
export function Dialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="card dialog" style={{ backgroundColor: C.card }} onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}

/**
 * The bar across the top of every grown-up page: Back on the left (one step
 * up), the page's name, and Home on the right, which always locks the zone
 * and returns to Mibo's lessons. `children` sit just left of Home.
 */
export function ZoneBar({ title, onBack, children }: { title: string; onBack: () => void; children?: ReactNode }) {
  return (
    <div className="zone-bar">
      <button type="button" className="nav-pill" onClick={onBack}>‹ Back</button>
      <h1>{title}</h1>
      <div className="zone-right">
        {children}
        <button type="button" className="nav-pill icon" onClick={() => { lock(); goHome(); }} aria-label="Home: back to Mibo">🏠</button>
      </div>
    </div>
  );
}
