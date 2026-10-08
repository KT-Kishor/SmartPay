using ManagePOService as m from '../../srv/manage-po-service';
using ViewPOService   as v from '../../srv/view-po-service';

// ---------- Manage PO : header ----------
annotate m.PurchaseOrders with {
  poNumber      @title:'PO Number';
  supplier      @title:'Supplier' @Common.Text:supplier.legalName @Common.TextArrangement:#TextOnly
    @Common.FieldControl:#Mandatory
    @Common.ValueList:{ CollectionPath:'Suppliers', Parameters:[
      {$Type:'Common.ValueListParameterInOut',LocalDataProperty:supplier_ID,ValueListProperty:'ID'},
      // picking a supplier fills these two fields (replaces the controller's onSupplierChange)
      {$Type:'Common.ValueListParameterOut',LocalDataProperty:supplierExtId,ValueListProperty:'sourceSupplierId'},
      {$Type:'Common.ValueListParameterOut',LocalDataProperty:currency_code,ValueListProperty:'defaultCurrency'},
      {$Type:'Common.ValueListParameterDisplayOnly',ValueListProperty:'legalName'}]};
      
  company       @title:'Company Code' @Common.Text:company.companyCode @Common.TextArrangement:#TextOnly
    @Common.ValueListWithFixedValues @Common.FieldControl:#Mandatory
    @Common.ValueList:{ CollectionPath:'Companies', Parameters:[
      {$Type:'Common.ValueListParameterInOut',LocalDataProperty:company_ID,ValueListProperty:'ID'},
      {$Type:'Common.ValueListParameterDisplayOnly',ValueListProperty:'companyCode'}]};
  purchasingOrg @title:'Purchasing Org' @Common.Text:purchasingOrg.orgCode @Common.TextArrangement:#TextOnly
    @Common.ValueListWithFixedValues @Common.FieldControl:#Mandatory
    @Common.ValueList:{ CollectionPath:'PurchasingOrgs', Parameters:[
      {$Type:'Common.ValueListParameterInOut',LocalDataProperty:purchasingOrg_ID,ValueListProperty:'ID'},
      {$Type:'Common.ValueListParameterDisplayOnly',ValueListProperty:'orgCode'}]};
  poDate        @title:'PO Date' @Common.FieldControl:#Mandatory;
  deliveryDate  @title:'Delivery Date' @Common.FieldControl:#Mandatory;
  currency_code @title:'Currency' @Common.FieldControl:#Mandatory;
  paymentTerm   @title:'Payment Terms' @Common.Text:paymentTerm.description @Common.TextArrangement:#TextOnly
    @Common.ValueListWithFixedValues @Common.FieldControl:#Mandatory
    @Common.ValueList:{ CollectionPath:'PaymentTerms', Parameters:[
      {$Type:'Common.ValueListParameterInOut',LocalDataProperty:paymentTerm_code,ValueListProperty:'code'},
      {$Type:'Common.ValueListParameterDisplayOnly',ValueListProperty:'description'}]};
  shipTo        @title:'Ship-To Location' @Common.Text:shipTo.locationName @Common.TextArrangement:#TextOnly
    @Common.ValueListWithFixedValues @Common.FieldControl:#Mandatory
    @Common.ValueList:{ CollectionPath:'ShipToLocations', Parameters:[
      {$Type:'Common.ValueListParameterInOut',LocalDataProperty:shipTo_ID,ValueListProperty:'ID'},
      {$Type:'Common.ValueListParameterDisplayOnly',ValueListProperty:'locationName'}]};
  buyer         @title:'Buyer' @Common.Text:buyer.userName @Common.TextArrangement:#TextOnly
    @Common.ValueListWithFixedValues @Common.FieldControl:#Mandatory
    @Common.ValueList:{ CollectionPath:'Buyers', Parameters:[
      {$Type:'Common.ValueListParameterInOut',LocalDataProperty:buyer_ID,ValueListProperty:'ID'},
      {$Type:'Common.ValueListParameterDisplayOnly',ValueListProperty:'userName'}]};
  poType        @title:'PO Type' @Common.Text:poType.name @Common.TextArrangement:#TextOnly
    @Common.ValueListWithFixedValues @Common.FieldControl:#Mandatory
    @Common.ValueList:{ CollectionPath:'POTypes', Parameters:[
      {$Type:'Common.ValueListParameterInOut',LocalDataProperty:poType_code,ValueListProperty:'code'},
      {$Type:'Common.ValueListParameterDisplayOnly',ValueListProperty:'name'}]};
};

// ---------- Manage PO : lines ----------
annotate m.POLines with {
  lineNumber      @title:'Line';
  materialCode    @title:'Material / Service' @Common.FieldControl:#Mandatory
    @Common.ValueList:{ CollectionPath:'Materials', Parameters:[
      {$Type:'Common.ValueListParameterInOut',LocalDataProperty:materialCode,ValueListProperty:'materialCode'},
      {$Type:'Common.ValueListParameterOut',LocalDataProperty:description,ValueListProperty:'description'},
      {$Type:'Common.ValueListParameterOut',LocalDataProperty:uom_code,ValueListProperty:'defaultUom_code'},
      {$Type:'Common.ValueListParameterOut',LocalDataProperty:unitPrice,ValueListProperty:'standardPrice'}]};
  description     @title:'Description' @Common.FieldControl:#Mandatory;
  orderedQuantity @title:'Qty' @Common.FieldControl:#Mandatory;
  uom             @title:'UOM' @Common.ValueListWithFixedValues
    @Common.ValueList:{ CollectionPath:'Uoms', Parameters:[
      {$Type:'Common.ValueListParameterInOut',LocalDataProperty:uom_code,ValueListProperty:'code'},
      {$Type:'Common.ValueListParameterDisplayOnly',ValueListProperty:'description'}]};
  unitPrice       @title:'Unit Price' @Common.FieldControl:#Mandatory;
  deliveryDate    @title:'Delivery Date' @Common.FieldControl:#Mandatory;
  plant           @title:'Plant / Location' @Common.Text:plant.locationName @Common.TextArrangement:#TextOnly
    @Common.ValueListWithFixedValues
    @Common.ValueList:{ CollectionPath:'PlantLocations', Parameters:[
      {$Type:'Common.ValueListParameterInOut',LocalDataProperty:plant_ID,ValueListProperty:'ID'},
      {$Type:'Common.ValueListParameterDisplayOnly',ValueListProperty:'locationName'}]};
  taxRate         @title:'Tax %';
  lineValue       @title:'Amount';          // read-only is declared in srv/manage-po-service.cds
};

