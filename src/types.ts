// Shared types for the SURDOC API.

/** A single museum object as returned by a /registro/{id} page. */
export interface SurdocRecord {
  /** Public registration number, e.g. "61-270". Doubles as the canonical id. */
  recordNumber: string;
  /** Internal inventory number(s) assigned by the museum, e.g. "17-278". */
  inventoryNumbers?: string;
  /** Primary object name / title (object type), e.g. "Pintura (obra visual)". */
  title?: string;
  /** Alternative name, e.g. "Pisapiés". */
  alternativeName?: string;
  /** Formal title(s) of the work, e.g. "El Ángelus, El Ángeluz". */
  titles?: string;
  /** Creator(s) with optional role and linked-data references. */
  creators?: Creator[];
  /** Owning institution name, e.g. "Museo Marítimo Nacional". */
  institution?: string;
  /** Top-level + second-level classification, e.g. "Historia - Utensilios...". */
  classification?: string;
  /** Broad category derived from the page: art | history | archaeology | unknown. */
  category?: ObjectCategory;
  /** Collection the object belongs to, e.g. "Herramientas y Equipos". */
  collection?: string;
  /** Archaeological culture, e.g. "Complejo Huentelauquén". */
  culturaArqueologica?: string;
  /** Time period, e.g. "Período Arcaico". */
  temporalidad?: string;
  /** Free-text dimensions, e.g. "Alto 7.2 cm - Ancho 68.3 cm - Profundidad 45.2 cm". */
  dimensions?: string;
  /** Technique/material pairs, each with optional Getty AAT thesaurus links. */
  techniqueMaterial?: TechniqueMaterial[];
  /** Physical description (Descripción). */
  description?: string;
  /** Conservation state, e.g. "Bueno". */
  conservationState?: string;
  /** Iconographic content description. */
  iconography?: string;
  /** Geographic area of origin or relevance, e.g. "Chile". */
  geographicArea?: string;
  /** Creation date or date range, e.g. "1990". */
  creationDate?: string;
  /** Current location, e.g. "En depósito". */
  location?: string;
  /** Transcribed inscriptions. */
  transcription?: string;
  /** History of ownership and use. */
  ownershipHistory?: string;
  /** History of the object itself. */
  objectHistory?: string;
  /** How the museum acquired it, e.g. "Donación". */
  ingressMode?: string;
  /** Ingress/acquisition date, e.g. "2005-05-17". */
  ingressDate?: string;
  /** Provenance (prior owner or origin), e.g. "Alberto Pérez Pfeifer". */
  provenance?: string;
  /** Registrar entries (name + date), e.g. "Marta Mitjans, 2014-09-03". */
  registrars?: string;
  /** Full-resolution image URLs (absolute). */
  images: string[];
  /** Canonical SURDOC page URL. */
  url: string;
}

export interface Creator {
  name?: string;
  role?: string;
  /** URL to artist profile (e.g. artistasvisualeschilenos.cl). */
  artistUrl?: string;
  /** Getty AAT link for the role term. */
  aat?: string;
}

export interface TechniqueMaterial {
  technique?: string;
  material?: string;
  /** Getty AAT (aatespanol.cl) links found in this row, for linked-data joins. */
  aat: string[];
}

export type ObjectCategory = "art" | "history" | "archaeology" | "unknown";

/** A lightweight result row from a /colecciones listing page. */
export interface SearchResult {
  recordNumber: string;
  title?: string;
  institution?: string;
  category?: ObjectCategory;
  /** Listing thumbnail (styled). */
  thumbnail?: string;
  url: string;
}

export interface SearchResponse {
  /** Total records matching the query across all pages (site-reported). */
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  results: SearchResult[];
}

/** A facet value: a filterable dimension like institution/material/technique. */
export interface FacetValue {
  /** Internal SURDOC id used in the f[]=facet:id query param. */
  id: string;
  label: string;
  count: number;
}

/** All facet groups available on the listing page, keyed by facet name. */
export type Facets = Record<string, FacetValue[]>;

/** Thrown when a record exists but is behind the login wall (not public). */
export class NotPublicError extends Error {
  constructor(recordNumber: string) {
    super(`Record ${recordNumber} is not public (login required)`);
    this.name = "NotPublicError";
  }
}
