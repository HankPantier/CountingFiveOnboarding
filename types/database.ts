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
      admins: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          name: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      assets: {
        Row: {
          asset_category: string | null
          file_name: string
          file_size_bytes: number | null
          id: string
          metadata: Json | null
          mime_type: string
          public_url: string | null
          session_id: string
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          asset_category?: string | null
          file_name: string
          file_size_bytes?: number | null
          id?: string
          metadata?: Json | null
          mime_type: string
          public_url: string | null
          session_id: string
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          asset_category?: string | null
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          metadata?: Json | null
          mime_type?: string
          public_url?: string
          session_id?: string
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      basecamp_tokens: {
        Row: {
          access_token: string
          expires_at: string
          id: number
          refresh_token: string
          updated_at: string
        }
        Insert: {
          access_token: string
          expires_at: string
          id?: number
          refresh_token: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          expires_at?: string
          id?: number
          refresh_token?: string
          updated_at?: string
        }
        Relationships: []
      }
      content_jobs: {
        Row: {
          confirmed_sitemap: Json | null
          created_at: string
          design_tokens: Json | null
          error_message: string | null
          github_repo: string | null
          id: string
          nav_config: Json | null
          palette: Json | null
          phase: number
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          confirmed_sitemap?: Json | null
          created_at?: string
          design_tokens?: Json | null
          error_message?: string | null
          github_repo?: string | null
          id?: string
          nav_config?: Json | null
          palette?: Json | null
          phase?: number
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          confirmed_sitemap?: Json | null
          created_at?: string
          design_tokens?: Json | null
          error_message?: string | null
          github_repo?: string | null
          id?: string
          nav_config?: Json | null
          palette?: Json | null
          phase?: number
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_jobs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_pages: {
        Row: {
          admin_approved_content: boolean
          answer_block: string | null
          canonical_url: string | null
          client_approved_content: boolean
          content_job_id: string
          content_markdown: string | null
          created_at: string
          eeat_signals: Json | null
          faq_block: Json | null
          generation_status: string
          hero_block: string
          hero_image: string | null
          hero_image_query: string | null
          hero_subhead: string | null
          hero_variant: string | null
          id: string
          internal_links: Json | null
          llm_citation_note: string | null
          meta_description: string | null
          meta_title: string | null
          needs_client_review: boolean
          page_title: string
          page_url: string
          schema_markup_type: string | null
          secondary_keywords: Json | null
          target_keyword: string | null
          url_slug: string | null
          word_count_actual: number | null
          word_count_target: number | null
        }
        Insert: {
          admin_approved_content?: boolean
          answer_block?: string | null
          canonical_url?: string | null
          client_approved_content?: boolean
          content_job_id: string
          content_markdown?: string | null
          created_at?: string
          eeat_signals?: Json | null
          faq_block?: Json | null
          generation_status?: string
          hero_block?: string
          hero_image?: string | null
          hero_image_query?: string | null
          hero_subhead?: string | null
          hero_variant?: string | null
          id?: string
          internal_links?: Json | null
          llm_citation_note?: string | null
          meta_description?: string | null
          meta_title?: string | null
          needs_client_review?: boolean
          page_title: string
          page_url: string
          schema_markup_type?: string | null
          secondary_keywords?: Json | null
          target_keyword?: string | null
          url_slug?: string | null
          word_count_actual?: number | null
          word_count_target?: number | null
        }
        Update: {
          admin_approved_content?: boolean
          answer_block?: string | null
          canonical_url?: string | null
          client_approved_content?: boolean
          content_job_id?: string
          content_markdown?: string | null
          created_at?: string
          eeat_signals?: Json | null
          faq_block?: Json | null
          generation_status?: string
          hero_block?: string
          hero_image?: string | null
          hero_image_query?: string | null
          hero_subhead?: string | null
          hero_variant?: string | null
          id?: string
          internal_links?: Json | null
          llm_citation_note?: string | null
          meta_description?: string | null
          meta_title?: string | null
          needs_client_review?: boolean
          page_title?: string
          page_url?: string
          schema_markup_type?: string | null
          secondary_keywords?: Json | null
          target_keyword?: string | null
          url_slug?: string | null
          word_count_actual?: number | null
          word_count_target?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_pages_content_job_id_fkey"
            columns: ["content_job_id"]
            isOneToOne: false
            referencedRelation: "content_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      page_outlines: {
        Row: {
          admin_approved: boolean
          admin_notes: string | null
          content_job_id: string
          created_at: string
          cta: Json | null
          h1: string | null
          id: string
          page_title: string
          page_url: string
          sections: Json | null
          target_keyword: string | null
          updated_at: string
        }
        Insert: {
          admin_approved?: boolean
          admin_notes?: string | null
          content_job_id: string
          created_at?: string
          cta?: Json | null
          h1?: string | null
          id?: string
          page_title: string
          page_url: string
          sections?: Json | null
          target_keyword?: string | null
          updated_at?: string
        }
        Update: {
          admin_approved?: boolean
          admin_notes?: string | null
          content_job_id?: string
          created_at?: string
          cta?: Json | null
          h1?: string | null
          id?: string
          page_title?: string
          page_url?: string
          sections?: Json | null
          target_keyword?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_outlines_content_job_id_fkey"
            columns: ["content_job_id"]
            isOneToOne: false
            referencedRelation: "content_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          days_inactive: number
          id: string
          sent_at: string
          session_id: string
        }
        Insert: {
          days_inactive: number
          id?: string
          sent_at?: string
          session_id: string
        }
        Update: {
          days_inactive?: number
          id?: string
          sent_at?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      research_results: {
        Row: {
          competitor_references: Json | null
          content_job_id: string
          created_at: string
          error_message: string | null
          existing_content: string | null
          id: string
          page_title: string
          page_url: string
          research_status: string
          secondary_keywords: Json | null
          target_keyword: string | null
          updated_at: string
        }
        Insert: {
          competitor_references?: Json | null
          content_job_id: string
          created_at?: string
          error_message?: string | null
          existing_content?: string | null
          id?: string
          page_title: string
          page_url: string
          research_status?: string
          secondary_keywords?: Json | null
          target_keyword?: string | null
          updated_at?: string
        }
        Update: {
          competitor_references?: Json | null
          content_job_id?: string
          created_at?: string
          error_message?: string | null
          existing_content?: string | null
          id?: string
          page_title?: string
          page_url?: string
          research_status?: string
          secondary_keywords?: Json | null
          target_keyword?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_results_content_job_id_fkey"
            columns: ["content_job_id"]
            isOneToOne: false
            referencedRelation: "content_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          basecamp_project_id: string | null
          client_email: string | null
          completed_at: string | null
          content_generation_phase: number | null
          content_generation_ready: boolean
          content_generation_started_at: string | null
          created_at: string
          current_phase: number
          gap_list: Json
          id: string
          last_activity_at: string
          mfp_content: string | null
          pdf_url: string | null
          processing: boolean
          reminder_count: number
          schema_data: Json
          status: string
          website_url: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          basecamp_project_id?: string | null
          client_email?: string | null
          completed_at?: string | null
          content_generation_phase?: number | null
          content_generation_ready?: boolean
          content_generation_started_at?: string | null
          created_at?: string
          current_phase?: number
          gap_list?: Json
          id?: string
          last_activity_at?: string
          mfp_content?: string | null
          pdf_url?: string | null
          processing?: boolean
          reminder_count?: number
          schema_data?: Json
          status?: string
          website_url: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          basecamp_project_id?: string | null
          client_email?: string | null
          completed_at?: string | null
          content_generation_phase?: number | null
          content_generation_ready?: boolean
          content_generation_started_at?: string | null
          created_at?: string
          current_phase?: number
          gap_list?: Json
          id?: string
          last_activity_at?: string
          mfp_content?: string | null
          pdf_url?: string | null
          processing?: boolean
          reminder_count?: number
          schema_data?: Json
          status?: string
          website_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
