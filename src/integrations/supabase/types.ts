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
      categories: {
        Row: {
          id: string
          name: string
          sort: number
        }
        Insert: {
          id?: string
          name: string
          sort?: number
        }
        Update: {
          id?: string
          name?: string
          sort?: number
        }
        Relationships: []
      }
      lots: {
        Row: {
          expires_at: string | null
          id: string
          note: string | null
          product_id: string
          qty: number
          qty_initial: number
          received_at: string
        }
        Insert: {
          expires_at?: string | null
          id?: string
          note?: string | null
          product_id: string
          qty?: number
          qty_initial?: number
          received_at?: string
        }
        Update: {
          expires_at?: string | null
          id?: string
          note?: string | null
          product_id?: string
          qty?: number
          qty_initial?: number
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      movements: {
        Row: {
          amount: number
          cost_amount: number
          discount_pct: number
          id: string
          lot_id: string | null
          note: string | null
          product_id: string | null
          product_name: string
          qty: number
          ts: string
          type: Database["public"]["Enums"]["movement_type"]
          unit: Database["public"]["Enums"]["product_unit"]
          user_id: string | null
        }
        Insert: {
          amount?: number
          cost_amount?: number
          discount_pct?: number
          id?: string
          lot_id?: string | null
          note?: string | null
          product_id?: string | null
          product_name: string
          qty: number
          ts?: string
          type: Database["public"]["Enums"]["movement_type"]
          unit: Database["public"]["Enums"]["product_unit"]
          user_id?: string | null
        }
        Update: {
          amount?: number
          cost_amount?: number
          discount_pct?: number
          id?: string
          lot_id?: string | null
          note?: string | null
          product_id?: string | null
          product_name?: string
          qty?: number
          ts?: string
          type?: Database["public"]["Enums"]["movement_type"]
          unit?: Database["public"]["Enums"]["product_unit"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          category_id: string | null
          code: string | null
          cost: number
          created_at: string
          discount_pct: number
          id: string
          keyword: string | null
          min_stock: number
          name: string
          nature: Database["public"]["Enums"]["product_nature"]
          price: number
          stock: number
          unit: Database["public"]["Enums"]["product_unit"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          code?: string | null
          cost?: number
          created_at?: string
          discount_pct?: number
          id?: string
          keyword?: string | null
          min_stock?: number
          name: string
          nature?: Database["public"]["Enums"]["product_nature"]
          price?: number
          stock?: number
          unit?: Database["public"]["Enums"]["product_unit"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_id?: string | null
          code?: string | null
          cost?: number
          created_at?: string
          discount_pct?: number
          id?: string
          keyword?: string | null
          min_stock?: number
          name?: string
          nature?: Database["public"]["Enums"]["product_nature"]
          price?: number
          stock?: number
          unit?: Database["public"]["Enums"]["product_unit"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          address: string
          city: string
          daily_report_enabled: boolean
          daily_report_hour: number
          id: number
          last_report_on: string | null
          owner_whatsapp: string
          store_name: string
          updated_at: string
        }
        Insert: {
          address?: string
          city?: string
          daily_report_enabled?: boolean
          daily_report_hour?: number
          id?: number
          last_report_on?: string | null
          owner_whatsapp?: string
          store_name?: string
          updated_at?: string
        }
        Update: {
          address?: string
          city?: string
          daily_report_enabled?: boolean
          daily_report_hour?: number
          id?: number
          last_report_on?: string | null
          owner_whatsapp?: string
          store_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ensure_profile: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      register_entry: {
        Args: {
          _expires_at?: string
          _note?: string
          _product_id: string
          _qty: number
        }
        Returns: string
      }
      register_return: {
        Args: {
          _amount: number
          _note?: string
          _product_id: string
          _qty: number
        }
        Returns: string
      }
      register_sale: {
        Args: { _amount: number; _product_id: string; _qty: number }
        Returns: string
      }
      register_waste: {
        Args: { _lot_id: string; _note?: string; _qty: number }
        Returns: undefined
      }
      set_user_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "cajero"
      movement_type: "in" | "out" | "merma" | "devolucion"
      product_nature: "consumible" | "empaque" | "herramienta" | "repuesto"
      product_unit: "unidad" | "kilo"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "cajero"],
      movement_type: ["in", "out", "merma", "devolucion"],
      product_nature: ["consumible", "empaque", "herramienta", "repuesto"],
      product_unit: ["unidad", "kilo"],
    },
  },
} as const
