
-- 1. Role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- 2. User roles table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- 3. Security definer function (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 4. RLS for user_roles
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can read own role" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 5. Profiles table
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "Admins read all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 6. Auto-create profile trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. Blog posts
CREATE TABLE public.blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text UNIQUE NOT NULL,
  content text,
  excerpt text,
  category text,
  author text,
  hero_image text,
  status text NOT NULL DEFAULT 'draft',
  language text DEFAULT 'en',
  seo_title text,
  seo_description text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Public can read published posts" ON public.blog_posts FOR SELECT TO anon, authenticated
  USING (status = 'published');
CREATE POLICY "Admins manage all posts" ON public.blog_posts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 8. Blog comments
CREATE TABLE public.blog_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES public.blog_posts(id) ON DELETE CASCADE NOT NULL,
  author_name text NOT NULL,
  author_email text,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  ai_reply text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Public can read approved comments" ON public.blog_comments FOR SELECT TO anon, authenticated
  USING (status = 'approved');
CREATE POLICY "Anyone can submit comments" ON public.blog_comments FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Admins manage comments" ON public.blog_comments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 9. Contact messages
CREATE TABLE public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  subject text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'unread',
  admin_reply text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Anyone can submit contact" ON public.contact_messages FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Admins manage contacts" ON public.contact_messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 10. Contacts (CRM)
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text,
  source text DEFAULT 'manual',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Admins manage contacts table" ON public.contacts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 11. Newsletter subscribers
CREATE TABLE public.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  confirmed boolean NOT NULL DEFAULT false,
  language text DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Anyone can subscribe" ON public.newsletter_subscribers FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Admins manage subscribers" ON public.newsletter_subscribers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 12. Sync subscriber to contacts trigger
CREATE OR REPLACE FUNCTION public.sync_subscriber_to_contacts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.contacts (email, name, source)
  VALUES (NEW.email, split_part(NEW.email, '@', 1), 'newsletter')
  ON CONFLICT (email) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_subscriber_created
  AFTER INSERT ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.sync_subscriber_to_contacts();

-- 13. Newsletter campaigns
CREATE TABLE public.newsletter_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  content text,
  status text NOT NULL DEFAULT 'draft',
  sent_at timestamptz,
  recipient_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Admins manage campaigns" ON public.newsletter_campaigns FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 14. Site analytics
CREATE TABLE public.site_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_path text NOT NULL,
  referrer text,
  user_agent text,
  country text,
  city text,
  device_type text,
  browser text,
  session_duration integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Anyone can insert analytics" ON public.site_analytics FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Admins read analytics" ON public.site_analytics FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 15. Section views
CREATE TABLE public.section_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_path text NOT NULL,
  section_id text NOT NULL,
  view_duration integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Anyone can insert section views" ON public.section_views FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Admins read section views" ON public.section_views FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 16. RSS sources
CREATE TABLE public.rss_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_scraped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Admins manage rss sources" ON public.rss_sources FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 17. Scraped articles
CREATE TABLE public.scraped_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.rss_sources(id) ON DELETE CASCADE,
  title text NOT NULL,
  original_url text,
  original_content text,
  rewritten_content text,
  status text NOT NULL DEFAULT 'scraped',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Admins manage scraped articles" ON public.scraped_articles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 18. Rewrite jobs
CREATE TABLE public.rewrite_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scraped_article_id uuid REFERENCES public.scraped_articles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE POLICY "Admins manage rewrite jobs" ON public.rewrite_jobs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 19. Chat conversations
CREATE TABLE public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_name text,
  visitor_email text,
  messages jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Anyone can create conversations" ON public.chat_conversations FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Admins manage conversations" ON public.chat_conversations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 20. Report requests
CREATE TABLE public.report_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  company text,
  report_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  report_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Anyone can submit report requests" ON public.report_requests FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Admins manage reports" ON public.report_requests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 21. Site settings
CREATE TABLE public.site_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Public can read settings" ON public.site_settings FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "Admins manage settings" ON public.site_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 22. Updated_at triggers
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.blog_posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.chat_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
