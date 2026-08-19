BSFFL Trade Analyzer — Prototype v0.1

WHAT WORKS
- Pulls live 2026 BSFFL data from the MFL API for league 42684.
- Loads team names, rosters, player identity/position/NFL team, salaries/contracts, and future draft-pick ownership.
- Side-by-side trade builder.
- Automatically calculates salary moving each direction and post-trade salary.
- Enforces the $40,000,000 cap.
- Displays owned traded picks using the original franchise name.
- Refresh button reloads MFL data.

WHAT IS INTENTIONALLY NOT FINAL
The 0–100 football valuation is a placeholder. It is NOT the final BSFFL valuation engine.
The next valuation build will connect permitted external ranking/projection sources and add:
- Dynamic redraft/dynasty weighting by point in season.
- Multiple-source consensus.
- BSFFL salary/contract efficiency.
- Team-fit adjustment.
- Early/Mid/Late future-pick projections with confidence percentages.
- Comparable historical BSFFL trades.
- Full BSFFL roster/position legality rules.

RUN IT
1. Install Node.js 18 or newer.
2. Unzip this folder.
3. Open Command Prompt or PowerShell in the folder.
4. Run:
   node server.js
5. Open:
   http://localhost:3000

No npm install is required.

CONFIGURATION
Default:
- MFL_YEAR=2026
- MFL_LEAGUE=42684
- PORT=3000

You can override those environment variables before starting the server.

WHY A LOCAL SERVER
The server calls MFL from the server side. This avoids browser CORS/file:// restrictions and is also the architecture we can later deploy publicly and link from the MFL league page.


V0.2 UI CHANGES
- Players grouped QB, RB, WR, TE, K, DEF and alphabetized by last name within position.
- Player rows now include 2026 salary, 2027 salary, and final contract year.
- Draft picks moved below the player roster.
- The server now requests MFL's salaries endpoint to populate future salary when that endpoint exposes it.
- If MFL does not return a 2027 salary for a player, the interface displays a dash rather than inventing a value.


V0.3 DATA FIX
- Corrected BSFFL future-contract mapping.
- MFL roster field `contractInfo` is the league's custom "2027 Contract" value.
- `salary` = 2026 salary.
- `contractInfo` = 2027 contract amount.
- `contractYear` = first contract year.
- `contractStatus` = final contract year.
- The interface now reads 2027 Contract directly from the live roster response.


V0.4 VALUATION ENGINE
- Replaced the intentionally simplistic placeholder formula with a structured BSFFL valuation engine.
- Dynamic current-season vs dynasty weighting changes by point in the calendar.
- Adds salary-efficiency and contract-length modifiers.
- Draft picks are valued by round and discounted by years into the future.
- Player rankings are provider-ready through valuation.json.
- IMPORTANT: player redraft/dynasty values are deliberately not fabricated. FantasyPros requires an API key for automated API access; ESPN does not provide a current official public developer API suitable for this deployment.
- Until approved data is loaded into valuation.json, players without provider values are explicitly flagged and excluded from the score.


V0.5 FANTASYPROS LIVE INTEGRATION
- Reads FANTASYPROS_API_KEY from the environment; the key is never stored in the project.
- Uses FantasyPros Public API v2.
- Pulls player metadata with MFL external IDs.
- Pulls PPR DRAFT consensus and PPR DYNASTY consensus.
- Converts ECR rank to a smooth 0-100 source value, then applies the BSFFL season weighting.
- FantasyPros responses are cached in memory to reduce API usage:
  player metadata 24 hours, redraft 6 hours, dynasty 12 hours.
- A cold server start uses approximately 3 FantasyPros requests.
- If FantasyPros fails, MFL still loads and the UI reports FantasyPros unavailable rather than inventing player values.

RUN
In the SAME Command Prompt where FANTASYPROS_API_KEY was set:
  node server.js
Then open http://localhost:3000


V0.6 PLAYER MAPPING FIX
- Fixed FantasyPros-to-MFL player mapping.
- Uses external IDs when available, then normalized player name + position against MFL.
- Handles PK/K, DEF/DST and common name suffix differences.
- /api/fantasypros reports meta.mappedPlayers for verification.

