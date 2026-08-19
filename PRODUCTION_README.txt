BSFFL TRADE ANALYZER v3.0 — PRODUCTION NOTES

LOCAL TESTING
1. Put the FantasyPros API key in fantasypros-key.txt OR set FANTASYPROS_API_KEY.
2. Run START_BSFFL_ANALYZER.bat.
3. Visit /api/health to verify service status. The API key itself is never returned.

PRODUCTION DEPLOYMENT
- Set FANTASYPROS_API_KEY as a server-side environment variable. Do not upload fantasypros-key.txt with a real key.
- Set PORT if required by the hosting provider.
- MFL_YEAR defaults to 2026 and MFL_LEAGUE defaults to 42684.
- Keep the cache directory writable so stale-cache fallback can protect against upstream outages.
- Old *-debug endpoints return 404.
- v3.0 preserves the frozen v2.9.2 valuation formula.

RESILIENCE
- FantasyPros: 6-hour fresh cache with stale-cache fallback.
- FantasyCalc, MFL ADP, BSFFL Model: disk-cache fallback.
- MFL bootstrap: aggregate disk-cache fallback added in v3.0.
- User-facing errors are sanitized and do not expose upstream response bodies or secrets.
