import type { ReactNode } from "react";
import { Card, SectionTitle } from "../components/Primitives";
import { branding } from "../config/branding";
import "./pages.css";

function Legal({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <>
      <SectionTitle title={title} hint={`Last updated: ${updated}`} />
      <Card>
        <div className="legal">{children}</div>
      </Card>
    </>
  );
}

function H2({ children }: { children: ReactNode }) {
  return <h2>{children}</h2>;
}

export function PrivacyPage() {
  return (
    <Legal title="Privacy Policy" updated="February 2026">
      <H2>Your data stays on your device</H2>
      <p>
        {branding.APP_NAME} is designed to work without an account and without uploading your body, your camera feed or
        your daily activity anywhere by default.
      </p>
      <ul>
        <li>
          <strong>Camera video</strong> is processed on your device only. Video frames are measured for pose landmarks
          and never recorded, uploaded or streamed to any server.
        </li>
        <li>
          <strong>Progress data</strong> (workouts, reps, XP, streaks, rankings, profile) is stored locally in your
          browser via IndexedDB/localStorage and, when you opt in to online features, may be shared with the arena
          directory so other players can find you by your player code.
        </li>
        <li>
          <strong>Player identity</strong> is a code derived on your device (for example REP-XXXX-XXXX). We do not ask
          for your name, email or phone number.
        </li>
      </ul>

      <H2>Online features and the directory</H2>
      <p>
        Friends search, battles between devices and the player directory are optional online features. When you leave the
        directory toggle on and the ZELUX server is reachable, your public profile (player code, username, level, rank
        and avatar) is published so other players can find you. You can disable sharing at any time in Settings; only the
        fields above are ever shared.
      </p>

      <H2>Region approximation</H2>
      <p>
        When your request passes through a standard HTTP reverse proxy (for example a CDN), ZELUX may read a coarse
        country code supplied by that proxy to display on your profile. The server never stores IP addresses, does not use
        a geo-lookup database and cannot derive a precise location from this header alone.
      </p>

      <H2>What we never do</H2>
      <ul>
        <li>We never sell your data.</li>
        <li>We never show ads based on your fitness data.</li>
        <li>We never share your camera feed, and we never gate core training behind an account.</li>
      </ul>

      <H2>Professional help</H2>
      <p>
        {branding.APP_NAME} is a fitness and game tool. It is not a medical device and does not give medical advice. If
        you feel pain or have a health concern, talk to a qualified professional.
      </p>

      <H2>Children</H2>
      <p>
        The app is a general fitness game. With local-only mode no personal data leaves the device, which makes it
        suitable for children to play under supervision. Online features (friends, battles, directory search) are
        intended for players 13 and older; minors should only use online features with a parent or guardian.
      </p>

      <H2>Contact</H2>
      <p>Questions about privacy? Reach out via the project repository before using online features.</p>
    </Legal>
  );
}

export function TermsPage() {
  return (
    <Legal title="Terms & Conditions" updated="February 2026">
      <H2>1. What ZELUX is</H2>
      <p>
        {branding.APP_NAME} is a browser-based fitness game. Your camera detects your body movements so we can count
        push-ups, squats and other exercises, and turn them into a game. By using ZELUX you accept these terms.
      </p>

      <H2>2. Fitness safety</H2>
      <p>
        Exercise can be strenuous. By using the app you confirm that you are healthy enough to exercise, and you agree
        that:
      </p>
      <ul>
        <li>You train at your own risk and will stop if something hurts.</li>
        <li>You will not use the app in places or situations where injury is likely (for example near stairs, glass, or
          heavy furniture).</li>
        <li>The app is a tool, not a trainer or a doctor. If you have a medical condition, get professional clearance
          first.</li>
      </ul>

      <H2>3. Fair play</H2>
      <p>
        Reps are validated by your device against movement rules. We take fair play seriously: do not generate fake
        results, do not count reps for someone else, and do not manipulate timers. Players who repeatedly cheat may lose
        ranks or leaderboard standing without warning.
      </p>

      <H2>4. Hackathon / demo use</H2>
      <p>
        ZELUX is distributed as a demonstration project. It is provided "as is" without warranty of any kind, express
        or implied, including fitness for a particular purpose. The authors are not liable for any injury, loss or
        damage arising from use of the software.
      </p>

      <H2>5. Accounts and identity</H2>
      <p>
        ZELUX uses device-based identities, not accounts. A player code is generated on your device and is not a
        credential; anyone who knows your code can find your public profile. Treat your code like a gamertag, not a
        password.
      </p>

      <H2>6. Changes</H2>
      <p>
        These terms may change as the product evolves. Continued use after a change means you accept the updated terms.
      </p>
    </Legal>
  );
}