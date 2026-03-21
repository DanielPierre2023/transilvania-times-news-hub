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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
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
          author_name: string | null
          category: string | null
          content_en: string | null
          content_ro: string | null
          cover_image: string | null
          created_at: string
          excerpt_en: string | null
          excerpt_ro: string | null
          id: string
          is_breaking: boolean | null
          published_at: string | null
          reading_time_min: number | null
          seo_description_en: string | null
          seo_description_ro: string | null
          seo_title_en: string | null
          seo_title_ro: string | null
          slug: string
          status: string
          subcategory: string | null
          summary_en: string | null
          summary_ro: string | null
          tags: string[] | null
          title_en: string
          title_ro: string | null
          updated_at: string
        }
        Insert: {
          author_name?: string | null
          category?: string | null
          content_en?: string | null
          content_ro?: string | null
          cover_image?: string | null
          created_at?: string
          excerpt_en?: string | null
          excerpt_ro?: string | null
          id?: string
          is_breaking?: boolean | null
          published_at?: string | null
          reading_time_min?: number | null
          seo_description_en?: string | null
          seo_description_ro?: string | null
          seo_title_en?: string | null
          seo_title_ro?: string | null
          slug: string
          status?: string
          subcategory?: string | null
          summary_en?: string | null
          summary_ro?: string | null
          tags?: string[] | null
          title_en: string
          title_ro?: string | null
          updated_at?: string
        }
        Update: {
          author_name?: string | null
          category?: string | null
          content_en?: string | null
          content_ro?: string | null
          cover_image?: string | null
          created_at?: string
          excerpt_en?: string | null
          excerpt_ro?: string | null
          id?: string
          is_breaking?: boolean | null
          published_at?: string | null
          reading_time_min?: number | null
          seo_description_en?: string | null
          seo_description_ro?: string | null
          seo_title_en?: string | null
          seo_title_ro?: string | null
          slug?: string
          status?: string
          subcategory?: string | null
          summary_en?: string | null
          summary_ro?: string | null
          tags?: string[] | null
          title_en?: string
          title_ro?: string | null
          updated_at?: string
        }
        Relationships: []
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
          created_at: string
          email: string
          id: string
          language: string | null
          name: string | null
          newsletter_subscribed: boolean | null
          notes: string | null
          source: string | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          language?: string | null
          name?: string | null
          newsletter_subscribed?: boolean | null
          notes?: string | null
          source?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          language?: string | null
          name?: string | null
          newsletter_subscribed?: boolean | null
          notes?: string | null
          source?: string | null
          tags?: string[] | null
          updated_at?: string
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
          confirmed: boolean
          created_at: string
          email: string
          id: string
          is_active: boolean
          language: string | null
          name: string | null
        }
        Insert: {
          confirmed?: boolean
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          language?: string | null
          name?: string | null
        }
        Update: {
          confirmed?: boolean
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          language?: string | null
          name?: string | null
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
          created_at: string
          id: string
          is_active: boolean
          last_scraped_at: string | null
          name: string
          source_language: string | null
          url: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_scraped_at?: string | null
          name: string
          source_language?: string | null
          url: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_scraped_at?: string | null
          name?: string
          source_language?: string | null
          url?: string
        }
        Relationships: []
      }
      scraped_articles: {
        Row: {
          ai_score: number | null
          category: string | null
          cover_image: string | null
          created_at: string
          excerpt_en: string | null
          excerpt_ro: string | null
          id: string
          last_rewrite_job_id: string | null
          original_content: string | null
          original_title: string
          original_url: string | null
          plagiarism_score: number | null
          quality_checked_at: string | null
          rewrite_error: string | null
          rewrite_finished_at: string | null
          rewrite_started_at: string | null
          rewrite_tags: string[] | null
          rewritten_content: string | null
          rewritten_en: string | null
          rewritten_ro: string | null
          seo_description_en: string | null
          seo_description_ro: string | null
          seo_title_en: string | null
          seo_title_ro: string | null
          source_id: string | null
          status: string
          subcategory: string | null
          summary_en: string | null
          summary_ro: string | null
          title_en: string | null
          title_ro: string | null
        }
        Insert: {
          ai_score?: number | null
          category?: string | null
          cover_image?: string | null
          created_at?: string
          excerpt_en?: string | null
          excerpt_ro?: string | null
          id?: string
          last_rewrite_job_id?: string | null
          original_content?: string | null
          original_title: string
          original_url?: string | null
          plagiarism_score?: number | null
          quality_checked_at?: string | null
          rewrite_error?: string | null
          rewrite_finished_at?: string | null
          rewrite_started_at?: string | null
          rewrite_tags?: string[] | null
          rewritten_content?: string | null
          rewritten_en?: string | null
          rewritten_ro?: string | null
          seo_description_en?: string | null
          seo_description_ro?: string | null
          seo_title_en?: string | null
          seo_title_ro?: string | null
          source_id?: string | null
          status?: string
          subcategory?: string | null
          summary_en?: string | null
          summary_ro?: string | null
          title_en?: string | null
          title_ro?: string | null
        }
        Update: {
          ai_score?: number | null
          category?: string | null
          cover_image?: string | null
          created_at?: string
          excerpt_en?: string | null
          excerpt_ro?: string | null
          id?: string
          last_rewrite_job_id?: string | null
          original_content?: string | null
          original_title?: string
          original_url?: string | null
          plagiarism_score?: number | null
          quality_checked_at?: string | null
          rewrite_error?: string | null
          rewrite_finished_at?: string | null
          rewrite_started_at?: string | null
          rewrite_tags?: string[] | null
          rewritten_content?: string | null
          rewritten_en?: string | null
          rewritten_ro?: string | null
          seo_description_en?: string | null
          seo_description_ro?: string | null
          seo_title_en?: string | null
          seo_title_ro?: string | null
          source_id?: string | null
          status?: string
          subcategory?: string | null
          summary_en?: string | null
          summary_ro?: string | null
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
          id: string
          page_path: string
          referrer: string | null
          session_duration: number | null
          session_id: string | null
          user_agent: string | null
        }
        Insert: {
          browser?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          device_type?: string | null
          id?: string
          page_path: string
          referrer?: string | null
          session_duration?: number | null
          session_id?: string | null
          user_agent?: string | null
        }
        Update: {
          browser?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          device_type?: string | null
          id?: string
          page_path?: string
          referrer?: string | null
          session_duration?: number | null
          session_id?: string | null
          user_agent?: string | null
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
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