V0.6a DIAGNOSTIC
- Adds /api/fantasypros-debug to expose response structure and one sample record only. It never returns the API key.


V0.7 FANTASYPROS MAPPING + VERIFICATION
- Corrected mapping using the actual FantasyPros response structure observed from the diagnostic endpoint.
- FantasyPros player metadata uses `position_id`; ranking records use `player_position_id`.
- Status bar now shows how many FantasyPros players mapped to MFL.
- Trade result Value Breakdown now displays each selected player's FantasyPros Redraft ECR and Dynasty ECR.
- This makes individual-player mapping auditable before additional valuation sources are blended in.


V0.8 MFL NAME-ORDER FIX
- Corrects MFL "Last, First" names before matching them to FantasyPros "First Last" names.
- Example: "Chase, Ja'Marr" and "Ja'Marr Chase" now normalize to the same key.
- Existing position matching and suffix/punctuation normalization remain in place.

V0.8a MFL-ID DIAGNOSTIC
- Adds /api/fantasypros-mfl-debug using the documented external_ids=mfl parameter.
- Returns TreVeyon Henderson when available plus the exact response keys, without exposing the API key.


V0.9 DIRECT MFL-ID MAPPING
- Uses FantasyPros' documented `external_ids=mfl` player metadata request.
- Builds the primary bridge as FantasyPros `player_id` -> `mfl_id`.
- Applies Redraft and Dynasty ranking records through that direct ID bridge.
- Retains normalized name + position only as a fallback.
- Adds mapping diagnostics: direct MFL IDs, metadata fallback count, ranking fallback count, and source record counts.

V0.9a RB LIMIT TEST
- Adds /api/fantasypros-rb-debug.
- Makes one Redraft RB and one Dynasty RB consensus request and reports count/returned/public_api_limited/tier.


V1.0 SOURCE #2 — FANTASYCALC
- Adds FantasyCalc as the second valuation source.
- Requests 10-team, 1QB, full-PPR Redraft and Dynasty values to match BSFFL structure.
- Uses FantasyCalc's native MFL IDs for direct player mapping.
- Caches FantasyCalc for 24 hours, consistent with its terms/best-practice guidance.
- Multi-source player base value now averages available FantasyPros and FantasyCalc source scores after applying dynamic Redraft/Dynasty weighting.
- Trade verification displays both providers' Redraft and Dynasty ranks separately.
- FantasyCalc attribution/link must be prominently displayed in the deployed shared website before public/private-league deployment, per FantasyCalc terms.


V1.1 BSFFL CONTRACT CALIBRATION
- Salary/contract no longer adds a large independent point bucket.
- It is now a bounded percentage modifier of source-derived football market value.
- Current salary, 2027 salary (MFL contractInfo), and controlled contract years are included.
- Total contract effect is capped at +/-12% so market rankings remain the primary driver.
- Source verification now explicitly says which providers actually contributed to each player's score.
- FantasyPros blanks no longer imply that FantasyPros contributed to that player.


V1.2 SOURCE #3 — MFL ADP (VERIFICATION ONLY)
- Adds MFL-wide ADP using native MFL player IDs.
- Filter: PERIOD=RECENT, 10-team, PPR, Keeper, non-mock, 5% cutoff.
- Displays MFL ADP beside FantasyPros and FantasyCalc in Source Verification.
- MFL ADP does NOT affect trade scores yet.
- Cached for 6 hours.


V1.3 MFL ADP IN SCORE
- MFL ADP now affects the current-season/redraft component only.
- Source weights for current-season value: FantasyPros 25%, FantasyCalc 50%, MFL ADP 25%, renormalized when a source is unavailable.
- Dynasty remains FantasyPros 25% + FantasyCalc 50%, renormalized when unavailable; MFL ADP has zero dynasty weight.
- FantasyCalc remains the strongest market signal; MFL ADP is a moderate draft-market signal.
- Verification shows MFL ADP and Score sources for each selected player.


