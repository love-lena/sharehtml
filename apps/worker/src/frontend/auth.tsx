/** @jsxImportSource hono/jsx */
import { toHtml } from "./jsx.js";

const styles = `
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f4f2; color: #18181b; }
  main { width: min(420px, calc(100vw - 32px)); background: #fff; border: 1px solid #deded9; border-radius: 14px; padding: 32px; box-shadow: 0 12px 40px rgba(0,0,0,.08); }
  h1 { margin: 0 0 8px; font-size: 25px; letter-spacing: -.04em; }
  p { margin: 0 0 24px; color: #656565; line-height: 1.5; }
  form { display: grid; gap: 10px; }
  label { font-size: 13px; font-weight: 600; }
  input, button, .github { width: 100%; min-height: 44px; border-radius: 8px; font: inherit; }
  input { border: 1px solid #cfcfca; padding: 0 12px; background: #fff; color: #18181b; }
  button, .github { border: 0; padding: 0 16px; background: #18181b; color: white; font-weight: 650; cursor: pointer; }
  .github { display: grid; place-items: center; text-decoration: none; }
  .divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; color: #888; font-size: 12px; }
  .divider::before, .divider::after { content: ''; height: 1px; background: #ddd; flex: 1; }
  .message { padding: 10px 12px; border-radius: 8px; background: #f3f3ef; margin-bottom: 16px; font-size: 14px; color: #444; }
  .error { background: #fff0f0; color: #9f2020; }
  .muted { margin-top: 18px; margin-bottom: 0; font-size: 12px; }
  @media (prefers-color-scheme: dark) {
    body { background: #111; color: #f5f5f5; } main { background: #191919; border-color: #333; }
    p { color: #aaa; } input { background: #111; border-color: #444; color: #fff; }
    button, .github { background: #f3f3f3; color: #111; } .message { background: #292929; color: #ccc; }
    .error { background: #3c1c1c; color: #ffb3b3; }
  }
`;

interface LoginViewProps {
  next: string;
  githubEnabled: boolean;
  emailEnabled: boolean;
  message?: string;
  error?: string;
}

export function LoginView({ next, githubEnabled, emailEnabled, message, error }: LoginViewProps): string {
  return toHtml(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Sign in · sharehtml</title>
        <style>{styles}</style>
      </head>
      <body>
        <main>
          <h1>Sign in to sharehtml</h1>
          <p>
            {githubEnabled && emailEnabled
              ? "Use GitHub or get a one-time code by email."
              : githubEnabled
                ? "Continue with your GitHub account."
                : "Get a one-time code by email."}
          </p>
          {message && <div class="message">{message}</div>}
          {error && <div class="message error">{error}</div>}
          {githubEnabled && <a class="github" href={`/auth/github?next=${encodeURIComponent(next)}`}>Continue with GitHub</a>}
          {githubEnabled && emailEnabled && <div class="divider">or</div>}
          {emailEnabled && (
            <form method="post" action="/auth/email/request">
              <input type="hidden" name="next" value={next} />
              <label for="email">Email address</label>
              <input id="email" name="email" type="email" autocomplete="email" required autofocus={!githubEnabled} />
              <button type="submit">Email me a code</button>
            </form>
          )}
          {!githubEnabled && !emailEnabled && (
            <div class="message error">No login provider is configured. Add GitHub OAuth or Resend credentials.</div>
          )}
        </main>
      </body>
    </html>,
  );
}

export function VerifyEmailView({ email, next, error }: { email: string; next: string; error?: string }): string {
  return toHtml(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Enter your code · sharehtml</title>
        <style>{styles}</style>
      </head>
      <body>
        <main>
          <h1>Check your email</h1>
          <p>Enter the six-digit code sent to {email}. It expires in 10 minutes.</p>
          {error && <div class="message error">{error}</div>}
          <form method="post" action="/auth/email/verify">
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="next" value={next} />
            <label for="code">One-time code</label>
            <input id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength={6} autocomplete="one-time-code" required autofocus />
            <button type="submit">Sign in</button>
          </form>
          <p class="muted"><a href={`/auth/login?next=${encodeURIComponent(next)}`}>Use another email</a></p>
        </main>
      </body>
    </html>,
  );
}
