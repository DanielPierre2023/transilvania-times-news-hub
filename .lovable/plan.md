

## Plan: Remove Conversations & Reports from Admin Panel

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/admin/AdminLayout.tsx` | Remove the two nav items for `/admin/conversations` and `/admin/reports` from the `navItems` array. Remove unused imports (`MessageSquare`, `FileBarChart`). |
| `src/App.tsx` | Remove the two `<Route>` entries for `conversations` and `reports`. Remove the `ComingSoon` import (no longer used anywhere). |

### File to Delete

| File | Reason |
|------|--------|
| `src/pages/admin/ComingSoon.tsx` | No remaining routes reference it |

