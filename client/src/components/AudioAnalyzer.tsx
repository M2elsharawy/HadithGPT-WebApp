import { createContext, useContext, useRef, useEffect, ReactNode, useState } from "react";

interface AudioAnalyzerContextType {
  analyser: AnalyserNode | null;
  waveformData: Uint8Array;
  frequencyData: Uint8Array;
  isReady: boolean;
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
  const waveformDataRef = useRef<Uint8Array>(new Uint8Array(2048) as any);
  const frequencyDataRef = useRef<Uint8Array>(new Uint8Array(256) as any);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!audioRef?.current || initializedRef.current) return;

    try {
      // Create AudioContext only once globally
      if (!globalAudioContext) {
        globalAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const audioContext = globalAudioContext;

      // Create analyser only once globally
      if (!globalAnalyser) {
        globalAnalyser = audioContext.createAnalyser();
        globalAnalyser.fftSize = 2048;
      }

      // Create source only once globally and only if not already created
      if (!globalSource) {
        globalSource = audioContext.createMediaElementSource(audioRef.current);
        globalSource.connect(globalAnalyser);
        globalAnalyser.connect(audioContext.destination);
      }

      initializedRef.current = true;
      setIsReady(true);
    } catch (error) {
      console.error("Error initializing audio analyzer:", error);
    }
  }, [audioRef]);

  return (
    <AudioAnalyzerContext.Provider
      value={{
        analyser: globalAnalyser,
        waveformData: waveformDataRef.current as any,
        frequencyData: frequencyDataRef.current as any,
        isReady,
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
