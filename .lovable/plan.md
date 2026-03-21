

## Plan: Fix Competitor Analysis — Truncated JSON & Body Mismatch

### Root Causes

1. **Truncated JSON response**: `maxTokens: 1500` is insufficient for the structured JSON output Gemini generates. The response gets cut off mid-string, producing invalid JSON that fails to parse on the client.

2. **Request body mismatch**: `CompetitorTab.tsx` sends `{ topic }` but the edge function reads `{ industry, companySize, currentTools }`. The user's input is never used.

### Fix 1: Edge Function (`competitor-analysis/index.ts`)

- Increase `maxTokens` from `1500` to `3000`
- Accept `topic` from request body and use it in the prompt (fall back to `industry`/`companySize`/`currentTools` for backward compatibility)

### Fix 2: Frontend (`CompetitorTab.tsx`)

- Send the topic as `industry` (or add a dedicated `topic` field the edge function reads)
- Add safe JSON parsing with a try/catch around the response to handle edge cases gracefully instead of crashing

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/competitor-analysis/index.ts` | Read `topic` from body, use it in prompt, increase `maxTokens` to 3000 |
| `src/pages/admin/geo/CompetitorTab.tsx` | Send `{ topic }` as `{ industry: topic }` to match what the edge function expects, or keep `topic` and have the function read it |

