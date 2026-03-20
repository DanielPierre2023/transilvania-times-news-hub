

## Plan: Fix Security Vulnerabilities + Verify Edge Function Deployment

### Critical Security Fix 1: Privilege Escalation on `user_roles`

Any authenticated user can INSERT themselves as admin because the `ALL` policy's `USING` clause isn't evaluated on INSERT. Fix by adding an explicit restrictive policy.

```sql
-- Remove the ALL policy and replace with granular ones
DROP POLICY "Admins can manage roles" ON user_roles;

CREATE POLICY "Admins can read all roles" ON user_roles
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert roles" ON user_roles
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update roles" ON user_roles
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles" ON user_roles
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- Keep the "Users can read own role" policy as-is
```

### Critical Security Fix 2: Exposed Email in `blog_comments`

Public reads of approved comments expose `author_email`. Fix by creating a view that excludes the email column, or by modifying the public SELECT policy to use a security barrier view.

Simplest approach: create a database function that returns comments without the email field, and have the frontend use that. Or, replace the public policy with one that only allows selecting specific columns (Postgres RLS doesn't support column-level filtering, so a view is needed).

**Chosen approach**: Drop the public SELECT policy and create a secure view:

```sql
DROP POLICY "Public can read approved comments" ON blog_comments;

CREATE VIEW public.blog_comments_public
  WITH (security_barrier = true)
AS SELECT id, post_id, content, author_name, ai_reply, status, created_at
   FROM blog_comments
   WHERE status = 'approved';

GRANT SELECT ON public.blog_comments_public TO anon, authenticated;
```

Then update frontend code that reads public comments to query `blog_comments_public` instead of `blog_comments`.

### Step 3: Verify Edge Functions

Deploy all functions to ensure they're live, then test a representative one (e.g., `scrape-rss`).

