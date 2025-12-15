export interface StructureSummary {
  logo:{
    url: string
  },
  claim_number?: string,
  insured_name?: string,
  address: string
}

export interface StructureData {
  structure_image:{
    url: string
  },
  roof_outline_image:{
    url: string
  },
  roof_perimeter_sqft: string,
  roof_area_sqs: string,
  roof_area_sqft: string,
  primary_pitch: string,
  notes?: string,
  annotations_table_data: Array<{
    "FACE": string,
    "SQ FT": string,
    "SQs": string,
    "Slope": string,
  }>,
  images: Array<string>
}

export interface ReportData {
  summary: StructureSummary,
  structures: Array<StructureData>
}