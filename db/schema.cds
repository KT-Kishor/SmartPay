namespace smartpay;
using { cuid, managed } from '@sap/cds/common';

entity COMPANY_MASTER : cuid {
  companyCode : String(20); companyName : String(255);
  defaultCurrency : String(3); status : String(20) default 'ACTIVE';
}
entity PURCHASING_ORG : cuid {
  company : Association to COMPANY_MASTER; orgCode : String(20);
  orgName : String(255); status : String(20) default 'ACTIVE';
}
entity SUPPLIER_MASTER : cuid {
  sourceSystem : String(50) default 'SMARTPAY'; sourceSupplierId : String(100);
  legalName : String(255); taxId : String(100); status : String(30) default 'ACTIVE';
  defaultCurrency : String(3); poEmail : String(255); updatedFromSourceAt : Timestamp;
}
entity PAYMENT_TERM { key code : String(20); description : String(100); days : Integer; status : String(20) default 'ACTIVE'; }
entity UOM_MASTER   { key code : String(10); description : String(100); }
entity PO_TYPE      { key code : String(30); name : String(100); }
entity PO_INVOICING_STATUS { key code : String(30); name : String(100); }
entity LOCATION_MASTER : cuid {
  company : Association to COMPANY_MASTER; locationCode : String(30); locationName : String(255);
  locationType : String(20);  // SHIP_TO / PLANT
  addressLine1 : String(255); city : String(100); state : String(100);
  postalCode : String(20); countryCode : String(2); status : String(20) default 'ACTIVE';
}
entity MATERIAL_MASTER : cuid {
  company : Association to COMPANY_MASTER; materialCode : String(100); description : String(255);
  itemType : String(10); defaultUom : Association to UOM_MASTER;
  standardPrice : Decimal(18,6); status : String(20) default 'ACTIVE';
}
entity APP_USER : cuid {
  userName : String(255); email : String(255); phone : String(50); roleCode : String(30);
  company : Association to COMPANY_MASTER; supplier : Association to SUPPLIER_MASTER;
  status : String(20) default 'ACTIVE';
}
@assert.unique: { poNumber: [sourceSystem, poNumber, company] }
entity PO_HEADER : cuid, managed {
  sourceSystem     : String(50)  default 'SMARTPAY';
  poNumber         : String(100);
  poStatus         : String(30)  default 'CREATED';  // CREATED/INTERNAL_REVIEW/SENT_TO_SUPPLIER/ACKNOWLEDGED/CANCELLED
  invoicingStatus  : String(30)  default 'OPEN';     // OPEN/PARTIALLY_INVOICED/INVOICED/CLOSED
  poType           : Association to PO_TYPE;
  supplier         : Association to SUPPLIER_MASTER;
  company          : Association to COMPANY_MASTER;
  purchasingOrg    : Association to PURCHASING_ORG;
  poDate           : Date;
  deliveryDate     : Date;
  currency_code    : String(3);
  paymentTerm      : Association to PAYMENT_TERM;
  shipTo           : Association to LOCATION_MASTER;
  buyer            : Association to APP_USER;
  subtotalAmount   : Decimal(18,2) default 0;
  taxAmount        : Decimal(18,2) default 0;
  totalOrderValue  : Decimal(18,2) default 0;
  openOrderValue   : Decimal(18,2) default 0;
  toleranceProfileCode : String(50);
  sentAt           : Timestamp;
  acknowledgedAt   : Timestamp;
  versionNo        : Integer default 1;

  // Computed in srv/manage-po-service.js (after READ) - never stored in HANA
  virtual supplierExtId : String(100);   // supplier.sourceSupplierId
  virtual isLocked      : Boolean;       // sent / acknowledged / cancelled
  virtual isReady       : Boolean;       // passes every "send to supplier" rule

  lines            : Composition of many PO_LINE on lines.po = $self;
  history          : Composition of many PO_STATUS_HISTORY on history.po = $self;
  communications   : Composition of many PO_COMMUNICATION on communications.po = $self;
}
entity PO_LINE : cuid {
  po : Association to PO_HEADER;
  lineNumber : Integer; materialCode : String(100); description : String(255);
  orderedQuantity : Decimal(18,4); uom : Association to UOM_MASTER;
  unitPrice : Decimal(18,6); deliveryDate : Date;
  plant : Association to LOCATION_MASTER;
  taxRate : Decimal(5,2) default 0;
  lineValue : Decimal(18,2); taxAmount : Decimal(18,2) default 0;
  receivedQuantity : Decimal(18,4) default 0; invoicedQuantity : Decimal(18,4) default 0;
  openQuantity : Decimal(18,4); openValue : Decimal(18,2);
  finalInvoiceFlag : Boolean default false;
}
entity PO_STATUS_HISTORY : cuid {
  po : Association to PO_HEADER; statusCode : String(30);
  statusAt : Timestamp; actor : Association to APP_USER; comment : String(500);
}
entity PO_COMMUNICATION : cuid {
  po : Association to PO_HEADER; channel : String(30); sentTo : String(255);
  sentAt : Timestamp; transmissionStatus : String(20);   // SENT/FAILED/PENDING
  errorMessage : String(1000); sentBy : String(255);
}
entity AUDIT_EVENT : cuid {
  eventTime : Timestamp; entityType : String(50); entityId : String(36);
  eventType : String(50); actorType : String(20); actorId : String(255);
  beforeJson : LargeString; afterJson : LargeString;
}