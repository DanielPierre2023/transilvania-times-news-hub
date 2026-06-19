export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_inquiries: {
        Row: {
          id: string
          language: string
          recipient_email: string
          recipient_name: string
          sent_at: string | null
          slots_offered: string | null
        }
        Insert: {
          id?: string
          language?: string
          recipient_email: string
          recipient_name: string
          sent_at?: string | null
          slots_offered?: string | null
        }
        Update: {
          id?: string
          language?: string
          recipient_email?: string
          recipient_name?: string
          sent_at?: string | null
          slots_offered?: string | null
        }
        Relationships: []
      }
      ad_pricing: {
        Row: {
          format: string
          id: string
          label_en: string
          label_ro: string
          monthly_eur: number
          slot: string
          updated_at: string | null
          weekly_eur: number
          yearly_eur: number
        }
        Insert: {
          format: string
          id?: string
          label_en: string
          label_ro: string
          monthly_eur: number
          slot: string
          updated_at?: string | null
          weekly_eur: number
          yearly_eur: number
        }
        Update: {
          format?: string
          id?: string
          label_en?: string
          label_ro?: string
          monthly_eur?: number
          slot?: string
          updated_at?: string | null
          weekly_eur?: number
          yearly_eur?: number
        }
        Relationships: []
      }
      article_source_materials: {
        Row: {
          blog_post_id: string
          created_at: string
          id: string
          source_text: string | null
          source_title: string | null
          source_type: string
          source_url: string | null
          updated_at: string
        }
        Insert: {
          blog_post_id: string
          created_at?: string
          id?: string
          source_text?: string | null
          source_title?: string | null
          source_type?: string
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          blog_post_id?: string
          created_at?: string
          id?: string
          source_text?: string | null
          source_title?: string | null
          source_type?: string
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_source_materials_blog_post_id_fkey"
            columns: ["blog_post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      authors: {
        Row: {
          active: boolean | null
          avatar_style: string | null
          avatar_url: string | null
          bio_en: string
          bio_ro: string
          created_at: string | null
          editor_key: string | null
          email: string | null
          id: string
          name_en: string
          name_ro: string
          slug: string
          social_x: string | null
          specialties: string[] | null
          title_en: string
          title_ro: string
        }
        Insert: {
          active?: boolean | null
          avatar_style?: string | null
          avatar_url?: string | null
          bio_en: string
          bio_ro: string
          created_at?: string | null
          editor_key?: string | null
          email?: string | null
          id?: string
          name_en: string
          name_ro: string
          slug: string
          social_x?: string | null
          specialties?: string[] | null
          title_en: string
          title_ro: string
        }
        Update: {
          active?: boolean | null
          avatar_style?: string | null
          avatar_url?: string | null
          bio_en?: string
          bio_ro?: string
          created_at?: string | null
          editor_key?: string | null
          email?: string | null
          id?: string
          name_en?: string
          name_ro?: string
          slug?: string
          social_x?: string | null
          specialties?: string[] | null
          title_en?: string
          title_ro?: string
        }
        Relationships: []
      }
      automation_settings: {
        Row: {
          auto_publish: boolean
          id: number
          processor_enabled: boolean
          scraper_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_publish?: boolean
          id?: number
          processor_enabled?: boolean
          scraper_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_publish?: boolean
          id?: number
          processor_enabled?: boolean
          scraper_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      blog_comments: {
        Row: {
          ai_reply: string | null
          author_email: string | null
          author_name: string
          content: string
          created_at: string
          id: string
          post_id: string
          status: string
        }
        Insert: {
          ai_reply?: string | null
          author_email?: string | null
          author_name: string
          content: string
          created_at?: string
          id?: string
          post_id: string
          status?: string
        }
        Update: {
          ai_reply?: string | null
          author_email?: string | null
          author_name?: string
          content?: string
          created_at?: string
          id?: string
          post_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_posts: {
        Row: {
          ai_editor: string | null
          ai_quality_score: number | null
          ai_review_reason: string | null
          author_id: string | null
          author_name: string | null
          category: string | null
          content_archive: Json | null
          content_en: string | null
          content_ro: string | null
          county: string | null
          cover_image: string | null
          cover_image_credit: string | null
          created_at: string
          excerpt_en: string | null
          excerpt_ro: string | null
          id: string
          is_breaking: boolean | null
          last_viewed_at: string | null
          published_at: string | null
          reading_time_min: number | null
          scraped_article_id: string | null
          seo_description_en: string | null
          seo_description_ro: string | null
          seo_title_en: string | null
          seo_title_ro: string | null
          slug: string
          social_shares: Json | null
          source_url: string | null
          sources: string[] | null
          status: string
          subcategory: string | null
          summary_en: string | null
          summary_ro: string | null
          tags: string[] | null
          tags_en: string[] | null
          tags_ro: string[] | null
          title_en: string
          title_ro: string | null
          updated_at: string
          view_count: number
          word_count: number | null
        }
        Insert: {
          ai_editor?: string | null
          ai_quality_score?: number | null
          ai_review_reason?: string | null
          author_id?: string | null
          author_name?: string | null
          category?: string | null
          content_archive?: Json | null
          content_en?: string | null
          content_ro?: string | null
          county?: string | null
          cover_image?: string | null
          cover_image_credit?: string | null
          created_at?: string
          excerpt_en?: string | null
          excerpt_ro?: string | null
          id?: string
          is_breaking?: boolean | null
          last_viewed_at?: string | null
          published_at?: string | null
          reading_time_min?: number | null
          scraped_article_id?: string | null
          seo_description_en?: string | null
          seo_description_ro?: string | null
          seo_title_en?: string | null
          seo_title_ro?: string | null
          slug: string
          social_shares?: Json | null
          source_url?: string | null
          sources?: string[] | null
          status?: string
          subcategory?: string | null
          summary_en?: string | null
          summary_ro?: string | null
          tags?: string[] | null
          tags_en?: string[] | null
          tags_ro?: string[] | null
          title_en: string
          title_ro?: string | null
          updated_at?: string
          view_count?: number
          word_count?: number | null
        }
        Update: {
          ai_editor?: string | null
          ai_quality_score?: number | null
          ai_review_reason?: string | null
          author_id?: string | null
          author_name?: string | null
          category?: string | null
          content_archive?: Json | null
          content_en?: string | null
          content_ro?: string | null
          county?: string | null
          cover_image?: string | null
          cover_image_credit?: string | null
          created_at?: string
          excerpt_en?: string | null
          excerpt_ro?: string | null
          id?: string
          is_breaking?: boolean | null
          last_viewed_at?: string | null
          published_at?: string | null
          reading_time_min?: number | null
          scraped_article_id?: string | null
          seo_description_en?: string | null
          seo_description_ro?: string | null
          seo_title_en?: string | null
          seo_title_ro?: string | null
          slug?: string
          social_shares?: Json | null
          source_url?: string | null
          sources?: string[] | null
          status?: string
          subcategory?: string | null
          summary_en?: string | null
          summary_ro?: string | null
          tags?: string[] | null
          tags_en?: string[] | null
          tags_ro?: string[] | null
          title_en?: string
          title_ro?: string | null
          updated_at?: string
          view_count?: number
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "blog_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "authors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_posts_scraped_article_id_fkey"
            columns: ["scraped_article_id"]
            isOneToOne: false
            referencedRelation: "scraped_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_name: string
          content: string
          created_at: string | null
          id: string
          is_approved: boolean | null
          post_id: string
        }
        Insert: {
          author_name: string
          content: string
          created_at?: string | null
          id?: string
          is_approved?: boolean | null
          post_id: string
        }
        Update: {
          author_name?: string
          content?: string
          created_at?: string | null
          id?: string
          is_approved?: boolean | null
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          admin_reply: string | null
          created_at: string
          email: string
          id: string
          message: string
          name: string
          replied_at: string | null
          status: string
          subject: string | null
        }
        Insert: {
          admin_reply?: string | null
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          replied_at?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          admin_reply?: string | null
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          replied_at?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          company: string | null
          contact_type: string | null
          created_at: string
          email: string
          id: string
          language: string | null
          last_email_sent_at: string | null
          last_email_type: string | null
          name: string | null
          newsletter_subscribed: boolean | null
          notes: string | null
          phone: string | null
          source: string | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          company?: string | null
          contact_type?: string | null
          created_at?: string
          email: string
          id?: string
          language?: string | null
          last_email_sent_at?: string | null
          last_email_type?: string | null
          name?: string | null
          newsletter_subscribed?: boolean | null
          notes?: string | null
          phone?: string | null
          source?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          company?: string | null
          contact_type?: string | null
          created_at?: string
          email?: string
          id?: string
          language?: string | null
          last_email_sent_at?: string | null
          last_email_type?: string | null
          name?: string | null
          newsletter_subscribed?: boolean | null
          notes?: string | null
          phone?: string | null
          source?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      county_quotas: {
        Row: {
          active: boolean
          county: string
          created_at: string | null
          daily_limit: number
          priority: number
        }
        Insert: {
          active?: boolean
          county: string
          created_at?: string | null
          daily_limit?: number
          priority?: number
        }
        Update: {
          active?: boolean
          county?: string
          created_at?: string | null
          daily_limit?: number
          priority?: number
        }
        Relationships: []
      }
      generation_logs: {
        Row: {
          article_type: string | null
          brief_excerpt: string | null
          category: string | null
          created_at: string
          desk1_ms: number | null
          desk1_ok: boolean | null
          desk2a_ms: number | null
          desk2a_ok: boolean | null
          desk2b_en_ok: boolean | null
          desk2b_ms: number | null
          desk2b_ro_ok: boolean | null
          editor: string | null
          en_closer_swapped: boolean | null
          en_extended: boolean | null
          en_humanness: number | null
          en_polished: boolean | null
          en_title_swapped: boolean | null
          error_msg: string | null
          error_stage: string | null
          est_cost_usd: number | null
          id: string
          length_capped: boolean | null
          research_atoms_chars: number | null
          research_enriched: boolean | null
          ro_closer_swapped: boolean | null
          ro_extended: boolean | null
          ro_humanness: number | null
          ro_lang_ok: boolean | null
          ro_polished: boolean | null
          ro_retries: number | null
          ro_title_swapped: boolean | null
          status: string | null
          title_regen_en: boolean | null
          title_regen_ro: boolean | null
          total_ms: number | null
          word_count_effective: number | null
          word_count_req: number | null
          words_en: number | null
          words_ro: number | null
        }
        Insert: {
          article_type?: string | null
          brief_excerpt?: string | null
          category?: string | null
          created_at?: string
          desk1_ms?: number | null
          desk1_ok?: boolean | null
          desk2a_ms?: number | null
          desk2a_ok?: boolean | null
          desk2b_en_ok?: boolean | null
          desk2b_ms?: number | null
          desk2b_ro_ok?: boolean | null
          editor?: string | null
          en_closer_swapped?: boolean | null
          en_extended?: boolean | null
          en_humanness?: number | null
          en_polished?: boolean | null
          en_title_swapped?: boolean | null
          error_msg?: string | null
          error_stage?: string | null
          est_cost_usd?: number | null
          id?: string
          length_capped?: boolean | null
          research_atoms_chars?: number | null
          research_enriched?: boolean | null
          ro_closer_swapped?: boolean | null
          ro_extended?: boolean | null
          ro_humanness?: number | null
          ro_lang_ok?: boolean | null
          ro_polished?: boolean | null
          ro_retries?: number | null
          ro_title_swapped?: boolean | null
          status?: string | null
          title_regen_en?: boolean | null
          title_regen_ro?: boolean | null
          total_ms?: number | null
          word_count_effective?: number | null
          word_count_req?: number | null
          words_en?: number | null
          words_ro?: number | null
        }
        Update: {
          article_type?: string | null
          brief_excerpt?: string | null
          category?: string | null
          created_at?: string
          desk1_ms?: number | null
          desk1_ok?: boolean | null
          desk2a_ms?: number | null
          desk2a_ok?: boolean | null
          desk2b_en_ok?: boolean | null
          desk2b_ms?: number | null
          desk2b_ro_ok?: boolean | null
          editor?: string | null
          en_closer_swapped?: boolean | null
          en_extended?: boolean | null
          en_humanness?: number | null
          en_polished?: boolean | null
          en_title_swapped?: boolean | null
          error_msg?: string | null
          error_stage?: string | null
          est_cost_usd?: number | null
          id?: string
          length_capped?: boolean | null
          research_atoms_chars?: number | null
          research_enriched?: boolean | null
          ro_closer_swapped?: boolean | null
          ro_extended?: boolean | null
          ro_humanness?: number | null
          ro_lang_ok?: boolean | null
          ro_polished?: boolean | null
          ro_retries?: number | null
          ro_title_swapped?: boolean | null
          status?: string | null
          title_regen_en?: boolean | null
          title_regen_ro?: boolean | null
          total_ms?: number | null
          word_count_effective?: number | null
          word_count_req?: number | null
          words_en?: number | null
          words_ro?: number | null
        }
        Relationships: []
      }
      newsletter_campaigns: {
        Row: {
          content: string | null
          created_at: string
          id: string
          recipient_count: number | null
          sent_at: string | null
          status: string
          subject: string
          target_language: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          recipient_count?: number | null
          sent_at?: string | null
          status?: string
          subject: string
          target_language?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          recipient_count?: number | null
          sent_at?: string | null
          status?: string
          subject?: string
          target_language?: string | null
        }
        Relationships: []
      }
      newsletter_subscribers: {
        Row: {
          confirmation_sent_at: string | null
          confirmation_token: string | null
          confirmed: boolean
          confirmed_at: string | null
          created_at: string
          email: string
          id: string
          is_active: boolean
          language: string | null
          name: string | null
          unsubscribed_at: string | null
        }
        Insert: {
          confirmation_sent_at?: string | null
          confirmation_token?: string | null
          confirmed?: boolean
          confirmed_at?: string | null
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          language?: string | null
          name?: string | null
          unsubscribed_at?: string | null
        }
        Update: {
          confirmation_sent_at?: string | null
          confirmation_token?: string | null
          confirmed?: boolean
          confirmed_at?: string | null
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          language?: string | null
          name?: string | null
          unsubscribed_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      rewrite_jobs: {
        Row: {
          article_id: string | null
          created_at: string
          editor: string | null
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          max_retries: number | null
          result: string | null
          retry_count: number | null
          scraped_article_id: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          article_id?: string | null
          created_at?: string
          editor?: string | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          max_retries?: number | null
          result?: string | null
          retry_count?: number | null
          scraped_article_id?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          article_id?: string | null
          created_at?: string
          editor?: string | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          max_retries?: number | null
          result?: string | null
          retry_count?: number | null
          scraped_article_id?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rewrite_jobs_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "scraped_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rewrite_jobs_scraped_article_id_fkey"
            columns: ["scraped_article_id"]
            isOneToOne: false
            referencedRelation: "scraped_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      rss_sources: {
        Row: {
          category: string | null
          city_focus: string[] | null
          county: string | null
          created_at: string
          error_count: number | null
          error_message: string | null
          id: string
          is_active: boolean
          last_scraped_at: string | null
          name: string
          output_limit: number | null
          scope: string | null
          source_language: string | null
          source_type: string | null
          target_category: string | null
          url: string
        }
        Insert: {
          category?: string | null
          city_focus?: string[] | null
          county?: string | null
          created_at?: string
          error_count?: number | null
          error_message?: string | null
          id?: string
          is_active?: boolean
          last_scraped_at?: string | null
          name: string
          output_limit?: number | null
          scope?: string | null
          source_language?: string | null
          source_type?: string | null
          target_category?: string | null
          url: string
        }
        Update: {
          category?: string | null
          city_focus?: string[] | null
          county?: string | null
          created_at?: string
          error_count?: number | null
          error_message?: string | null
          id?: string
          is_active?: boolean
          last_scraped_at?: string | null
          name?: string
          output_limit?: number | null
          scope?: string | null
          source_language?: string | null
          source_type?: string | null
          target_category?: string | null
          url?: string
        }
        Relationships: []
      }
      scraped_articles: {
        Row: {
          ai_score: number | null
          assigned_editor: string | null
          category: string | null
          county: string | null
          cover_image: string | null
          created_at: string
          error_message: string | null
          excerpt_en: string | null
          excerpt_ro: string | null
          id: string
          is_used: boolean | null
          last_rewrite_job_id: string | null
          marked_for_deletion: boolean | null
          original_content: string | null
          original_content_full: string | null
          original_title: string
          original_url: string | null
          output_word_count: number | null
          plagiarism_score: number | null
          quality_checked_at: string | null
          rewrite_error: string | null
          rewrite_finished_at: string | null
          rewrite_started_at: string | null
          rewrite_tags: string[] | null
          rewrite_tags_en: string[] | null
          rewrite_tags_ro: string[] | null
          rewritten_content: string | null
          rewritten_en: string | null
          rewritten_ro: string | null
          scope: string | null
          seo_description_en: string | null
          seo_description_ro: string | null
          seo_title_en: string | null
          seo_title_ro: string | null
          sonnet_fallback_used: boolean | null
          source_id: string | null
          source_type: string | null
          source_word_count: number | null
          status: string
          subcategory: string | null
          summary_en: string | null
          summary_ro: string | null
          target_category: string | null
          title_en: string | null
          title_ro: string | null
        }
        Insert: {
          ai_score?: number | null
          assigned_editor?: string | null
          category?: string | null
          county?: string | null
          cover_image?: string | null
          created_at?: string
          error_message?: string | null
          excerpt_en?: string | null
          excerpt_ro?: string | null
          id?: string
          is_used?: boolean | null
          last_rewrite_job_id?: string | null
          marked_for_deletion?: boolean | null
          original_content?: string | null
          original_content_full?: string | null
          original_title: string
          original_url?: string | null
          output_word_count?: number | null
          plagiarism_score?: number | null
          quality_checked_at?: string | null
          rewrite_error?: string | null
          rewrite_finished_at?: string | null
          rewrite_started_at?: string | null
          rewrite_tags?: string[] | null
          rewrite_tags_en?: string[] | null
          rewrite_tags_ro?: string[] | null
          rewritten_content?: string | null
          rewritten_en?: string | null
          rewritten_ro?: string | null
          scope?: string | null
          seo_description_en?: string | null
          seo_description_ro?: string | null
          seo_title_en?: string | null
          seo_title_ro?: string | null
          sonnet_fallback_used?: boolean | null
          source_id?: string | null
          source_type?: string | null
          source_word_count?: number | null
          status?: string
          subcategory?: string | null
          summary_en?: string | null
          summary_ro?: string | null
          target_category?: string | null
          title_en?: string | null
          title_ro?: string | null
        }
        Update: {
          ai_score?: number | null
          assigned_editor?: string | null
          category?: string | null
          county?: string | null
          cover_image?: string | null
          created_at?: string
          error_message?: string | null
          excerpt_en?: string | null
          excerpt_ro?: string | null
          id?: string
          is_used?: boolean | null
          last_rewrite_job_id?: string | null
          marked_for_deletion?: boolean | null
          original_content?: string | null
          original_content_full?: string | null
          original_title?: string
          original_url?: string | null
          output_word_count?: number | null
          plagiarism_score?: number | null
          quality_checked_at?: string | null
          rewrite_error?: string | null
          rewrite_finished_at?: string | null
          rewrite_started_at?: string | null
          rewrite_tags?: string[] | null
          rewrite_tags_en?: string[] | null
          rewrite_tags_ro?: string[] | null
          rewritten_content?: string | null
          rewritten_en?: string | null
          rewritten_ro?: string | null
          scope?: string | null
          seo_description_en?: string | null
          seo_description_ro?: string | null
          seo_title_en?: string | null
          seo_title_ro?: string | null
          sonnet_fallback_used?: boolean | null
          source_id?: string | null
          source_type?: string | null
          source_word_count?: number | null
          status?: string
          subcategory?: string | null
          summary_en?: string | null
          summary_ro?: string | null
          target_category?: string | null
          title_en?: string | null
          title_ro?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scraped_articles_last_rewrite_job_id_fkey"
            columns: ["last_rewrite_job_id"]
            isOneToOne: false
            referencedRelation: "rewrite_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scraped_articles_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "rss_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      section_views: {
        Row: {
          created_at: string
          id: string
          page_path: string
          section_id: string
          view_duration: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          page_path: string
          section_id: string
          view_duration?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          page_path?: string
          section_id?: string
          view_duration?: number | null
        }
        Relationships: []
      }
      site_analytics: {
        Row: {
          browser: string | null
          city: string | null
          country: string | null
          created_at: string
          device_type: string | null
          event_type: string | null
          id: string
          is_bot: boolean | null
          page_path: string
          referrer: string | null
          screen_width: number | null
          session_duration: number | null
          session_id: string | null
          user_agent: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          visitor_id: string | null
        }
        Insert: {
          browser?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          device_type?: string | null
          event_type?: string | null
          id?: string
          is_bot?: boolean | null
          page_path: string
          referrer?: string | null
          screen_width?: number | null
          session_duration?: number | null
          session_id?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          visitor_id?: string | null
        }
        Update: {
          browser?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          device_type?: string | null
          event_type?: string | null
          id?: string
          is_bot?: boolean | null
          page_path?: string
          referrer?: string | null
          screen_width?: number | null
          session_duration?: number | null
          session_id?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: Json | null
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value?: Json | null
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: Json | null
        }
        Relationships: []
      }
      sponsor_banners: {
        Row: {
          accent_color: string
          advertiser_name: string
          bg_color: string
          body_en: string
          body_ro: string
          clicks: number
          contact_email: string | null
          created_at: string | null
          cta_en: string
          cta_ro: string
          end_date: string | null
          headline_en: string
          headline_ro: string
          id: string
          image_url: string | null
          impressions: number
          is_active: boolean
          slot: string
          start_date: string | null
          updated_at: string | null
          url: string
          weight: number
        }
        Insert: {
          accent_color?: string
          advertiser_name: string
          bg_color?: string
          body_en: string
          body_ro: string
          clicks?: number
          contact_email?: string | null
          created_at?: string | null
          cta_en?: string
          cta_ro?: string
          end_date?: string | null
          headline_en: string
          headline_ro: string
          id?: string
          image_url?: string | null
          impressions?: number
          is_active?: boolean
          slot?: string
          start_date?: string | null
          updated_at?: string | null
          url: string
          weight?: number
        }
        Update: {
          accent_color?: string
          advertiser_name?: string
          bg_color?: string
          body_en?: string
          body_ro?: string
          clicks?: number
          contact_email?: string | null
          created_at?: string | null
          cta_en?: string
          cta_ro?: string
          end_date?: string | null
          headline_en?: string
          headline_ro?: string
          id?: string
          image_url?: string | null
          impressions?: number
          is_active?: boolean
          slot?: string
          start_date?: string | null
          updated_at?: string | null
          url?: string
          weight?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      blog_comments_public: {
        Row: {
          ai_reply: string | null
          author_name: string | null
          content: string | null
          created_at: string | null
          id: string | null
          post_id: string | null
          status: string | null
        }
        Insert: {
          ai_reply?: string | null
          author_name?: string | null
          content?: string | null
          created_at?: string | null
          id?: string | null
          post_id?: string | null
          status?: string | null
        }
        Update: {
          ai_reply?: string | null
          author_name?: string | null
          content?: string | null
          created_at?: string | null
          id?: string | null
          post_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blog_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      public_site_stats: {
        Row: {
          views_24h: number | null
          views_30d: number | null
          views_7d: number | null
          views_total: number | null
          visitors_24h: number | null
          visitors_30d: number | null
          visitors_7d: number | null
          visitors_total: number | null
        }
        Relationships: []
      }
      public_top_pages: {
        Row: {
          page_path: string | null
          unique_visitors: number | null
          views: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      commit_scraper_blog_post: {
        Args: { p_blog_payload: Json; p_scraped_id: string; p_writeback: Json }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_banner_clicks: {
        Args: { banner_id: string }
        Returns: undefined
      }
      increment_banner_impressions: {
        Args: { banner_id: string }
        Returns: undefined
      }
      increment_view_count: { Args: { post_slug: string }; Returns: number }
      update_view_geo: {
        Args: { p_city?: string; p_country?: string; p_slug: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const