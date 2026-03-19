import React, { useState, useEffect } from 'react';

/** Vendor data type */
interface Vendor {
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

/** Props for the VendorList component */
interface VendorListProps {
  region?: string;
  onSelect: (vendor: Vendor) => void;
}

/**
 * VendorList component — displays a filterable list of vendors.
 * Migrated from AngularJS VendorController.
 */
const VendorList: React.FC<VendorListProps> = ({ region, onSelect }) => {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadVendors();
  }, []);

  async function loadVendors() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/vendors');
      const data = await response.json();
      setVendors(data);
    } catch (err) {
      setError('Failed to load vendors');
    } finally {
      setLoading(false);
    }
  }

  function calculateServiceArea(): number {
    return vendors.reduce((total, vendor) => {
      if (vendor.serviceArea) {
        return total + Math.PI * vendor.serviceArea.radius ** 2;
      }
      return total;
    }, 0);
  }

  const filteredVendors = region
    ? vendors.filter((v) => v.region === region)
    : vendors;

  if (loading) return <div className="loading">Loading vendors...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="vendor-list">
      <h2>Vendors ({filteredVendors.length})</h2>
      <p>Total service area: {calculateServiceArea().toFixed(2)} sq km</p>
      <ul>
        {filteredVendors.map((vendor) => (
          <li key={vendor.id} onClick={() => onSelect(vendor)}>
            <strong>{vendor.name}</strong> — {vendor.region}
            <span className="rating">Rating: {vendor.rating}/5</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * VendorDetail component — shows detailed info for a selected vendor.
 */
const VendorDetail: React.FC<{ vendor: Vendor | null }> = ({ vendor }) => {
  if (!vendor) return <div>Select a vendor to view details</div>;

  return (
    <div className="vendor-detail">
      <h3>{vendor.name}</h3>
      <p>Region: {vendor.region}</p>
      <p>Rating: {vendor.rating}/5</p>
      <p>Status: {vendor.active ? 'Active' : 'Inactive'}</p>
      <p>
        Service Area: radius {vendor.serviceArea.radius} km, centered at (
        {vendor.serviceArea.center.lat}, {vendor.serviceArea.center.lng})
      </p>
    </div>
  );
};

export { VendorList, VendorDetail };
export type { Vendor, VendorListProps };
