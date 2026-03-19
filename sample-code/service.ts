/**
 * Vendor service — handles business logic for vendor management.
 * Backend service that both AngularJS and React frontends call.
 */

export interface VendorDTO {
  id: string;
  name: string;
  region: string;
  serviceArea: {
    radius: number;
    center: { lat: number; lng: number };
  };
  rating: number;
  active: boolean;
}

export interface ServiceAreaQuery {
  lat: number;
  lng: number;
  maxDistance: number;
}

/** In-memory vendor store (would be a database in production) */
const vendors: VendorDTO[] = [
  {
    id: 'v1',
    name: 'Acme Logistics',
    region: 'north',
    serviceArea: { radius: 50, center: { lat: 40.7128, lng: -74.006 } },
    rating: 4.5,
    active: true,
  },
  {
    id: 'v2',
    name: 'FastShip Co',
    region: 'south',
    serviceArea: { radius: 100, center: { lat: 33.749, lng: -84.388 } },
    rating: 4.2,
    active: true,
  },
  {
    id: 'v3',
    name: 'Global Freight',
    region: 'west',
    serviceArea: { radius: 200, center: { lat: 34.0522, lng: -118.2437 } },
    rating: 3.8,
    active: false,
  },
];

/**
 * Get all vendors, optionally filtered by region.
 */
export function getAllVendors(region?: string): VendorDTO[] {
  if (region) {
    return vendors.filter((v) => v.region === region);
  }
  return [...vendors];
}

/**
 * Get a single vendor by ID.
 */
export function getVendorById(id: string): VendorDTO | undefined {
  return vendors.find((v) => v.id === id);
}

/**
 * Find vendors within a geographic service area.
 */
export function findVendorsInArea(query: ServiceAreaQuery): VendorDTO[] {
  return vendors.filter((vendor) => {
    if (!vendor.active) return false;
    const distance = haversineDistance(
      query.lat,
      query.lng,
      vendor.serviceArea.center.lat,
      vendor.serviceArea.center.lng
    );
    return distance <= query.maxDistance + vendor.serviceArea.radius;
  });
}

/**
 * Calculate the total service area coverage for a set of vendors.
 */
export function calculateTotalCoverage(vendorIds: string[]): number {
  return vendorIds.reduce((total, id) => {
    const vendor = vendors.find((v) => v.id === id);
    if (vendor) {
      return total + Math.PI * vendor.serviceArea.radius ** 2;
    }
    return total;
  }, 0);
}

/**
 * Haversine distance between two geographic points (in km).
 */
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
