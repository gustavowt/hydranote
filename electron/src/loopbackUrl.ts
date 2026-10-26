/**
 * Rewrites loopback URLs using 'localhost' as host to IPv4 '127.0.0.1'.
 *
 * Electron 26+ (Node 18+) resolves 'localhost' to '::1' (IPv6) by default without
 * autoSelectFamily. Daemons like Ollama bind IPv4 (127.0.0.1) only, causing fetch()
 * to fail when users configure 'localhost:11434'.
 */
export function rewriteLoopbackUrl(urlString: string): string {
  try {
    const parsed = new URL(urlString);
    if (parsed.hostname.toLowerCase() === 'localhost') {
      parsed.hostname = '127.0.0.1';
      return parsed.toString();
    }
  } catch {
    // Return original string if parsing fails
  }
  return urlString;
}
