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
  layer_id: number
  layer: LayerInfo
  conditions: Record<string, unknown>
}

export interface Product {
  id: number
  product_name: string
  description: string | null
  is_backbone: boolean
  line_id: number | null
  part_id: string | null
}

export interface ProductDetail extends Product {
  layers: ProductLayerInfo[]
}
