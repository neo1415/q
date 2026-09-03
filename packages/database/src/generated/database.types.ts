export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  audit: {
    Tables: {
      material_actions: {
        Row: {
          action_type: string
          actor_id: string | null
          actor_type: string
          authority_user_id: string | null
          correlation_id: string | null
          event_id: string
          id: number
          metadata: Json
          occurred_at: string
          organisation_id: string | null
          outcome: string
          relationship_id: string | null
          resource_id: string
          resource_type: string
          tenant_id: string
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          actor_type: string
          authority_user_id?: string | null
          correlation_id?: string | null
          event_id: string
          id?: number
          metadata?: Json
          occurred_at: string
          organisation_id?: string | null
          outcome: string
          relationship_id?: string | null
          resource_id: string
          resource_type: string
          tenant_id: string
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          actor_type?: string
          authority_user_id?: string | null
          correlation_id?: string | null
          event_id?: string
          id?: number
          metadata?: Json
          occurred_at?: string
          organisation_id?: string | null
          outcome?: string
          relationship_id?: string | null
          resource_id?: string
          resource_type?: string
          tenant_id?: string
        }
        Relationships: []
      }
      security_events: {
        Row: {
          correlation_id: string | null
          event_id: string
          event_type: string
          id: number
          ip_hash: string | null
          metadata: Json
          occurred_at: string
          resource_id: string | null
          resource_type: string | null
          severity: string
          tenant_id: string | null
          user_agent_hash: string | null
          user_id: string | null
        }
        Insert: {
          correlation_id?: string | null
          event_id: string
          event_type: string
          id?: number
          ip_hash?: string | null
          metadata?: Json
          occurred_at: string
          resource_id?: string | null
          resource_type?: string | null
          severity: string
          tenant_id?: string | null
          user_agent_hash?: string | null
          user_id?: string | null
        }
        Update: {
          correlation_id?: string | null
          event_id?: string
          event_type?: string
          id?: number
          ip_hash?: string | null
          metadata?: Json
          occurred_at?: string
          resource_id?: string | null
          resource_type?: string | null
          severity?: string
          tenant_id?: string | null
          user_agent_hash?: string | null
          user_id?: string | null
        }
        Relationships: []
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
  core: {
    Tables: {
      capital_objective_creation_requests: {
        Row: {
          capital_objective_id: string
          company_id: string
          created_at: string
          idempotency_key_hash: string
          request_hash: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          capital_objective_id: string
          company_id: string
          created_at?: string
          idempotency_key_hash: string
          request_hash: string
          tenant_id: string
          user_id: string
        }
        Update: {
          capital_objective_id?: string
          company_id?: string
          created_at?: string
          idempotency_key_hash?: string
          request_hash?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capital_objective_creation_re_capital_objective_id_tenant__fkey"
            columns: ["capital_objective_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "capital_objectives"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "capital_objective_creation_requests_company_id_tenant_id_fkey"
            columns: ["company_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      capital_objective_events: {
        Row: {
          actor_id: string
          actor_type: string
          capital_objective_id: string
          event_type: string
          id: string
          occurred_at: string
          payload: Json
          tenant_id: string
        }
        Insert: {
          actor_id: string
          actor_type: string
          capital_objective_id: string
          event_type: string
          id?: string
          occurred_at?: string
          payload: Json
          tenant_id: string
        }
        Update: {
          actor_id?: string
          actor_type?: string
          capital_objective_id?: string
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capital_objective_events_capital_objective_id_tenant_id_fkey"
            columns: ["capital_objective_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "capital_objectives"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      capital_objectives: {
        Row: {
          closed_at: string | null
          company_id: string
          created_at: string
          created_by_user_id: string
          currency_code: string
          id: string
          instrument_code: string | null
          objective_type: string
          started_at: string
          status: string
          target_amount: number
          target_close_date: string | null
          target_stage: string | null
          tenant_id: string
          updated_at: string
          use_of_funds_summary: string | null
          version: number
        }
        Insert: {
          closed_at?: string | null
          company_id: string
          created_at?: string
          created_by_user_id: string
          currency_code: string
          id?: string
          instrument_code?: string | null
          objective_type?: string
          started_at?: string
          status?: string
          target_amount: number
          target_close_date?: string | null
          target_stage?: string | null
          tenant_id: string
          updated_at?: string
          use_of_funds_summary?: string | null
          version?: number
        }
        Update: {
          closed_at?: string | null
          company_id?: string
          created_at?: string
          created_by_user_id?: string
          currency_code?: string
          id?: string
          instrument_code?: string | null
          objective_type?: string
          started_at?: string
          status?: string
          target_amount?: number
          target_close_date?: string | null
          target_stage?: string | null
          tenant_id?: string
          updated_at?: string
          use_of_funds_summary?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "capital_objectives_company_id_tenant_id_fkey"
            columns: ["company_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      companies: {
        Row: {
          canonical_name: string
          company_status: string
          created_at: string
          current_stage_code: string | null
          founded_date: string | null
          headquarters_city: string | null
          headquarters_country: string | null
          id: string
          legal_name: string | null
          logo_storage_key: string | null
          marketplace_readiness_state: string
          marketplace_visibility: string
          organisation_id: string
          primary_description: string | null
          short_description: string | null
          slug: string
          tenant_id: string
          updated_at: string
          version: number
          website_url: string | null
        }
        Insert: {
          canonical_name: string
          company_status?: string
          created_at?: string
          current_stage_code?: string | null
          founded_date?: string | null
          headquarters_city?: string | null
          headquarters_country?: string | null
          id?: string
          legal_name?: string | null
          logo_storage_key?: string | null
          marketplace_readiness_state?: string
          marketplace_visibility?: string
          organisation_id: string
          primary_description?: string | null
          short_description?: string | null
          slug: string
          tenant_id: string
          updated_at?: string
          version?: number
          website_url?: string | null
        }
        Update: {
          canonical_name?: string
          company_status?: string
          created_at?: string
          current_stage_code?: string | null
          founded_date?: string | null
          headquarters_city?: string | null
          headquarters_country?: string | null
          id?: string
          legal_name?: string | null
          logo_storage_key?: string | null
          marketplace_readiness_state?: string
          marketplace_visibility?: string
          organisation_id?: string
          primary_description?: string | null
          short_description?: string | null
          slug?: string
          tenant_id?: string
          updated_at?: string
          version?: number
          website_url?: string | null
        }
        Relationships: []
      }
      company_creation_requests: {
        Row: {
          company_id: string
          created_at: string
          idempotency_key_hash: string
          organisation_id: string
          request_hash: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          idempotency_key_hash: string
          organisation_id: string
          request_hash: string
          tenant_id: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          idempotency_key_hash?: string
          organisation_id?: string
          request_hash?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_creation_requests_company_id_tenant_id_fkey"
            columns: ["company_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      company_members: {
        Row: {
          business_title: string | null
          company_id: string
          created_at: string
          ended_at: string | null
          id: string
          is_current: boolean
          is_founder: boolean
          relationship_type: string
          started_at: string
          tenant_id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          business_title?: string | null
          company_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          is_current?: boolean
          is_founder?: boolean
          relationship_type?: string
          started_at?: string
          tenant_id: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          business_title?: string | null
          company_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          is_current?: boolean
          is_founder?: boolean
          relationship_type?: string
          started_at?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_tenant_id_fkey"
            columns: ["company_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      company_team_facts: {
        Row: {
          company_id: string
          created_at: string
          founder_count: number | null
          full_time_founder_count: number | null
          id: string
          team_size: number | null
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          company_id: string
          created_at?: string
          founder_count?: number | null
          full_time_founder_count?: number | null
          id?: string
          team_size?: number | null
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          founder_count?: number | null
          full_time_founder_count?: number | null
          id?: string
          team_size?: number | null
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_team_facts_company_id_tenant_id_fkey"
            columns: ["company_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      founder_profiles: {
        Row: {
          background_summary: string | null
          created_at: string
          id: string
          primary_company_id: string | null
          professional_summary: string | null
          tenant_id: string
          updated_at: string
          user_id: string
          version: number
          visibility_scope: string
        }
        Insert: {
          background_summary?: string | null
          created_at?: string
          id?: string
          primary_company_id?: string | null
          professional_summary?: string | null
          tenant_id: string
          updated_at?: string
          user_id: string
          version?: number
          visibility_scope?: string
        }
        Update: {
          background_summary?: string | null
          created_at?: string
          id?: string
          primary_company_id?: string | null
          professional_summary?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
          version?: number
          visibility_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "founder_profiles_primary_company_id_tenant_id_fkey"
            columns: ["primary_company_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      investor_creation_requests: {
        Row: {
          created_at: string
          idempotency_key_hash: string
          investor_organisation_id: string
          organisation_id: string
          request_hash: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          idempotency_key_hash: string
          investor_organisation_id: string
          organisation_id: string
          request_hash: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          idempotency_key_hash?: string
          investor_organisation_id?: string
          organisation_id?: string
          request_hash?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investor_creation_requests_investor_organisation_id_tenant_fkey"
            columns: ["investor_organisation_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "investor_organisations"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      investor_mandate_constraints: {
        Row: {
          created_at: string
          dimension: string
          id: string
          importance: string
          is_hard_exclusion: boolean
          mandate_id: string
          operator: string
          tenant_id: string
          value_jsonb: Json
        }
        Insert: {
          created_at?: string
          dimension: string
          id?: string
          importance: string
          is_hard_exclusion?: boolean
          mandate_id: string
          operator: string
          tenant_id: string
          value_jsonb: Json
        }
        Update: {
          created_at?: string
          dimension?: string
          id?: string
          importance?: string
          is_hard_exclusion?: boolean
          mandate_id?: string
          operator?: string
          tenant_id?: string
          value_jsonb?: Json
        }
        Relationships: [
          {
            foreignKeyName: "investor_mandate_constraints_mandate_id_tenant_id_fkey"
            columns: ["mandate_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "investor_mandates"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      investor_mandate_creation_requests: {
        Row: {
          created_at: string
          idempotency_key_hash: string
          investor_organisation_id: string
          mandate_id: string
          request_hash: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          idempotency_key_hash: string
          investor_organisation_id: string
          mandate_id: string
          request_hash: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          idempotency_key_hash?: string
          investor_organisation_id?: string
          mandate_id?: string
          request_hash?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investor_mandate_creation_req_investor_organisation_id_ten_fkey"
            columns: ["investor_organisation_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "investor_organisations"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "investor_mandate_creation_requests_mandate_id_tenant_id_fkey"
            columns: ["mandate_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "investor_mandates"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      investor_mandates: {
        Row: {
          created_at: string
          created_by_user_id: string
          currency_code: string | null
          discovery_mode: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          investor_organisation_id: string
          max_cheque: number | null
          max_stage_code: string | null
          min_cheque: number | null
          min_stage_code: string | null
          name: string
          raw_mandate_text: string | null
          status: string
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          currency_code?: string | null
          discovery_mode?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          investor_organisation_id: string
          max_cheque?: number | null
          max_stage_code?: string | null
          min_cheque?: number | null
          min_stage_code?: string | null
          name: string
          raw_mandate_text?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          currency_code?: string | null
          discovery_mode?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          investor_organisation_id?: string
          max_cheque?: number | null
          max_stage_code?: string | null
          min_cheque?: number | null
          min_stage_code?: string | null
          name?: string
          raw_mandate_text?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "investor_mandates_investor_organisation_id_tenant_id_fkey"
            columns: ["investor_organisation_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "investor_organisations"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      investor_organisations: {
        Row: {
          created_at: string
          deployment_state: string | null
          display_name: string
          hq_country: string | null
          id: string
          investor_type: string
          organisation_id: string
          public_description: string | null
          tenant_id: string
          updated_at: string
          verification_state: string
          version: number
          website_url: string | null
        }
        Insert: {
          created_at?: string
          deployment_state?: string | null
          display_name: string
          hq_country?: string | null
          id?: string
          investor_type: string
          organisation_id: string
          public_description?: string | null
          tenant_id: string
          updated_at?: string
          verification_state?: string
          version?: number
          website_url?: string | null
        }
        Update: {
          created_at?: string
          deployment_state?: string | null
          display_name?: string
          hq_country?: string | null
          id?: string
          investor_type?: string
          organisation_id?: string
          public_description?: string | null
          tenant_id?: string
          updated_at?: string
          verification_state?: string
          version?: number
          website_url?: string | null
        }
        Relationships: []
      }
      investor_representatives: {
        Row: {
          business_title: string | null
          created_at: string
          ended_at: string | null
          id: string
          investor_organisation_id: string
          is_current: boolean
          membership_id: string
          organisation_id: string
          started_at: string
          tenant_id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          business_title?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          investor_organisation_id: string
          is_current?: boolean
          membership_id: string
          organisation_id: string
          started_at?: string
          tenant_id: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          business_title?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          investor_organisation_id?: string
          is_current?: boolean
          membership_id?: string
          organisation_id?: string
          started_at?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "investor_representatives_investor_organisation_id_organisa_fkey"
            columns: [
              "investor_organisation_id",
              "organisation_id",
              "tenant_id",
            ]
            isOneToOne: false
            referencedRelation: "investor_organisations"
            referencedColumns: ["id", "organisation_id", "tenant_id"]
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
  events: {
    Tables: {
      outbox: {
        Row: {
          attempt_count: number
          available_at: string
          created_at: string
          event_id: string
          event_type: string
          event_version: number
          id: number
          last_error: string | null
          payload: Json
          published_at: string | null
          tenant_id: string | null
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          created_at?: string
          event_id: string
          event_type: string
          event_version: number
          id?: never
          last_error?: string | null
          payload: Json
          published_at?: string | null
          tenant_id?: string | null
        }
        Update: {
          attempt_count?: number
          available_at?: string
          created_at?: string
          event_id?: string
          event_type?: string
          event_version?: number
          id?: never
          last_error?: string | null
          payload?: Json
          published_at?: string | null
          tenant_id?: string | null
        }
        Relationships: []
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
  identity: {
    Tables: {
      membership_roles: {
        Row: {
          created_at: string
          id: string
          membership_id: string
          role_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          membership_id: string
          role_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          membership_id?: string
          role_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_roles_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_creation_requests: {
        Row: {
          created_at: string
          idempotency_key_hash: string
          organisation_id: string
          request_hash: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          idempotency_key_hash: string
          organisation_id: string
          request_hash: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          idempotency_key_hash?: string
          organisation_id?: string
          request_hash?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_creation_requests_organisation_id_tenant_id_fkey"
            columns: ["organisation_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "organisation_creation_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_memberships: {
        Row: {
          created_at: string
          id: string
          invited_by_user_id: string | null
          joined_at: string
          left_at: string | null
          membership_status: string
          metadata: Json
          organisation_id: string
          primary_business_title: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by_user_id?: string | null
          joined_at?: string
          left_at?: string | null
          membership_status?: string
          metadata?: Json
          organisation_id: string
          primary_business_title?: string | null
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by_user_id?: string | null
          joined_at?: string
          left_at?: string | null
          membership_status?: string
          metadata?: Json
          organisation_id?: string
          primary_business_title?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_memberships_invited_by_user_id_fkey"
            columns: ["invited_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_memberships_organisation_id_tenant_id_fkey"
            columns: ["organisation_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "organisation_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          country_code: string | null
          created_at: string
          display_name: string
          id: string
          jurisdiction_code: string | null
          legal_name: string | null
          organisation_type: string
          slug: string
          status: string
          tenant_id: string
          updated_at: string
          version: number
          website_url: string | null
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          display_name: string
          id?: string
          jurisdiction_code?: string | null
          legal_name?: string | null
          organisation_type: string
          slug: string
          status?: string
          tenant_id: string
          updated_at?: string
          version?: number
          website_url?: string | null
        }
        Update: {
          country_code?: string | null
          created_at?: string
          display_name?: string
          id?: string
          jurisdiction_code?: string | null
          legal_name?: string | null
          organisation_type?: string
          slug?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          version?: number
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organisations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_organisations: {
        Row: {
          created_at: string
          organisation_id: string
          relationship_type: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          organisation_id: string
          relationship_type?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          organisation_id?: string
          relationship_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_organisations_organisation_id_tenant_id_fkey"
            columns: ["organisation_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "tenant_organisations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          data_policy_id: string | null
          default_region: string | null
          id: string
          name: string
          plan_code: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_policy_id?: string | null
          default_region?: string | null
          id?: string
          name: string
          plan_code?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_policy_id?: string | null
          default_region?: string | null
          id?: string
          name?: string
          plan_code?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_active_contexts: {
        Row: {
          membership_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          membership_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          membership_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_active_contexts_membership_id_user_id_fkey"
            columns: ["membership_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organisation_memberships"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "user_active_contexts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          auth_user_id: string
          avatar_storage_key: string | null
          country_code: string | null
          created_at: string
          display_name: string | null
          family_name: string | null
          given_name: string | null
          headline: string | null
          id: string
          primary_locale: string | null
          status: string
          timezone: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          avatar_storage_key?: string | null
          country_code?: string | null
          created_at?: string
          display_name?: string | null
          family_name?: string | null
          given_name?: string | null
          headline?: string | null
          id?: string
          primary_locale?: string | null
          status?: string
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          avatar_storage_key?: string | null
          country_code?: string | null
          created_at?: string
          display_name?: string | null
          family_name?: string | null
          given_name?: string | null
          headline?: string | null
          id?: string
          primary_locale?: string | null
          status?: string
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
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
  network: {
    Tables: {
      relationship_events: {
        Row: {
          actor_id: string
          actor_type: string
          correlation_id: string
          created_at: string
          event_type: string
          id: string
          occurred_at: string
          payload: Json
          relationship_id: string
          sequence: number
          source_id: string | null
          source_type: string
          tenant_id: string
          visibility_scope: string
        }
        Insert: {
          actor_id: string
          actor_type: string
          correlation_id: string
          created_at?: string
          event_type: string
          id?: string
          occurred_at?: string
          payload?: Json
          relationship_id: string
          sequence: number
          source_id?: string | null
          source_type: string
          tenant_id: string
          visibility_scope: string
        }
        Update: {
          actor_id?: string
          actor_type?: string
          correlation_id?: string
          created_at?: string
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json
          relationship_id?: string
          sequence?: number
          source_id?: string | null
          source_type?: string
          tenant_id?: string
          visibility_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "relationship_events_relationship_id_tenant_id_fkey"
            columns: ["relationship_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "relationships"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      relationships: {
        Row: {
          company_id: string
          created_at: string
          current_state: string
          first_discovered_at: string
          id: string
          investor_organisation_id: string
          last_event_sequence: number
          state_updated_at: string
          tenant_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          current_state?: string
          first_discovered_at?: string
          id?: string
          investor_organisation_id: string
          last_event_sequence?: number
          state_updated_at?: string
          tenant_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          current_state?: string
          first_discovered_at?: string
          id?: string
          investor_organisation_id?: string
          last_event_sequence?: number
          state_updated_at?: string
          tenant_id?: string
        }
        Relationships: []
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
  permissions: {
    Tables: {
      capabilities: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      grants: {
        Row: {
          capability_id: string
          created_at: string
          effect: string
          granted_by_user_id: string | null
          id: string
          principal_id: string
          principal_type: string
          resource_id: string | null
          resource_type: string | null
          revoked_at: string | null
          scope: Json
          tenant_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          capability_id: string
          created_at?: string
          effect: string
          granted_by_user_id?: string | null
          id?: string
          principal_id: string
          principal_type: string
          resource_id?: string | null
          resource_type?: string | null
          revoked_at?: string | null
          scope: Json
          tenant_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          capability_id?: string
          created_at?: string
          effect?: string
          granted_by_user_id?: string | null
          id?: string
          principal_id?: string
          principal_type?: string
          resource_id?: string | null
          resource_type?: string | null
          revoked_at?: string | null
          scope?: Json
          tenant_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grants_capability_id_fkey"
            columns: ["capability_id"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      role_capabilities: {
        Row: {
          capability_id: string
          created_at: string
          default_scope: Json | null
          effect: string
          role_id: string
        }
        Insert: {
          capability_id: string
          created_at?: string
          default_scope?: Json | null
          effect: string
          role_id: string
        }
        Update: {
          capability_id?: string
          created_at?: string
          default_scope?: Json | null
          effect?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_capabilities_capability_id_fkey"
            columns: ["capability_id"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_capabilities_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
          scope_type: string
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          scope_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          scope_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
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
  audit: {
    Enums: {},
  },
  core: {
    Enums: {},
  },
  events: {
    Enums: {},
  },
  identity: {
    Enums: {},
  },
  network: {
    Enums: {},
  },
  permissions: {
    Enums: {},
  },
} as const

