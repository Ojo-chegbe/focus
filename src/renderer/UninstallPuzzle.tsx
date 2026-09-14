import React, { useState, useEffect, useRef } from "react";
import focusIcon from "./assets/icon.png";

export function UninstallPuzzle() {
  const SEQUENCE_LENGTH = 4;
  const [sequence, setSequence] = useState<number[]>([]);
  const [playerSequence, setPlayerSequence] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSquare, setActiveSquare] = useState<number | null>(null);
  const [message, setMessage] = useState("Watch the sequence carefully.");
  const [solved, setSolved] = useState(false);

  const sequenceRef = useRef<number[]>([]);
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const isPlayingRef = useRef(false);

  const clearTimeouts = () => {
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current = [];
  };

  const playSequence = async (seq: number[]) => {
    setIsPlaying(true);
    isPlayingRef.current = true;
    setMessage("Watch the sequence carefully...");

    for (let i = 0; i < seq.length; i++) {
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 500);
        timeoutsRef.current.push(t);
      });
      setActiveSquare(seq[i]);
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 350);
        timeoutsRef.current.push(t);
      });
      setActiveSquare(null);
    }

    setIsPlaying(false);
    isPlayingRef.current = false;
    setMessage("Now, repeat the sequence to continue.");
  };

  const startPuzzle = () => {
    clearTimeouts();
    const newSeq: number[] = [];
    for (let i = 0; i < SEQUENCE_LENGTH; i++) {
      newSeq.push(Math.floor(Math.random() * 4));
    }
    sequenceRef.current = newSeq;
    setSequence(newSeq);
    setPlayerSequence([]);

    const t = setTimeout(() => {
      void playSequence(newSeq);
    }, 800);
    timeoutsRef.current.push(t);
  };

  useEffect(() => {
    startPuzzle();
    return () => {
      clearTimeouts();
    };
  }, []);

  const handleSquareClick = async (index: number) => {
    if (isPlaying || isPlayingRef.current || solved) return;

    setActiveSquare(index);
    setTimeout(() => setActiveSquare(null), 200);

    const newPlayerSeq = [...playerSequence, index];
    setPlayerSequence(newPlayerSeq);

    const currentIndex = newPlayerSeq.length - 1;
    const targetSeq = sequenceRef.current.length > 0 ? sequenceRef.current : sequence;

    if (newPlayerSeq[currentIndex] !== targetSeq[currentIndex]) {
      setMessage("Incorrect. Starting a new sequence...");
      setIsPlaying(true);
      isPlayingRef.current = true;
      const t = setTimeout(() => {
        startPuzzle();
      }, 1200);
      timeoutsRef.current.push(t);
      return;
    }

    if (newPlayerSeq.length === targetSeq.length) {
      setSolved(true);
      setMessage("Correct! Resuming uninstallation...");
      try {
        await window.focusApi.resumeUninstall();
      } catch (err) {
        console.error("Failed to resume uninstall:", err);
        setMessage("Verified! Please close Focus and run the Windows uninstaller again.");
      }
    }
  };

  return (
    <main
      className="app-shell"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "#0f1724",
        color: "#f8fafc"
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 30 }}>
        <img
          src={focusIcon}
          alt="Focus Logo"
          style={{ width: 64, height: 64, borderRadius: 14, marginBottom: 16, objectFit: "contain" }}
        />
        <h1>Uninstall Verification</h1>
        <p style={{ fontSize: "1.2rem", marginTop: 8 }}>{message}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {[0, 1, 2, 3].map((index) => (
          <button
            key={index}
            onClick={() => void handleSquareClick(index)}
            disabled={isPlaying || solved}
            style={{
              width: 120,
              height: 120,
              borderRadius: 16,
              border: "none",
              cursor: isPlaying || solved ? "default" : "pointer",
              backgroundColor: activeSquare === index ? "#38bdf8" : "rgba(255, 255, 255, 0.1)",
              transition: "background-color 0.1s ease-in-out"
            }}
            aria-label={`Square ${index + 1}`}
          />
        ))}
      </div>
    </main>
  );
}
