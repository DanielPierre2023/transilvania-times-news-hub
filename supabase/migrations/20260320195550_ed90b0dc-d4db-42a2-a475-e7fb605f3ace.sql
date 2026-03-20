-- Fix 1: Replace ALL policy on user_roles with granular policies
DROP POLICY IF EXISTS "Admins can manage roles" ON user_roles;

CREATE POLICY "Admins can read all roles" ON user_roles
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert roles" ON user_roles
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update roles" ON user_roles
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete roles" ON user_roles
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Fix 2: Secure blog_comments email exposure
DROP POLICY IF EXISTS "Public can read approved comments" ON blog_comments;

CREATE VIEW public.blog_comments_public
  WITH (security_barrier = true, security_invoker = on)
AS SELECT id, post_id, content, author_name, ai_reply, status, created_at
   FROM blog_comments
   WHERE status = 'approved';

GRANT SELECT ON public.blog_comments_public TO anon, authenticated;