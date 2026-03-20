ALTER TABLE contacts ADD COLUMN IF NOT EXISTS language text DEFAULT 'en';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS newsletter_subscribed boolean DEFAULT false;