V1.3a BUG FIX
- Fixed the Analyze Trade button failure introduced in v1.3.
- MFL ADP was calling a server-side helper (`fpRankToValue`) that does not exist in the browser.
- Added the equivalent client-side rank-to-market-value function.


V1.3e MFL ADP CORRECTION
- Corrected the production MFL ADP request to use IS_KEEPER=0 (non-keeper).
- ADP is a current-season/redraft signal and should not use keeper-draft ADP.
- Uses native MFL player IDs from the roster; no name-based matching in the scoring path.
- Expected coverage is materially broader than the prior 146-player keeper feed.


V1.4 ADVANTAGE DISPLAY FIX
- The underlying structured valuations and 100-based scores are unchanged.
- The displayed trade advantage now uses symmetric percent difference:
  (Side A value - Side B value) / average of the two values.
- This prevents exaggerated percentages caused by dividing by the lower-valued side.
- Example: 70.4 vs 27.4 displays about 88.6% rather than about 157%/344%-style asymmetric figures.


V1.5 UI + BSFFL MODEL BUILD
UI fixes:
- Player/pick checkbox clicks no longer rerender the entire team panel, so the roster scrollbar stays exactly where it was.
- Both team selectors now default to "Select team"; Dragons/Reapers are no longer preselected.
- Reworked the visual theme to a forest-green blended background with matching green panels/controls.

BSFFL Model Rank (BETA):
- Added /api/bsffl-model.
- Builds a proprietary BSFFL-oriented ranking from MFL data rather than another generic market ranking.
- Uses 2024 and 2025 league-scored YTD player performance, current-season YTD when available, and current MFL projected scores.
- MFL projectedScores are based on FantasySharks projections; historical/current playerScores are scored using the league's own scoring rules.
- Each component is converted into position-aware value over replacement before blending, so historical scoring-rule differences have less effect than comparing raw point totals.
- Approximate 10-team BSFFL replacement depth: QB 15, RB 30, WR 30, TE 15, K 10, DEF 10.
- Preseason weights: projection 40%, 2025 45%, 2024 15%, renormalized per player when a component is unavailable.
- In-season weights: current YTD 35%, projection 25%, 2025 30%, 2024 10%, renormalized per player.
- Refresh/caching window: 6 hours.
- The model is displayed in Source Verification as "BSFFL Model #rank (score)".
- IMPORTANT: the BSFFL Model is verification-only in v1.5 and does not affect the trade score until we inspect/calibrate it against real players and BSFFL trades.


V1.6 CURRENT-YEAR DRAFT PICKS
- Adds available 2026/current-season draft slots from MFL draftResults alongside futureDraftPicks.
- Uses the current MFL owner and original-franchise identity when supplied.
- Completed slots are excluded when MFL reports a selected player.
- Current-year picks are selectable and valued like future picks, with no future-year discount.
- Adds /api/current-draft-picks for troubleshooting.


V1.7 EXACT 2026 PICK VALUES
- Fixes the major issue where every pick in the same round had identical value.
- FantasyCalc dynasty data is now scanned for exact pick assets such as:
  2026 Pick 1.01, 1.02, 1.03 ... 2.01, etc.
- Known 2026 MFL draft slots use FantasyCalc's exact current market value.
- Exact pick values are normalized onto the same 0-100 FantasyCalc market scale as players.
- Example behavior: 2026 1.02 is materially more valuable than 2026 1.09.
- If FantasyCalc does not contain an exact slot, the analyzer transparently falls back to the existing generic round/year curve.
- Future picks still use the generic year-discounted framework until the Early/Mid/Late probability model is added.
- Draft Picks result section now displays the exact normalized market value beside a current-year pick when available.

V1.7.1 HOTFIX
- Restores buildCurrentDraftPicks/normalizeCurrentDraftPicks accidentally removed during the v1.7 FantasyCalc exact-pick update.
- Fixes MFL bootstrap error: buildCurrentDraftPicks is not defined.


