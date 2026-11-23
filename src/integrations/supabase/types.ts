export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      categories: {
        Row: {
          id: string;
          name: string;
          sort: number;
        };
        Insert: {
          id?: string;
          name: string;
          sort?: number;
        };
        Update: {
          id?: string;
          name?: string;
          sort?: number;
        };
        Relationships: [];
      };
      inventory_adjustments: {
        Row: {
          created_at: string;
          id: string;
          new_stock: number;
          previous_stock: number;
          product_id: string | null;
          product_name: string;
          quantity_delta: number;
          reason: string;
          user_email: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          new_stock: number;
          previous_stock: number;
          product_id?: string | null;
          product_name: string;
          quantity_delta: number;
          reason: string;
          user_email?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          new_stock?: number;
          previous_stock?: number;
          product_id?: string | null;
          product_name?: string;
          quantity_delta?: number;
          reason?: string;
          user_email?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_adjustments_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_stock_audit: {
        Row: {
          adjustment_id: string | null;
          created_at: string;
          id: number;
          movement_id: string | null;
          new_stock: number;
          previous_stock: number;
          product_id: string | null;
          product_name: string;
          reason: string;
          transaction_id: number;
          user_email: string | null;
          user_id: string | null;
        };
        Insert: {
          adjustment_id?: string | null;
          created_at?: string;
          id?: number;
          movement_id?: string | null;
          new_stock: number;
          previous_stock: number;
          product_id?: string | null;
          product_name: string;
          reason: string;
          transaction_id: number;
          user_email?: string | null;
          user_id?: string | null;
        };
        Update: {
          adjustment_id?: string | null;
          created_at?: string;
          id?: number;
          movement_id?: string | null;
          new_stock?: number;
          previous_stock?: number;
          product_id?: string | null;
          product_name?: string;
          reason?: string;
          transaction_id?: number;
          user_email?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_stock_audit_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      lots: {
        Row: {
          expires_at: string | null;
          id: string;
          note: string | null;
          product_id: string;
          qty: number;
          qty_initial: number;
          received_at: string;
        };
        Insert: {
          expires_at?: string | null;
          id?: string;
          note?: string | null;
          product_id: string;
          qty?: number;
          qty_initial?: number;
          received_at?: string;
        };
        Update: {
          expires_at?: string | null;
          id?: string;
          note?: string | null;
          product_id?: string;
          qty?: number;
          qty_initial?: number;
          received_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lots_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      movements: {
        Row: {
          amount: number;
          cost_amount: number;
          discount_pct: number;
          id: string;
          lot_id: string | null;
          note: string | null;
          product_id: string | null;
          product_name: string;
          qty: number;
          sale_id: string | null;
          ts: string;
          type: Database["public"]["Enums"]["movement_type"];
          unit: Database["public"]["Enums"]["product_unit"];
          user_id: string | null;
        };
        Insert: {
          amount?: number;
          cost_amount?: number;
          discount_pct?: number;
          id?: string;
          lot_id?: string | null;
          note?: string | null;
          product_id?: string | null;
          product_name: string;
          qty: number;
          sale_id?: string | null;
          ts?: string;
          type: Database["public"]["Enums"]["movement_type"];
          unit: Database["public"]["Enums"]["product_unit"];
          user_id?: string | null;
        };
        Update: {
          amount?: number;
          cost_amount?: number;
          discount_pct?: number;
          id?: string;
          lot_id?: string | null;
          note?: string | null;
          product_id?: string | null;
          product_name?: string;
          qty?: number;
          sale_id?: string | null;
          ts?: string;
          type?: Database["public"]["Enums"]["movement_type"];
          unit?: Database["public"]["Enums"]["product_unit"];
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "movements_lot_id_fkey";
            columns: ["lot_id"];
            isOneToOne: false;
            referencedRelation: "lots";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "movements_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          active: boolean;
          category_id: string | null;
          code: string | null;
          cost: number;
          created_at: string;
          discount_pct: number;
          id: string;
          keyword: string | null;
          min_stock: number;
          name: string;
          nature: Database["public"]["Enums"]["product_nature"];
          price: number;
          stock: number;
          supplier: string | null;
          location: string | null;
          unit: Database["public"]["Enums"]["product_unit"];
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          category_id?: string | null;
          code?: string | null;
          cost?: number;
          created_at?: string;
          discount_pct?: number;
          id?: string;
          keyword?: string | null;
          min_stock?: number;
          name: string;
          nature?: Database["public"]["Enums"]["product_nature"];
          price?: number;
          stock?: number;
          supplier?: string | null;
          location?: string | null;
          unit?: Database["public"]["Enums"]["product_unit"];
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          category_id?: string | null;
          code?: string | null;
          cost?: number;
          created_at?: string;
          discount_pct?: number;
          id?: string;
          keyword?: string | null;
          min_stock?: number;
          name?: string;
          nature?: Database["public"]["Enums"]["product_nature"];
          price?: number;
          stock?: number;
          supplier?: string | null;
          location?: string | null;
          unit?: Database["public"]["Enums"]["product_unit"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      promotions: {
        Row: {
          active: boolean;
          bundle_price: number | null;
          bundle_qty: number | null;
          created_at: string;
          description: string | null;
          id: string;
          product_id: string;
          promo_price: number | null;
          promo_type: string;
          title: string;
        };
        Insert: {
          active?: boolean;
          bundle_price?: number | null;
          bundle_qty?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          product_id: string;
          promo_price?: number | null;
          promo_type: string;
          title: string;
        };
        Update: {
          active?: boolean;
          bundle_price?: number | null;
          bundle_qty?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          product_id?: string;
          promo_price?: number | null;
          promo_type?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "promotions_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_payments: {
        Row: {
          amount_received: number;
          change_amount: number;
          created_at: string;
          discount_amount: number;
          payment_method: string;
          sale_id: string;
          subtotal: number;
          total: number;
        };
        Insert: {
          amount_received: number;
          change_amount?: number;
          created_at?: string;
          discount_amount?: number;
          payment_method: string;
          sale_id: string;
          subtotal: number;
          total: number;
        };
        Update: {
          amount_received?: number;
          change_amount?: number;
          created_at?: string;
          discount_amount?: number;
          payment_method?: string;
          sale_id?: string;
          subtotal?: number;
          total?: number;
        };
        Relationships: [];
      };
      whatsapp_notifications: {
        Row: {
          attempts: number;
          created_at: string;
          dedupe_key: string;
          id: string;
          last_error: string | null;
          message: string;
          metadata: Json;
          notification_type: string;
          recipient: string;
          sent_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          dedupe_key: string;
          id?: string;
          last_error?: string | null;
          message: string;
          metadata?: Json;
          notification_type: string;
          recipient: string;
          sent_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          dedupe_key?: string;
          id?: string;
          last_error?: string | null;
          message?: string;
          metadata?: Json;
          notification_type?: string;
          recipient?: string;
          sent_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          is_active: boolean;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
        };
        Relationships: [];
      };
      activity_log: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          details: Json;
          id: number;
          target_user_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          id?: number;
          target_user_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          id?: number;
          target_user_id?: string | null;
        };
        Relationships: [];
      };
      role_permissions: {
        Row: {
          allowed: boolean;
          permission: string;
          role: Database["public"]["Enums"]["app_role"];
          updated_at: string;
        };
        Insert: {
          allowed?: boolean;
          permission: string;
          role: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Update: {
          allowed?: boolean;
          permission?: string;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          address: string;
          business_description: string;
          business_status: string;
          closing_time: string;
          city: string;
          currency: string;
          daily_report_enabled: boolean;
          daily_report_hour: number;
          id: number;
          last_report_on: string | null;
          opening_time: string;
          owner_whatsapp: string;
          inventory_alerts_enabled: boolean;
          expiry_alert_days: number;
          operating_days: string[];
          region: string;
          timezone: string;
          whatsapp_connected: boolean;
          whatsapp_last_check_at: string | null;
          whatsapp_last_error: string | null;
          whatsapp_notifications_enabled: boolean;
          store_name: string;
          updated_at: string;
        };
        Insert: {
          address?: string;
          business_description?: string;
          business_status?: string;
          closing_time?: string;
          city?: string;
          currency?: string;
          daily_report_enabled?: boolean;
          daily_report_hour?: number;
          id?: number;
          last_report_on?: string | null;
          opening_time?: string;
          owner_whatsapp?: string;
          inventory_alerts_enabled?: boolean;
          expiry_alert_days?: number;
          operating_days?: string[];
          region?: string;
          timezone?: string;
          whatsapp_connected?: boolean;
          whatsapp_last_check_at?: string | null;
          whatsapp_last_error?: string | null;
          whatsapp_notifications_enabled?: boolean;
          store_name?: string;
          updated_at?: string;
        };
        Update: {
          address?: string;
          business_description?: string;
          business_status?: string;
          closing_time?: string;
          city?: string;
          currency?: string;
          daily_report_enabled?: boolean;
          daily_report_hour?: number;
          id?: number;
          last_report_on?: string | null;
          opening_time?: string;
          owner_whatsapp?: string;
          inventory_alerts_enabled?: boolean;
          expiry_alert_days?: number;
          operating_days?: string[];
          region?: string;
          timezone?: string;
          whatsapp_connected?: boolean;
          whatsapp_last_check_at?: string | null;
          whatsapp_last_error?: string | null;
          whatsapp_notifications_enabled?: boolean;
          store_name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      adjust_inventory: {
        Args: {
          _product_id: string;
          _quantity_delta: number;
          _reason: string;
        };
        Returns: string;
      };
      ensure_profile: {
        Args: never;
        Returns: Database["public"]["Enums"]["app_role"];
      };
      admin_update_user: {
        Args: {
          _email: string;
          _full_name: string;
          _is_active: boolean;
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: undefined;
      };
      get_my_permissions: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      has_permission: {
        Args: {
          _permission: string;
          _user_id: string;
        };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      enqueue_whatsapp_expiry_alerts: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      claim_whatsapp_notifications: {
        Args: {
          _limit?: number;
          _notification_id?: string | null;
        };
        Returns: Database["public"]["Tables"]["whatsapp_notifications"]["Row"][];
      };
      register_entry: {
        Args: {
          _expires_at?: string;
          _note?: string;
          _product_id: string;
          _qty: number;
        };
        Returns: string;
      };
      register_manual_out: {
        Args: {
          _note: string;
          _product_id: string;
          _qty: number;
        };
        Returns: string;
      };
      register_return: {
        Args: {
          _amount: number;
          _note?: string;
          _product_id: string;
          _qty: number;
        };
        Returns: string;
      };
      register_supplier_return: {
        Args: {
          _note: string;
          _product_id: string;
          _qty: number;
        };
        Returns: string;
      };
      register_sale: {
        Args:
          | {
              _amount_received?: number | null;
              _discount_type?: string;
              _discount_value?: number;
              _items: Json;
              _note?: string | null;
              _payment_method?: string;
            }
          | { _items: Json; _note?: string | null }
          | { _amount: number; _product_id: string; _qty: number };
        Returns: string;
      };
      register_waste: {
        Args: { _lot_id: string; _note?: string; _qty: number };
        Returns: undefined;
      };
      set_expiry_discount: {
        Args: {
          _discount_pct: number;
          _product_id: string;
        };
        Returns: undefined;
      };
      set_user_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "cajero" | "consulta";
      movement_type:
        "in" | "out" | "merma" | "devolucion" | "devolucion_proveedor" | "salida_manual";
      product_nature: "consumible" | "empaque" | "herramienta" | "repuesto";
      product_unit: "unidad" | "kilo";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "cajero", "consulta"],
      movement_type: ["in", "out", "merma", "devolucion", "devolucion_proveedor", "salida_manual"],
      product_nature: ["consumible", "empaque", "herramienta", "repuesto"],
      product_unit: ["unidad", "kilo"],
    },
  },
} as const;
