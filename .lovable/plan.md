

## Diagnosis: Article Stuck at "rewriting" — Silent DB Update Failure

### Root Cause

The `process-rewrite-job` pipeline completes successfully (all AI steps pass, cover image generates) but the **final database update fails silently** because of a type mismatch:

- `plagiarism_score` column type: `integer`
- Value being written: `0.3` (float)
- Result: Postgres rejects the update, entire `.update()` call fails, article stays stuck at `status: 'rewriting'` with no error recorded

The code at line 274-292 does **no error checking** on this critical update — it doesn't even read the `error` return from Supabase.

### Fix

**1. `supabase/functions/process-rewrite-job/index.ts`**

- Round `aiScore` and `plagiarismScore` to integers before saving: `Math.round(aiScore)`, `Math.round(plagiarismScore * 100)` (or just `Math.round()`)
- Add error checking on the critical update at line 274: check the `error` return and log/throw if it fails
- Add error checking on the job status update at line 294

**2. Database migration** — Change `ai_score` and `plagiarism_score` from `integer` to `numeric` (or `real`) to handle decimal values properly. This is more robust than rounding.

**3. Add a stuck-article recovery** — In `RssScraper.tsx`, if an article has been `rewriting` for more than 10 minutes, show a "Retry" button instead of the spinner. The rewrite_jobs table shows `succeeded` but the article is stuck — the user needs a way to reset it.

### Files

| File | Change |
|------|--------|
| `supabase/functions/process-rewrite-job/index.ts` | Round scores to integers before DB write; add error checking on both update calls |
| Migration | Alter `ai_score` and `plagiarism_score` columns to `real` type |
| `src/pages/admin/RssScraper.tsx` | Add timeout detection: if `rewriting` for >10 min, show "Reset" button that sets status back to `scraped` |

### Data Fix

The currently stuck article (`a20599d5...`) needs a manual status reset. The rewrite job already succeeded — the data was generated but never saved. It needs to be re-processed.

