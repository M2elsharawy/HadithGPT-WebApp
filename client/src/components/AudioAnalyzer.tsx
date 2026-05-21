import { createContext, useContext, useRef, useEffect, ReactNode, useState } from "react";

interface AudioAnalyzerContextType {
  analyser: AnalyserNode | null;
  waveformData: Uint8Array;
  frequencyData: Uint8Array;
  isReady: boolean;
  error?: string; // Phase F-3f: Add error tracking
}

const AudioAnalyzerContext = createContext<AudioAnalyzerContextType | null>(null);

let globalAudioContext: AudioContext | null = null;
let globalAnalyser: AnalyserNode | null = null;
let globalSource: MediaElementAudioSourceNode | null = null;

export function AudioAnalyzerProvider({
  children,
  audioRef,
}: {
  children: ReactNode;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string>(); // Phase F-3f: Track errors
  const waveformDataRef = useRef<Uint8Array>(new Uint8Array(2048) as any);
  const frequencyDataRef = useRef<Uint8Array>(new Uint8Array(256) as any);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!audioRef?.current || initializedRef.current) return;

    try {
      // Phase F-3f: Add diagnostic logging
      console.log('[AudioAnalyzer] Initializing with audioRef:', {
        hasAudioRef: !!audioRef.current,
        audioSrc: audioRef.current?.src,
      });

      // Create AudioContext only once globally
      if (!globalAudioContext) {
        try {
          globalAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          console.log('[AudioAnalyzer] AudioContext created:', {
            state: globalAudioContext.state,
            sampleRate: globalAudioContext.sampleRate,
          });
        } catch (err) {
          console.error('[AudioAnalyzer] Failed to create AudioContext:', err);
          setError('فشل إنشاء AudioContext');
          return;
        }
      }

      const audioContext = globalAudioContext;

      // Create analyser only once globally
      if (!globalAnalyser) {
        try {
          globalAnalyser = audioContext.createAnalyser();
          globalAnalyser.fftSize = 2048;
          console.log('[AudioAnalyzer] Analyser created');
        } catch (err) {
          console.error('[AudioAnalyzer] Failed to create Analyser:', err);
          setError('فشل إنشاء محلل الموجة');
          return;
        }
      }

      // Create source only once globally and only if not already created
      if (!globalSource) {
        try {
          globalSource = audioContext.createMediaElementSource(audioRef.current);
          globalSource.connect(globalAnalyser);
          globalAnalyser.connect(audioContext.destination);
          console.log('[AudioAnalyzer] MediaElementSource connected successfully');
        } catch (err) {
          // Phase F-3f: Graceful handling of CORS errors
          console.warn('[AudioAnalyzer] Failed to connect MediaElementSource (likely CORS):', err);
          // Still mark as ready because native audio can play even if analyser fails
          setError(undefined);
          initializedRef.current = true;
          setIsReady(true);
          return;
        }
      }

      initializedRef.current = true;
      setError(undefined);
      setIsReady(true);
    } catch (error) {
      console.error("[AudioAnalyzer] Error initializing audio analyzer:", error);
      setError('خطأ في تهيئة محلل الصوت');
    }
  }, [audioRef]);

  return (
    <AudioAnalyzerContext.Provider
      value={{
        analyser: globalAnalyser,
        waveformData: waveformDataRef.current as any,
        frequencyData: frequencyDataRef.current as any,
        isReady,
        error, // Phase F-3f: Include error in context
      }}
    >
      {children}
    </AudioAnalyzerContext.Provider>
  );
}

export function useAudioAnalyzer() {
  const context = useContext(AudioAnalyzerContext);
  if (!context) {
    throw new Error("useAudioAnalyzer must be used within AudioAnalyzerProvider");
  }
  return context;
}
