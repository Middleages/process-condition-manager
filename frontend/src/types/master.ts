// ========== Line ==========
export interface Line {
  id: number
  line_code: string
  line_name: string
}

// ========== Product / Layer ==========
export interface LayerInfo {
  id: number
  layer_name: string
  step_seq: string
  layer_number: string
  sort_order: number
}

export interface ProductLayerInfo {
  id: number
  product_id: number
  layer_id: string
  layer: LayerInfo
  conditions: Record<string, unknown>
}

export interface Product {
  id: number
  product_name: string
  description: string | null
  line_id: number | null
  part_id: string | null
}

export interface ProductDetail extends Product {
  layers: ProductLayerInfo[]
}

// ========== Backbone-specific types (dynamic backbone API) ==========

// Returned by GET /api/products/backbones - product enriched with Approved project metadata
// Backbone eligibility is determined dynamically by Approved project existence
export interface BackboneProduct extends Product {
  revision: number
  approved_at: string | null
}

// Returned by GET /api/products/{id}/backbone-layers - layers from the Approved project
export interface BackboneLayer {
  id: number
  layer_id: string
  layer_name: string
  step_seq: string
  conditions: Record<string, unknown>
  backbone_conditions: Record<string, unknown>
  sort_order: number
}
