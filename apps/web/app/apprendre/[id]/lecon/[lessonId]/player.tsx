'use client';
import { useRef } from 'react';

const offset = (seconds: number) => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
  .map(value => String(value).padStart(2, '0')).join(':');

// Native player: captions as WebVTT track, chapter jumps and playback speed.
export function Player({ kind, src, captions, captionsLanguage, chapters, title }: {
  kind: string; src: string; captions: string | null; captionsLanguage: string; chapters: { at: number; title: string }[]; title: string;
}) {
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const seek = (at: number) => { if (media.current) { media.current.currentTime = at; void media.current.play().catch(() => undefined); } };
  const track = captions ? <track kind="captions" src={captions} srcLang={captionsLanguage} label="Sous-titres" default /> : null;
  return (
    <div className="player">
      {kind === 'video'
        ? <video ref={media} controls preload="metadata" playsInline src={src} aria-label={title} crossOrigin="anonymous">{track}</video>
        : <audio ref={media} controls preload="metadata" src={src} aria-label={title} crossOrigin="anonymous">{track}</audio>}
      <label className="speed">Vitesse
        <select defaultValue="1" onChange={event => { if (media.current) media.current.playbackRate = Number(event.target.value); }}>
          {['0.75', '1', '1.25', '1.5', '2'].map(value => <option key={value} value={value}>{value}×</option>)}
        </select>
      </label>
      {chapters.length > 0 && (
        <nav aria-label="Chapitres"><ol className="chapters">
          {chapters.map(item => <li key={item.at}><button type="button" className="secondary" onClick={() => seek(item.at)}>{offset(item.at)} · {item.title}</button></li>)}
        </ol></nav>
      )}
    </div>
  );
}
