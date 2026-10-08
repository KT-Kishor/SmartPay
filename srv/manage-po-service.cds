using smartpay as db from '../db/schema';

@path: 'manage-po'
@requires: ['BUYER','AP_MANAGER','ADMIN']
service ManagePOService {
  entity PurchaseOrders as projection on db.PO_HEADER;
  entity POLines        as projection on db.PO_LINE {
    *,
    plant : redirected to PlantLocations
  };
  @readonly entity POStatusHistory  as projection on db.PO_STATUS_HISTORY;
  @readonly entity POCommunications as projection on db.PO_COMMUNICATION;

  @readonly entity Suppliers      as projection on db.SUPPLIER_MASTER where status = 'ACTIVE';
  @readonly entity Companies      as projection on db.COMPANY_MASTER;
  @readonly entity PurchasingOrgs as projection on db.PURCHASING_ORG;
  @readonly entity PaymentTerms   as projection on db.PAYMENT_TERM;
  @readonly @cds.redirection.target
  entity ShipToLocations as projection on db.LOCATION_MASTER where locationType = 'SHIP_TO';
  @readonly
  entity PlantLocations  as projection on db.LOCATION_MASTER where locationType = 'PLANT';
  @readonly entity Uoms           as projection on db.UOM_MASTER;
  @readonly entity Materials      as projection on db.MATERIAL_MASTER;
  @readonly entity Buyers         as projection on db.APP_USER where roleCode in ('BUYER','AP_MANAGER');
  @readonly entity POTypes        as projection on db.PO_TYPE;
  action previewPO(poId : UUID);
  action sendToSupplier(poId : UUID);
}

// Values that only the server may set
annotate ManagePOService.PurchaseOrders with {
  poNumber @readonly; poStatus @readonly; invoicingStatus @readonly;
  subtotalAmount @readonly; taxAmount @readonly; totalOrderValue @readonly; openOrderValue @readonly;
  sentAt @readonly; acknowledgedAt @readonly; versionNo @readonly;
  poDate @mandatory; company @mandatory;
};
annotate ManagePOService.POLines with {
  // server-owned values
  lineNumber @readonly; lineValue @readonly; taxAmount @readonly;
  openQuantity @readonly; openValue @readonly;
  receivedQuantity @readonly; invoicedQuantity @readonly;
  // standard validation: applies to Save Line, Excel import and direct API calls
  materialCode    @mandatory;
  description     @mandatory;
  orderedQuantity @mandatory @assert.range: [(0), _];   // > 0
  unitPrice       @mandatory @assert.range: [0, _];     // >= 0
  taxRate         @assert.range: [0, 100];
  uom             @mandatory @assert.target;            // required and must exist in Uoms
  plant           @assert.target;                       // must be a PLANT location
};