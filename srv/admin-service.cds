using smartpay as db from '../db/schema';

@path: 'admin'
@requires: 'ADMIN'
service AdminService {
  entity Companies         as projection on db.COMPANY_MASTER;
  entity PurchasingOrgs    as projection on db.PURCHASING_ORG;
  entity Suppliers         as projection on db.SUPPLIER_MASTER;
  entity PaymentTerms      as projection on db.PAYMENT_TERM;
  entity Uoms              as projection on db.UOM_MASTER;
  entity POTypes           as projection on db.PO_TYPE;
  entity InvoicingStatuses as projection on db.PO_INVOICING_STATUS;
  entity Locations         as projection on db.LOCATION_MASTER;
  entity Materials         as projection on db.MATERIAL_MASTER;
  entity Users             as projection on db.APP_USER;
}