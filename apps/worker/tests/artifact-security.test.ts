import {
  ARTIFACT_CONTENT_SECURITY_POLICY,
  injectArtifactContentSecurityPolicy,
} from "../src/utils/artifact-security.js";

describe("artifact content security policy", () => {
  it("places the policy before author-controlled markup", () => {
    const html = '<!doctype html><html><head><script src="https://evil.example/x.js"></script></head></html>';
    const secured = injectArtifactContentSecurityPolicy(html);

    expect(secured.indexOf("Content-Security-Policy")).toBeGreaterThan(0);
    expect(secured.indexOf("Content-Security-Policy")).toBeLessThan(secured.indexOf("evil.example"));
  });

  it("covers fragments and documents without a head", () => {
    const secured = injectArtifactContentSecurityPolicy("<main>hello</main>");
    expect(secured.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
  });

  it("allows self-contained assets while denying network and form egress", () => {
    expect(ARTIFACT_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(ARTIFACT_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(ARTIFACT_CONTENT_SECURITY_POLICY).toContain("form-action 'none'");
    expect(ARTIFACT_CONTENT_SECURITY_POLICY).toContain("img-src data: blob:");
    expect(ARTIFACT_CONTENT_SECURITY_POLICY).not.toMatch(/https?:/);
  });
});
