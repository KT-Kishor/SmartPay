using smartpay as db from '../db/schema';

@path: 'view-po'
@requires: 'authenticated-user'
service ViewPOService {

  // all POs from HANA (add e.g. `where poStatus <> 'CREATED'` to hide unsent POs)
  @readonly entity SupplierPOs       as projection on db.PO_HEADER;
  @readonly entity SupplierPOLines   as projection on db.PO_LINE;
  @readonly entity Suppliers         as projection on db.SUPPLIER_MASTER;
  @readonly entity Customers         as projection on db.COMPANY_MASTER;
  @readonly entity PurchasingOrgs    as projection on db.PURCHASING_ORG;
  @readonly entity PaymentTerms      as projection on db.PAYMENT_TERM;
  @readonly entity POTypes           as projection on db.PO_TYPE;
  @readonly entity Uoms              as projection on db.UOM_MASTER;
  @readonly entity Locations         as projection on db.LOCATION_MASTER;
  @readonly entity Buyers            as projection on db.APP_USER;
  @readonly entity InvoicingStatuses as projection on db.PO_INVOICING_STATUS;
  action acknowledge(poId : UUID);
}