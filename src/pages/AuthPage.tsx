import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Field } from "../components/Controls";
import { branding } from "../config/branding";
import { useAuthStore } from "../stores/authStore";
import { toast } from "../stores/toastStore";
import {
  checkPasswordStrength,
  credentialsAreValid,
  listGoogleAccounts,
  requestOtp,
  validateEmail,
  validateUsername,
  verifyOtp,
  type LinkedGoogleAccount,
} from "../core/auth/AuthService";
import "./pages.css";

const OTP_RESEND_MS = 30_000;
const OTP_EXPIRY_MS = 5 * 60 * 1000;

type Mode = "login" | "register";
type Step = "form" | "otp" | "google";

function GoogleG({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function EyeToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="field__eye" aria-label={visible ? "Hide password" : "Show password"} onClick={onToggle}>
      {visible ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m2.5 2.5 19 19" />
      <path d="M10.6 4.5A9.8 9.8 0 0 1 12 4.5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.5" />
      <path d="M6.6 6.6A16.5 16.5 0 0 0 2 11.5s3.5 7 10 7a9.6 9.6 0 0 0 3.5-.7" />
    </svg>
  );
}

function deriveDefaultName(email: string): string {
  return (
    email
      .split("@")[0]
      .replace(/[._\-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .slice(0, 20) || "Player"
  );
}

export function AuthPage() {
  const [mode, setMode] = useState<Mode>("register");
  const [step, setStep] = useState<Step>("form");
  const player = useAuthStore((s) => s.player);
  const busy = useAuthStore((s) => s.busy);
  const register = useAuthStore((s) => s.register);
  const signIn = useAuthStore((s) => s.signIn);
  const googleSignIn = useAuthStore((s) => s.googleSignIn);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pwVisible, setPwVisible] = useState(false);
  const [errors, setErrors] = useState<{ username?: string; email?: string; password?: string; otp?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [otpEmail, setOtpEmail] = useState("");
  const [otpDemoCode, setOtpDemoCode] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [otpExpireAt, setOtpExpireAt] = useState(0);
  const [otpResendAt, setOtpResendAt] = useState(0);

  const [googleAccounts, setGoogleAccounts] = useState<LinkedGoogleAccount[]>([]);
  const [gName, setGName] = useState("");
  const [gEmail, setGEmail] = useState("");
  const [otpNow, setOtpNow] = useState(Date.now());

  useEffect(() => {
    if (player) navigate(from, { replace: true });
  }, [player, from, navigate]);

  useEffect(() => {
    const t = setInterval(() => setOtpNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const emailCheck = email ? validateEmail(email) : null;
  const emailInvalid = email.trim() !== "" && emailCheck !== null && !emailCheck.ok;

  const pwCheck = checkPasswordStrength(password);
  const pwOk = pwCheck.ok;

  const usernameCheck = validateUsername(username);
  const usernameOk = usernameCheck.ok;

  const otpRemaining = otpExpireAt ? Math.max(0, Math.floor((otpExpireAt - otpNow) / 1000)) : 0;
  const resendRemaining = otpResendAt ? Math.max(0, Math.ceil((otpResendAt - otpNow) / 1000)) : 0;

  function resetValidation(nextEmail?: string) {
    setErrors({});
    setFormError(null);
    if (nextEmail) setOtpDemoCode("");
  }

  function switchMode(next: Mode) {
    setMode(next);
    resetValidation();
    setPassword("");
    setUsername("");
  }

  function openGoogle() {
    resetValidation();
    setGName(mode === "register" ? username : "");
    setGEmail(email);
    listGoogleAccounts()
      .then((accounts) => {
        setGoogleAccounts(accounts);
        setStep("google");
      })
      .catch((e) => setFormError((e as Error).message));
  }

  async function requestCode() {
    setFormError(null);
    const errs: typeof errors = {};
    if (!usernameOk) errs.username = usernameCheck.reason;
    if (emailCheck && !emailCheck.ok) errs.email = emailCheck.reason;
    if (!pwOk) errs.password = pwCheck.reason;
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    if (mode === "login") {
      setSubmitting(true);
      try {
        const valid = await credentialsAreValid({ email: email.trim(), password });
        if (!valid) {
          setErrors({ password: "Wrong password — or this account signs in with Google." });
          return;
        }
      } finally {
        setSubmitting(false);
      }
    }
    setSubmitting(true);
    try {
      const delivery = await requestOtp(email.trim());
      setOtpEmail(delivery.email);
      setOtpDemoCode(delivery.code);
      setOtpInput("");
      setErrors({});
      setOtpExpireAt(Date.now() + OTP_EXPIRY_MS);
      setOtpResendAt(Date.now() + OTP_RESEND_MS);
      setStep("otp");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function resendOtp() {
    if (resendRemaining > 0 || submitting) return;
    try {
      const delivery = await requestOtp(otpEmail || email.trim());
      setOtpDemoCode(delivery.code);
      setOtpInput("");
      setErrors((e) => ({ ...e, otp: undefined }));
      setOtpResendAt(Date.now() + OTP_RESEND_MS);
      setOtpExpireAt(Date.now() + OTP_EXPIRY_MS);
      toast("info", "New code generated", "Simulated delivery — the code is shown on screen.");
    } catch (e) {
      setFormError((e as Error).message);
    }
  }

  async function verify() {
    if (otpInput.length !== 6 || submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await verifyOtp(otpEmail, otpInput);
      if (mode === "register") {
        const playerId = await register(otpEmail, username.trim(), password);
        toast("ok", "Account created", `Your REP Arena profile is live — ${playerId}.`);
        toast("info", "Private & offline-first", "Everything is stored locally on this device.");
      } else {
        await signIn(otpEmail, password);
        toast("ok", "Welcome back");
      }
    } catch (e) {
      setErrors((prev) => ({ ...prev, otp: (e as Error).message }));
    } finally {
      setSubmitting(false);
    }
  }

  async function googleContinue(account?: LinkedGoogleAccount) {
    setFormError(null);
    const chosenEmail = (account?.email ?? gEmail.trim()).toLowerCase();
    const chosenName = account?.username ?? gName.trim();
    const emailRes = validateEmail(chosenEmail);
    if (!emailRes.ok) {
      setErrors({ email: emailRes.reason });
      return;
    }
    const nameToUse = account?.username ?? (chosenName || deriveDefaultName(chosenEmail));
    const un = validateUsername(nameToUse);
    if (!account && !un.ok) {
      setErrors({ username: un.reason });
      return;
    }
    try {
      const res = await googleSignIn(nameToUse, chosenEmail);
      toast(
        "ok",
        res.created ? "Google account linked" : "Signed in with Google",
        res.created ? "Profile created and linked to your Gmail." : "Welcome back."
      );
      toast("info", "Simulated OAuth", "Offline demo — no real Google request was made.");
    } catch (e) {
      setErrors((prev) => ({ ...prev, email: (e as Error).message }));
    }
  }

  const canRequestCode = email.trim() !== "" && password.length >= 6 && (mode === "login" || usernameOk) && !busy && !submitting;

  return (
    <div className="auth-wrap">
      <div className="auth-orb auth-orb--a" />
      <div className="auth-orb auth-orb--b" />
      <div className="auth-orb auth-orb--c" />
      <div className="auth-grid" />

      <div className="auth-card">
        <div className="auth-brand">
          <img src={branding.APP_LOGO} alt="" width={52} height={52} />
          <h1>
            <span className="grad-text">{branding.APP_NAME}</span>
          </h1>
          <p className="auth-tagline">{branding.APP_TAGLINE}</p>
          <p className="auth-sub">Camera reads your push-ups. Reps are your score. Compete, level up, and get coached — all private and on-device.</p>
        </div>

        {step === "form" ? (
          <div>
            <div className="auth-tabs">
              <button type="button" className={`auth-tab${mode === "register" ? " is-active" : ""}`} onClick={() => switchMode("register")}>
                Create account
              </button>
              <button type="button" className={`auth-tab${mode === "login" ? " is-active" : ""}`} onClick={() => switchMode("login")}>
                Sign in
              </button>
            </div>

            <Button variant="subdued" block onClick={openGoogle} className="btn--google">
              <GoogleG /> Continue with Google
            </Button>

            <div className="auth-divider">
              <span>or use your Gmail</span>
            </div>

            <div className="auth-errors">
              {formError ? <p className="auth-form-error">{formError}</p> : null}
            </div>

            <div className="stack">
              {mode === "register" ? (
                <Field label="Username" hint="Shown publicly. 3–16 chars, letters/numbers/_/-">
                  <input
                    className={`field__control${errors.username ? " is-invalid" : ""}`}
                    value={username}
                    maxLength={20}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (errors.username) setErrors((x) => ({ ...x, username: undefined }));
                    }}
                    onBlur={() => {
                      if (username.trim() && !usernameOk) setErrors((x) => ({ ...x, username: usernameCheck.reason }));
                    }}
                    placeholder="VoltKnight"
                    autoComplete="username"
                  />
                  {errors.username ? <span className="field__error">{errors.username}</span> : null}
                </Field>
              ) : null}

              <Field label="Email" hint="Must be a real, valid @gmail.com address — a one-time code will be sent to verify it.">
                <input
                  className={`field__control${emailInvalid || errors.email ? " is-invalid" : ""}`}
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailInvalid) setErrors((x) => ({ ...x, email: undefined }));
                  }}
                  onBlur={() => {
                    if (email.trim() && emailCheck && !emailCheck.ok) setErrors((x) => ({ ...x, email: emailCheck.reason }));
                  }}
                  placeholder="you@gmail.com"
                  autoComplete="email"
                />
                {emailInvalid && !errors.email ? <span className="field__error">{emailCheck!.reason}</span> : null}
                {errors.email ? <span className="field__error">{errors.email}</span> : null}
              </Field>

              <Field label="Password" hint={mode === "register" ? "At least 6 characters. Never sent to a server." : "Your Gmail account password is not needed here."}>
                <div className="field__wrap">
                  <input
                    className={`field__control${errors.password ? " is-invalid" : ""}`}
                    type={pwVisible ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.password) setErrors((x) => ({ ...x, password: undefined }));
                    }}
                    onBlur={() => {
                      if (password && !pwOk) setErrors((x) => ({ ...x, password: pwCheck.reason }));
                    }}
                    placeholder="••••••••"
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                  />
                  <EyeToggle visible={pwVisible} onToggle={() => setPwVisible((v) => !v)} />
                </div>
                {mode === "register" && password ? (
                  <div className="pw-meter" aria-label={`Password strength ${pwCheck.score} of 5`}>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span key={i} className={`pw-meter__bar${i < pwCheck.score ? " is-filled" : ""}`} />
                    ))}
                  </div>
                ) : null}
                {errors.password ? <span className="field__error">{errors.password}</span> : null}
              </Field>

              <Button variant="primary" size="lg" block onClick={requestCode} disabled={!canRequestCode}>
                {submitting ? "Working…" : mode === "register" ? "Create account" : "Continue"}
              </Button>

              <ul className="auth-trust">
                <li>PBKDF2-hashed &amp; salted locally</li>
                <li>Saved permanently on this device</li>
                <li>Works fully offline</li>
              </ul>
            </div>
          </div>
        ) : null}

        {step === "otp" ? (
          <div className="stack">
            <button type="button" className="auth-back" onClick={() => setStep("form")}>
              <span className="auth-back__arrow">←</span> Back
            </button>
            <div className="auth-otp-head">
              <span className="auth-otp-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
              </span>
              <div>
                <h3>Verify your inbox</h3>
                <p className="auth-sub">
                  We sent a 6-digit code to <strong className="mono">{otpEmail}</strong>.
                </p>
              </div>
            </div>

            <div className="demo-inbox">
              <span className="demo-inbox__badge">Offline demo · simulated delivery</span>
              <p>
                In production this code is emailed to you. Here it is shown on-screen so the flow works end to end:
              </p>
              <div className="demo-code mono">{otpDemoCode.replace(/^(\d{3})/, "$1 ")}</div>
              <p className="demo-inbox__meta">
                Expires in {Math.floor(otpRemaining / 60)}:{String(otpRemaining % 60).padStart(2, "0")}
              </p>
            </div>

            <Field label="One-time code" hint="6 digits. Auto-submits when complete.">
              <input
                className={`field__control otp-input${errors.otp ? " is-invalid" : ""}`}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otpInput}
                maxLength={6}
                onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
                autoFocus
              />
              {errors.otp ? <span className="field__error">{errors.otp}</span> : null}
              {formError ? <span className="field__error">{formError}</span> : null}
            </Field>

            <Button variant="primary" size="lg" block onClick={verify} disabled={otpInput.length !== 6 || busy || submitting}>
              {submitting ? "Verifying…" : mode === "register" ? "Create my account" : "Sign me in"}
            </Button>

            <div className="row" style={{ justifyContent: "center" }}>
              <button type="button" className="auth-link-btn" onClick={resendOtp} disabled={resendRemaining > 0 || submitting}>
                {resendRemaining > 0 ? `Resend code in ${resendRemaining}s` : "Resend code"}
              </button>
            </div>
          </div>
        ) : null}

        {step === "google" ? (
          <div className="stack">
            <button type="button" className="auth-back" onClick={() => setStep("form")}>
              <span className="auth-back__arrow">←</span> Back
            </button>
            <h3>Choose a Google account</h3>
            <p className="auth-sub">Offline simulation of the Google sign-in sheet.</p>

            {googleAccounts.length > 0 ? (
              <div className="google-list">
                {googleAccounts.map((acc) => (
                  <button key={acc.email} type="button" className="google-row" onClick={() => googleContinue(acc)}>
                    <span className="google-row__avatar">{acc.username.slice(0, 1).toUpperCase()}</span>
                    <span className="google-row__body">
                      <strong>{acc.username}</strong>
                      <span className="muted">{acc.email}</span>
                    </span>
                    <GoogleG className="google-row__logo" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="google-none">No linked Google accounts yet.</p>
            )}

            <div className="auth-divider">
              <span>or add another account</span>
            </div>

            <div className="stack" style={{ gap: "var(--sp-3)" }}>
              <Field label="Google account email">
                <input
                  className={`field__control${errors.email ? " is-invalid" : ""}`}
                  type="email"
                  value={gEmail}
                  onChange={(e) => {
                    setGEmail(e.target.value);
                    if (errors.email) setErrors((x) => ({ ...x, email: undefined }));
                  }}
                  placeholder="you@gmail.com"
                  autoComplete="email"
                />
                {errors.email ? <span className="field__error">{errors.email}</span> : null}
              </Field>
              <Field label="Your name" hint="Used as your public username if this is a new account.">
                <input
                  className={`field__control${errors.username ? " is-invalid" : ""}`}
                  value={gName}
                  maxLength={20}
                  onChange={(e) => {
                    setGName(e.target.value);
                    if (errors.username) setErrors((x) => ({ ...x, username: undefined }));
                  }}
                  placeholder="Alex Rivers"
                  autoComplete="name"
                />
                {errors.username ? <span className="field__error">{errors.username}</span> : null}
              </Field>
              <Button variant="primary" block onClick={() => googleContinue()} disabled={busy}>
                {busy ? "Linking…" : "Continue with Google"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}