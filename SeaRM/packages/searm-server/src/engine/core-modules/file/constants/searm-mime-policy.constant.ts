// Extensions where SeaRM intentionally deviates from the IANA-standard mime
// mapping returned by mrmime. SeaRM's storage layer persists these values
// instead of mrmime's output (or instead of throwing in the case of `.ts`).
//
// Why each entry exists:
//   - ts/tsx:    IANA registers `.ts` as `video/mp2t` (MPEG-2 Transport Stream),
//                which predates TypeScript. `.tsx` is unregistered. SeaRM uses
//                the developer-tooling convention `application/typescript`.
//
// Only add an entry when (1) mrmime returns the wrong mime (collision) or no
// mime AND (2) SeaRM actually writes that extension via FileStorageService AND
// (3) there is a clear developer-tooling convention for the right mime. For
// everything else — media, archives, documents, `.js`, `.mjs`, `.cjs`, etc. —
// trust mrmime. This policy is reactive: extend it the day we observe a real
// wrong-mime persisted by an exercised code path, not in anticipation.
export const SEARM_MIME_POLICY: Record<string, string> = {
  ts: 'application/typescript',
  tsx: 'application/typescript',
};