// ---------- show names instead of IDs in the dropdowns (Manage PO value lists) ----------
annotate m.Suppliers       with { ID   @Common.Text: legalName    @Common.TextArrangement: #TextOnly; };
annotate m.Companies       with { ID   @Common.Text: companyCode  @Common.TextArrangement: #TextOnly; };
annotate m.PurchasingOrgs  with { ID   @Common.Text: orgCode      @Common.TextArrangement: #TextOnly; };
annotate m.PaymentTerms    with { code @Common.Text: description  @Common.TextArrangement: #TextOnly; };
annotate m.ShipToLocations with { ID   @Common.Text: locationName @Common.TextArrangement: #TextOnly; };
annotate m.PlantLocations  with { ID   @Common.Text: locationName @Common.TextArrangement: #TextOnly; };
annotate m.Buyers          with { ID   @Common.Text: userName     @Common.TextArrangement: #TextOnly; };
annotate m.POTypes         with { code @Common.Text: name         @Common.TextArrangement: #TextOnly; };
annotate m.Uoms            with { code @Common.Text: description  @Common.TextArrangement: #TextOnly; };

// Qty, Unit Price, Amount and Actions are custom columns in the view
annotate m.POLines with @UI.LineItem: [
  {Value:lineNumber},{Value:materialCode},{Value:description},
  {Value:uom_code},{Value:deliveryDate},{Value:plant_ID}
];

// ---------- View PO : header / filter ----------
annotate v.SupplierPOs with {

  poNumber
    @title:'PO Number';

  supplier
    @title:'Supplier'
    @Common.Text:supplier.legalName
    @Common.TextArrangement:#TextOnly;

  company
    @title:'Customer'
    @Common.Text:company.companyName
    @Common.TextArrangement:#TextOnly
    @Common.ValueListWithFixedValues
    @Common.ValueList:{
      CollectionPath:'Customers',
      Parameters:[
        { $Type:'Common.ValueListParameterInOut', LocalDataProperty:company_ID, ValueListProperty:'ID' },
        { $Type:'Common.ValueListParameterDisplayOnly', ValueListProperty:'companyName' }
      ]
    };

  shipTo
    @title:'Ship-To Location'
    @Common.Text:shipTo.locationName
    @Common.TextArrangement:#TextOnly;

  poDate
    @title:'PO Date';

  deliveryDate
    @title:'Delivery Date';

  paymentTerm
    @title:'Payment Terms'
    @Common.Text:paymentTerm.description
    @Common.TextArrangement:#TextOnly;

  currency_code
    @title:'Currency';

  buyer
    @title:'Buyer'
    @Common.Text:buyer.userName
    @Common.TextArrangement:#TextOnly;

  invoicingStatus
    @title:'Status'
    @Common.ValueListWithFixedValues
    @Common.ValueList:{
      CollectionPath:'InvoicingStatuses',
      Parameters:[
        {
          $Type:'Common.ValueListParameterInOut',
          LocalDataProperty:invoicingStatus,
          ValueListProperty:'code'
        },
        {
          $Type:'Common.ValueListParameterDisplayOnly',
          ValueListProperty:'name'
        }
      ]
    };
};

// dropdown texts for the two filter value lists
annotate v.Customers          with { ID   @Common.Text: companyName @Common.TextArrangement: #TextOnly; };
annotate v.InvoicingStatuses  with { code @Common.Text: name        @Common.TextArrangement: #TextOnly; };

annotate v.SupplierPOs with @Capabilities.FilterRestrictions.FilterExpressionRestrictions:
  [{ Property: deliveryDate, AllowedExpressions: 'SingleRange' }];

// the 4 fields of the filter bar
annotate v.SupplierPOs with @UI.SelectionFields: [ poNumber, company_ID, invoicingStatus, deliveryDate ];

// first columns of the PO table; Amount, Status and Action are custom columns in the view
annotate v.SupplierPOs with @UI.LineItem: [
  {Value:poNumber},{Value:company_ID},{Value:poDate},{Value:deliveryDate}
];

// ---------- View PO : lines ----------
annotate v.SupplierPOLines with {
  lineNumber      @title:'Line';
  materialCode    @title:'Material / Service';
  description     @title:'Description';
  orderedQuantity @title:'Qty';
  uom             @title:'UOM';
  unitPrice       @title:'Unit Price';
  lineValue       @title:'Amount';
};
// Unit Price and Amount are custom columns in the view ($ format)
annotate v.SupplierPOLines with @UI.LineItem: [
  {Value:lineNumber},{Value:materialCode},{Value:description},
  {Value:orderedQuantity},{Value:uom_code}
];