V1.8 RESILIENCE BUILD
- Adds persistent on-disk cache under ./cache.
- Successful FantasyCalc, MFL ADP, BSFFL Model, and current-draft-pick responses are saved automatically.
- Live requests retry up to 3 times with exponential backoff and a 12-second timeout.
- If a live source fails, the analyzer automatically falls back to the last successful cached response.
- Cache survives closing Node and rebooting the computer.
- Status line identifies cached data and shows its saved timestamp instead of simply saying unavailable.
- Cache fallback window: 30 days for rankings/model feeds; 7 days for current draft picks.
- FantasyPros access remains separate; production/HOF API credentials can be integrated after access is confirmed.

V1.8.1 HOTFIX
- Restores both buildMflAdp() and buildBsfflModel(), accidentally removed during the v1.7 FantasyCalc exact-pick source replacement.
- Keeps v1.8 persistent cache/retry/fallback behavior.


V1.9 FANTASYPROS PREMIUM PRODUCTION
- Reads the FantasyPros API key locally from fantasypros-key.txt.
- Uses the current production base URL: https://api.fantasypros.com/public/v2/json
- Sends the key only in the x-api-key request header; it is never sent to the browser UI.
- Pulls 2026 PPR consensus rankings for QB/RB/WR/TE/K/DST.
- Pulls 2026 PPR Dynasty consensus rankings for QB/RB/WR/TE.
- Observes a >1 second delay between FantasyPros calls to stay within the user's 1 request/second limit.
- FantasyPros successful results are persisted to disk; later live failures fall back to cached data.
- IMPORTANT: copy your existing fantasypros-key.txt into this v1.9 folder after extraction. The packaged placeholder is intentionally empty.

V1.9.1 FANTASYPROS MAPPING FIX
- Fixes the zero-player FantasyPros result.
- Pulls /nfl/players?external_ids=mfl&ecr=included to build the FPID-to-MFLID crosswalk.
- Joins consensus ranking rows by FantasyPros player ID, then stores them under MFL player ID.
- Keeps PPR redraft and NFL Dynasty (DK) consensus calls.
- Uses a new cache key so the prior empty FantasyPros response cannot mask the fix.

V1.9.2 FANTASYPROS RANK PARSER FIX
- Makes FantasyPros ranking parsing tolerant of current response shapes.
- Uses player_id/fpid/nested player IDs.
- Reads rank_ecr/rank/ecr and nested rank fields.
- Handles external_ids in object or array form.
- Adds redraftRanked and dynastyRanked diagnostics.
- Uses a new FantasyPros cache key so stale mapped-but-unranked data is ignored.

V1.9.3 FANTASYPROS FRONT-END FIX
- Fixes Source Verification reading obsolete redraftRank/dynastyRank fields.
- Reads the server's redraft/dynasty fields, with backward-compatible fallbacks.
- FantasyPros rankings can now display in Source Verification and be reported as a trade-score source.
- Retains the v1.9.2 server-side FPID-to-MFLID ranking mapping fixes.

V1.9.4 FANTASYPROS 6-HOUR CACHE
- Reuses a successful FantasyPros pull for 6 hours.
- Page refreshes inside that window make no FantasyPros API calls.
- After 6 hours, the next request refreshes live data.
- If a refresh fails, the last successful cached FantasyPros data remains usable.

V2.0 PACKAGED UPDATE
- Stadium/football-field appearance based on the approved concept.
- Preserves v1.9.4 trade logic and 6-hour FantasyPros cache.
- Adds START_BSFFL_ANALYZER.bat for one-click startup and browser launch.
FIRST RUN: copy your fantasypros-key.txt into this folder, then double-click START_BSFFL_ANALYZER.bat.

V2.1 CONSOLIDATED BUILD
- Fixes stadium/football-field background layering.
- Makes primary app containers transparent so stadium remains visible.
- Polishes translucent dark-green dashboard panels.
- Adds Refresh Rankings Now control.
- Adds visible cache/page-load status.
- Adds Settings/About panel with version, league, season and sources.
- Adds Clear Trade control.
- Adds defensive scroll-position persistence.
- Keeps team selectors at Select Team on a fresh browser session where supported.
- Retains one-click START_BSFFL_ANALYZER.bat.
- Preserves v1.9.4 valuation/data logic and FantasyPros six-hour server cache.

