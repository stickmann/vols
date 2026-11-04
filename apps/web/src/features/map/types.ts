import type { LngLat, ObjectStatus, RouteKind, SiteKind } from "@vols/shared";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";

export interface SiteProps {
  id: string;
  kind: SiteKind;
  name: string | null;
  status: ObjectStatus;
  address: string | null;
  equipmentCount: number;
}

export interface RouteProps {
  id: string;
  kind: RouteKind;
  name: string | null;
  status: ObjectStatus;
  lengthM: number;
  fromSiteId: string;
  toSiteId: string;
  cableCount: number;
}

export interface CableSpanProps {
  id: string;
  cableId: string;
  name: string | null;
  status: ObjectStatus;
  typeName: string;
  fiberCount: number;
  lengthM: number;
}

export interface Network {
  sites: FeatureCollection<Point, SiteProps>;
  routes: FeatureCollection<LineString, RouteProps>;
  cables: FeatureCollection<LineString, CableSpanProps>;
}

export type SiteFeature = Feature<Point, SiteProps>;

export type Selection = { type: "site" | "route" | "cable"; id: string } | null;

/** Режимы работы с картой. */
export type Mode =
  | { kind: "select" }
  | { kind: "addSite"; siteKind: SiteKind; chain: boolean; routeKind: RouteKind; lastSiteId: string | null; lastSitePos: LngLat | null }
  | { kind: "drawRoute"; routeKind: RouteKind; fromSiteId: string | null; fromPos: LngLat | null; vertices: LngLat[] }
  | { kind: "layCable"; cableTypeId: string | null; siteIds: string[]; routeIds: string[]; history: { sites: number; routes: number }[] };

export interface SiteDetails {
  id: string;
  kind: SiteKind;
  name: string | null;
  address: string | null;
  status: ObjectStatus;
  notes: string | null;
  lng: number;
  lat: number;
  equipment: {
    id: string;
    kind: string;
    name: string | null;
    status: ObjectStatus;
    parentId: string | null;
    modelName: string;
    modelId: string;
    ports: number;
  }[];
  cables: { id: string; name: string | null; typeName: string; role: "end" | "pass" }[];
}

export interface RouteDetails {
  id: string;
  kind: RouteKind;
  name: string | null;
  status: ObjectStatus;
  notes: string | null;
  lengthM: number;
  fromSiteId: string;
  toSiteId: string;
  fromName: string | null;
  fromKind: SiteKind;
  toName: string | null;
  toKind: SiteKind;
  cables: { id: string; name: string | null; typeName: string }[];
}

export interface CableDetails {
  id: string;
  name: string | null;
  status: ObjectStatus;
  notes: string | null;
  cableTypeId: string;
  typeName: string;
  fiberCount: number;
  connections: number;
  spans: {
    id: string;
    seq: number;
    fromSiteId: string;
    fromSiteName: string | null;
    fromSiteKind: SiteKind;
    toSiteId: string;
    toSiteName: string | null;
    toSiteKind: SiteKind;
    fromEquipmentId: string | null;
    fromEquipmentName: string | null;
    toEquipmentId: string | null;
    toEquipmentName: string | null;
    routeLengthM: number;
    slackM: number;
    routeIds: string[];
  }[];
}
