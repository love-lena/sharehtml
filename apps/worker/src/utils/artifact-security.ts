export const ARTIFACT_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
].join("; ");

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CONTENT_SECURITY_POLICY}">`;

/**
 * Put the policy before all author-controlled markup. HTML parsing places a
 * leading meta element in an implicit head, so this also covers documents that
 * omit html/head tags without searching attacker-controlled text for a tag.
 */
export function injectArtifactContentSecurityPolicy(html: string): string {
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  if (!doctype) return `${CSP_META}\n${html}`;

  const insertionPoint = doctype[0].length;
  return `${html.slice(0, insertionPoint)}\n${CSP_META}${html.slice(insertionPoint)}`;
}
