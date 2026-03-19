/**
 * Sample AngularJS controller for vendor management.
 * Used to test MCP indexing of legacy AngularJS patterns.
 */
angular.module('vendorApp').controller('VendorController', [
  '$scope',
  '$http',
  'VendorService',
  function ($scope, $http, VendorService) {
    $scope.vendors = [];
    $scope.selectedVendor = null;
    $scope.loading = false;

    /**
     * Load all vendors from the API.
     */
    $scope.loadVendors = function () {
      $scope.loading = true;
      VendorService.getAll().then(function (response) {
        $scope.vendors = response.data;
        $scope.loading = false;
      }).catch(function (error) {
        console.error('Failed to load vendors:', error);
        $scope.loading = false;
      });
    };

    /**
     * Select a vendor and load its details.
     */
    $scope.selectVendor = function (vendorId) {
      $scope.selectedVendor = null;
      VendorService.getById(vendorId).then(function (response) {
        $scope.selectedVendor = response.data;
      });
    };

    /**
     * Calculate the total service area covered by vendors.
     */
    $scope.calculateServiceArea = function () {
      var totalArea = 0;
      $scope.vendors.forEach(function (vendor) {
        if (vendor.serviceArea) {
          totalArea += vendor.serviceArea.radius * vendor.serviceArea.radius * Math.PI;
        }
      });
      return totalArea;
    };

    /**
     * Filter vendors by region.
     */
    $scope.filterByRegion = function (region) {
      return $scope.vendors.filter(function (vendor) {
        return vendor.region === region;
      });
    };

    // Initialize
    $scope.loadVendors();
  },
]);

angular.module('vendorApp').service('VendorService', [
  '$http',
  function ($http) {
    this.getAll = function () {
      return $http.get('/api/vendors');
    };

    this.getById = function (id) {
      return $http.get('/api/vendors/' + id);
    };

    this.create = function (vendor) {
      return $http.post('/api/vendors', vendor);
    };

    this.update = function (id, vendor) {
      return $http.put('/api/vendors/' + id, vendor);
    };
  },
]);
