import { useState, useEffect } from "react";
import { loginWithPassword } from "../../api/matrix";
import { registerUser, validateInvite, getInstanceInfo, getTOTPStatus, loginVerifyTOTP } from "../../api/concord";
import { useAuthStore } from "../../stores/auth";
import { INVITE_STORAGE_KEY } from "../../App";

export function LoginForm() {
  const login = useAuthStore((s) => s.login);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [serverName, setServerName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [validatingInvite, setValidatingInvite] = useState(false);
  const [instanceName, setInstanceName] = useState("Concord");
  const [showWelcome, setShowWelcome] = useState(true);
  const [welcomeFading, setWelcomeFading] = useState(false);
  const [showDownloads, setShowDownloads] = useState(false);

  // TOTP verification state
  const [pendingLogin, setPendingLogin] = useState<{
    accessToken: string;
    userId: string;
    deviceId: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpError, setTotpError] = useState("");

  // Fetch instance name
  useEffect(() => {
    getInstanceInfo()
      .then((info) => {
        if (info.name) {
          setInstanceName(info.name);
          document.title = info.name;
        }
      })
      .catch(() => {});
  }, []);

  // Welcome screen auto-dismiss
  useEffect(() => {
    const fadeTimer = setTimeout(() => setWelcomeFading(true), 1500);
    const hideTimer = setTimeout(() => setShowWelcome(false), 2200);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  // Check URL and sessionStorage for invite token
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token =
      params.get("invite") || sessionStorage.getItem(INVITE_STORAGE_KEY);
    if (token) {
      setInviteToken(token);
      setMode("register");
      setValidatingInvite(true);
      validateInvite(token)
        .then((result) => {
          if (result.valid) {
            setServerName(result.server_name);
          } else {
            // Invite is invalid but user can still register without it
            setInviteToken("");
            setError("Invite link is invalid or expired — you can still create an account");
          }
        })
        .catch(() => {
          setInviteToken("");
          setError("Failed to validate invite link — you can still create an account");
        })
        .finally(() => {
          setValidatingInvite(false);
        });
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "login") {
        const result = await loginWithPassword(username, password);
        // Check if user has TOTP enabled
        try {
          const totpStatus = await getTOTPStatus(result.accessToken);
          if (totpStatus.enabled) {
            // Hold login pending TOTP verification
            setPendingLogin({
              accessToken: result.accessToken,
              userId: result.userId,
              deviceId: result.deviceId,
            });
            setLoading(false);
            return;
          }
        } catch (totpErr: unknown) {
          // Only allow bypass if the TOTP endpoint doesn't exist (404);
          // any other error (network, server) should block login for safety
          const status = (totpErr as { status?: number })?.status;
          if (status !== 404) {
            setError("Could not verify two-factor authentication status. Please try again.");
            setLoading(false);
            return;
          }
        }
        login(result.accessToken, result.userId, result.deviceId);
      } else {
        const result = await registerUser(
          username,
          password,
          inviteToken || undefined,
        );
        login(result.access_token, result.user_id, result.device_id);
        // Clear invite from URL and sessionStorage
        sessionStorage.removeItem(INVITE_STORAGE_KEY);
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch (err: unknown) {
      const error = err as { message?: string; data?: { error?: string } };
      // matrix-js-sdk errors have data.error, our API errors have message
      setError(error.data?.error || error.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleTOTPVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingLogin || totpCode.length !== 6) return;
    setTotpError("");
    setLoading(true);
    try {
      await loginVerifyTOTP(totpCode, pendingLogin.accessToken);
      login(pendingLogin.accessToken, pendingLogin.userId, pendingLogin.deviceId);
      setPendingLogin(null);
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-900 flex items-center justify-center p-4 relative">
      {/* Welcome overlay */}
      {showWelcome && (
        <div
          className={`absolute inset-0 z-10 bg-zinc-900 flex items-center justify-center transition-opacity duration-700 ${
            welcomeFading ? "opacity-0" : "opacity-100"
          }`}
        >
          <div className="text-center">
            <h1 className="text-5xl font-bold text-white mb-3 animate-[fadeSlideUp_0.6s_ease-out]">
              {instanceName}
            </h1>
            <p className="text-zinc-400 text-lg animate-[fadeSlideUp_0.6s_ease-out_0.2s_both]">
              Welcome back
            </p>
          </div>
        </div>
      )}

      <div className="w-full max-w-sm">
        {/* TOTP verification screen */}
        {pendingLogin ? (
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">{instanceName}</h1>
            <p className="text-zinc-400 text-sm mb-6">Enter the 6-digit code from your authenticator app</p>
            <form onSubmit={handleTOTPVerify} className="space-y-4">
              <input
                type="text"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="w-full px-4 py-4 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-center text-2xl font-mono tracking-[0.5em] placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                maxLength={6}
                autoFocus
              />
              {totpError && <p className="text-red-400 text-sm">{totpError}</p>}
              <button
                type="submit"
                disabled={loading || totpCode.length !== 6}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors"
              >
                {loading ? "Verifying..." : "Verify"}
              </button>
              <button
                type="button"
                onClick={() => { setPendingLogin(null); setTotpCode(""); setTotpError(""); }}
                className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
              >
                Back to login
              </button>
            </form>
          </div>
        ) : (
        <>
        <h1 className="text-3xl font-bold text-white text-center mb-2">
          {instanceName}
        </h1>

        {validatingInvite && (
          <p className="text-center text-zinc-400 text-sm mb-6 mt-6">
            Validating invite...
          </p>
        )}

        {!validatingInvite && serverName && (
          <p className="text-center text-indigo-400 text-sm mb-6">
            You've been invited to <strong>{serverName}</strong>
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mt-6">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
            required
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}

          {/* Login + Register buttons side by side */}
          <div className="flex gap-2">
            <button
              type={mode === "login" ? "submit" : "button"}
              onClick={mode !== "login" ? () => setMode("login") : undefined}
              disabled={mode === "login" && (loading || validatingInvite)}
              className={`flex-1 py-3 font-medium rounded-lg transition-colors ${
                mode === "login"
                  ? "bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700"
              }`}
            >
              {mode === "login" && loading ? "..." : "Login"}
            </button>
            <button
              type={mode === "register" ? "submit" : "button"}
              onClick={mode !== "register" ? () => setMode("register") : undefined}
              disabled={mode === "register" && (loading || validatingInvite)}
              className={`flex-1 py-3 font-medium rounded-lg transition-colors ${
                mode === "register"
                  ? "bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700"
              }`}
            >
              {mode === "register" && loading
                ? "..."
                : serverName
                  ? `Join ${serverName}`
                  : "Register"}
            </button>
          </div>
        </form>

        {/* Download client — toggle */}
        <div className="mt-8 text-center">
          {!showDownloads ? (
            <button
              onClick={() => setShowDownloads(true)}
              className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
            >
              Download Client
            </button>
          ) : (
            <div className="flex justify-center gap-4 text-sm animate-[fadeSlideUp_0.3s_ease-out]">
              <a
                href="/downloads/Concord Setup.exe"
                className="text-zinc-400 hover:text-white transition-colors"
              >
                Windows
              </a>
              <span className="text-zinc-700">|</span>
              <a
                href="/downloads/Concord.AppImage"
                className="text-zinc-400 hover:text-white transition-colors"
              >
                Linux
              </a>
              <span className="text-zinc-700">|</span>
              <a
                href="/downloads/Concord-mac.zip"
                className="text-zinc-400 hover:text-white transition-colors"
              >
                macOS
              </a>
            </div>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
