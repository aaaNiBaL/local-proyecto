export const PERMISSIONS = [
  { key: "dashboard", label: "Dashboard", description: "Consultar el resumen del negocio" },
  { key: "sales", label: "Ventas", description: "Vender productos y registrar devoluciones" },
  { key: "search", label: "Búsqueda", description: "Buscar productos" },
  {
    key: "inventory_view",
    label: "Ver inventario",
    description: "Consultar productos, existencias y lotes",
  },
  { key: "reports", label: "Reportes", description: "Consultar reportes de ventas y rendimiento" },
  {
    key: "movements_view",
    label: "Historial de movimientos",
    description: "Consultar entradas, salidas, mermas y ajustes",
  },
  {
    key: "products_manage",
    label: "Administrar productos",
    description: "Crear, editar y eliminar productos y categorías",
  },
  {
    key: "stock_manage",
    label: "Administrar existencias",
    description: "Registrar entradas, salidas manuales y devoluciones a proveedor",
  },
  {
    key: "expiry_manage",
    label: "Vencimientos y mermas",
    description: "Gestionar vencimientos, descuentos y mermas",
  },
  { key: "promotions_manage", label: "Promociones", description: "Crear y modificar promociones" },
  {
    key: "settings_manage",
    label: "Configuración del local",
    description: "Editar los datos del establecimiento",
  },
  { key: "user_manage", label: "Usuarios y roles", description: "Administrar usuarios y permisos" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];
export type PermissionRow = { role: string; permission: string; allowed: boolean };

export const ROLE_LABELS = {
  admin: "Administrador",
  cajero: "Cajero",
  consulta: "Consulta",
} as const;