V2.4
- Removes the contaminated UI screenshot background; field/stadium look is now CSS-only.
- Salary & Contracts now displays 2026, 2027, combined totals and net differences for both teams.
- Salary taken on is bold red; salary saved is bold green.
- Valuation now includes a bounded team-level net cap-obligation adjustment:
  2026 dollars weighted 100%, 2027 dollars weighted 80%, 1.35 valuation points per weighted $1M,
  bounded +/-22 points. Existing individual contract modifiers remain.
- Corrected launcher stops any old server on port 3000 before starting v2.4.

V2.7 BSFFL CONTRACT SURPLUS MODEL
- Replaces the old simple salary modifier with a league-specific replacement-cost model.
- Player value now explicitly treats a trade as: player production + dynasty value + contract surplus/deficit + draft capital.
- Contract surplus compares the player's actual 2026 + weighted 2027 obligation against the salary justified by his production above positional replacement.
- Replacement levels are derived dynamically from the BSFFL rosters and current source-derived player values.
- Position-specific max annual spend reflects BSFFL economics, including lower QB ceiling due to replacement availability.
- Team-level cap flexibility is still valued separately because saved cap dollars can be redeployed elsewhere.
- Salary/contract impact is now shown per player in Value Breakdown.

V2.8 CALIBRATION BUILD
- Reduces salary double-counting: contract surplus remains primary; separate cap-flexibility rate reduced to 1.10 points per weighted $1M.
- Default future salary weight remains 0.85.
- Adds configurable valuation settings stored in browser localStorage.
- Adds calibration diagnostics for salary-overwhelming-football gaps, >$10M cap swings and extreme 2x results.
- Packages historical BSFFL calibration dataset: 61 valid 2025 trades + 22 valid 2026 trades.
- Historical trades are treated as market evidence, not assumed fair trades.

V2.8.1
- Cap-flexibility rate increased from 1.10 to 1.65 points per weighted $1M.
- Historical BSFFL Calibration display removed from the trade-result UI.
- Roster / Legality expandable section removed.
- $40M cap / future roster-rule note moved into Valuation Status.
- Historical trade data remains packaged internally for future model calibration.

V2.8.2
- Cap-flexibility rate tuned from 1.65 to 1.38 points per weighted $1M.
- Top Legality PASS/FAIL result card removed.
- $40M cap rule remains documented in Valuation Status.
- No other trade valuation components changed.

V2.9 FINAL VALIDATION BUILD
- Cap-flexibility remains 1.38.
- Legality renamed Roster Status; VALID / INVALID — cap exceeded.
- Clear Trade restored.
- Switching a team clears that side's selected players and picks and clears the old result.
- Picks-only trades hide Salary & Contracts.
- Low-value trades use display-only advantage compression; underlying valuations are unchanged.

V2.9.2 DISPLAY CALIBRATION
- Underlying player, salary, contract, and pick values are unchanged.
- Displayed trade advantage is now confidence-scaled using Current/Dynasty + Pick value before salary.
- Goal: salary can flip a trade and matter heavily without making modest player-for-player trades appear like blockbuster blowouts.
- Cap-flexibility remains 1.38.

v3.1 calibration update (2026-08-19)
- Updated valuation-status explanation to reflect current BSFFL calibration methodology.
- Compressed displayed advantage percentages without changing underlying player, pick, salary, or contract values.
- Calibration excludes franchise-tag trades materially forced by BSFFL salary rules.
- Audited contract-surplus math used in the Charbonnet example; no formula change made. The displayed deficit follows the current replacement-cost design and salary inputs.


v3.2 advantage calibration update (2026-08-19)
- Keeps v3.1 compression for normal football/pick-value mismatches.
- Adds smooth salary-driven confidence restoration only when a trade transfers more than $2M of weighted 2026/2027 salary.
- Salary restoration ramps to a capped +0.18 display-confidence boost by a $10M weighted salary swing.
- No player, pick, contract-surplus, or cap-flex underlying values changed.
- Calibration targets: Charbonnet + 2026 1.02 for Javonte remains about 17-18%; Tuten for Jonathan Taylor with roughly $13M nominal two-year salary transfer returns toward 24-26%.
