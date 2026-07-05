import { AnimatePresence, motion } from 'motion/react';
import { playbackNext, playbackPlayPause, playbackPrevious } from '@/utils/tauri-commands';
import { noop } from '../utils';

export function TransportControls({
  isPlaying,
  setIsPlaying,
}: Readonly<{
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
}>) {
  return (
    <div className="transport-controls">
      <button
        className="btn-icon skip"
        aria-label="Previous"
        onClick={() => playbackPrevious().catch(noop)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
      </button>
      <button
        className="btn-icon play-pause relative inline-flex items-center justify-center overflow-hidden"
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={() => {
          setIsPlaying((p) => !p);
          playbackPlayPause().catch(noop);
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={isPlaying ? 'pause' : 'play'}
            initial={{ opacity: 0, scale: 0.7, rotate: isPlaying ? -90 : 90 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.7, rotate: isPlaying ? 90 : -90 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="flex items-center justify-center"
          >
            {isPlaying ? (
              <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            ) : (
              <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            )}
          </motion.div>
        </AnimatePresence>
      </button>
      <button
        className="btn-icon skip"
        aria-label="Next"
        onClick={() => playbackNext().catch(noop)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
      </button>
    </div>
  );
}
