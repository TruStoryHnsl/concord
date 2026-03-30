import { useState, useEffect } from "react";

interface BanOverlayProps {
  banMode: "soft" | "harsh";
  kickCount: number;
  kickLimit: number;
  onDismiss: () => void;
}

export function BanOverlay({ banMode, kickCount, kickLimit, onDismiss }: BanOverlayProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    // Dramatic reveal
    const t1 = setTimeout(() => setPhase(1), 500);
    const t2 = setTimeout(() => setPhase(2), 2000);
    const t3 = setTimeout(() => setPhase(3), 4000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  if (banMode === "harsh") {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-6">
          {phase >= 0 && (
            <div className="animate-[fadeSlideUp_1s_ease-out]">
              <div className="text-red-500 text-6xl mb-4">
                <svg className="w-24 h-24 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
            </div>
          )}
          {phase >= 1 && (
            <div className="animate-[fadeSlideUp_0.8s_ease-out]">
              <h1 className="text-4xl font-bold text-red-500 mb-2">ACCESS DENIED</h1>
              <p className="text-zinc-400 text-lg">
                Your IP address has been permanently flagged as
              </p>
            </div>
          )}
          {phase >= 2 && (
            <div className="animate-[fadeSlideUp_0.8s_ease-out]">
              <p className="text-3xl font-bold text-amber-400 italic">
                "belonging to a dumb-bum"
              </p>
              <p className="text-zinc-500 mt-4 text-sm">
                You have been kicked {kickCount} times within the allowed window.
                As a result, you can no longer use Concord. Ever. Again.
              </p>
            </div>
          )}
          {phase >= 3 && (
            <div className="animate-[fadeSlideUp_0.8s_ease-out] space-y-4">
              <div className="bg-red-950/30 border border-red-800/50 rounded-lg p-4">
                <p className="text-red-400 text-xs font-mono">
                  BAN_TYPE: IP_PERMANENT | REASON: EXCESSIVE_KICKS ({kickCount}/{kickLimit})
                </p>
              </div>
              <button
                onClick={onDismiss}
                className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors"
              >
                I understand
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Soft ban — warning message
  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-8">
      <div className="max-w-md bg-zinc-900 border border-zinc-700 rounded-xl p-8 text-center space-y-4 animate-[fadeSlideUp_0.5s_ease-out]">
        <div className="text-amber-500 text-5xl mb-2">
          <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white">You've been kicked</h2>
        <p className="text-zinc-400 text-sm">
          You have been kicked from the voice channel ({kickCount} of {kickLimit} kicks).
        </p>
        <div className="bg-amber-950/30 border border-amber-800/50 rounded-lg p-3">
          <p className="text-amber-400 text-sm">
            {kickCount >= kickLimit - 1
              ? "This is your final warning. One more kick and you will be permanently banned."
              : `After ${kickLimit} kicks within the allowed time window, you will be permanently banned from this server.`
            }
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="px-6 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
        >
          I understand
        </button>
      </div>
    </div>
  );
}
