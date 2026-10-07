sap.ui.define([
  "sap/ui/core/mvc/Controller", "sap/ui/model/json/JSONModel", "sap/ui/model/Sorter",
  "sap/ui/core/format/DateFormat", "smartpay/invoice/smartpay/model/formatter"
], function (Controller, JSONModel, Sorter, DateFormat, formatter) {
  "use strict";
  return Controller.extend("smartpay.invoice.smartpay.controller.ViewPO", {
    formatter: formatter,

    onInit: function () {
      const v = this.getView();
      v.setModel(this.getOwnerComponent().getModel("viewService"));
      v.setModel(new JSONModel({ now: this._now(), countText: "" }), "ui");
    },
    _now: function () {
      return DateFormat.getDateTimeInstance({ pattern: "EEE, d MMM yyyy hh:mm a" }).format(new Date());
    },

    // placeholders and button texts like the screenshot
    onFilterInit: function () {
      const f = this.byId("smartFilterBar");
      const ph = { poNumber: "Enter PO number", company_ID: "All Customers",
                   invoicingStatus: "All Statuses", deliveryDate: "Select date range" };
      Object.keys(ph).forEach((k) => {
        const c = f.getControlByKey ? f.getControlByKey(k) : f.determineControlByName(k);
        if (c && c.setPlaceholder) { c.setPlaceholder(ph[k]); }
      });
      const s = f._oSearchField || (f.getBasicSearchControl && f.getBasicSearchControl());
      if (s && s.setPlaceholder) { s.setPlaceholder("Search by material, description..."); }
      const go = f._oSearchButton || (f.getSearchButton && f.getSearchButton());
      if (go && go.setText) { go.setText("Apply Filters"); }
      const cl = f._oClearButtonOnFB;
      if (cl && cl.setText) { cl.setText("Clear All"); }
    },
    onClear: function () { setTimeout(() => this.byId("poTable").rebindTable(), 0); },
    onRefresh: function () {
      this.byId("poTable").rebindTable();
      this.getView().getModel("ui").setProperty("/now", this._now());
    },

    onBeforeRebind: function (e) {
      const bp = e.getParameter("bindingParams");
      bp.sorter.push(new Sorter("poDate", true));
      const fix = (f) => {
        if (f.aFilters) { f.aFilters.forEach(fix); }
        else if (f.sPath === "poNumber" && f.sOperator === "EQ") { f.sOperator = "Contains"; }
      };
      bp.filters.forEach(fix);
    },

    onUpdateFinished: function (e) {
      this.getView().getModel("ui").setProperty("/countText",
        "Showing " + e.getParameter("actual") + " of " + e.getParameter("total") + " purchase orders");
    },

    // ---- navigation to Manage PO
    _goManagePO: function (id) {
      const router = this.getOwnerComponent().getRouter();
      if (id) { router.navTo("managePO", { poId: id }); }
      else    { router.navTo("managePO"); }          // empty form for a new PO
    },

    onCreate: function () { this._goManagePO(); },

    // tap on the row or on the ">" arrow
    onRowPress: function (e) {
      const item = e.getParameter("listItem") || e.getSource();
      const ctx = item && item.getBindingContext();
      if (ctx) { this._goManagePO(ctx.getProperty("ID")); }
    },

    // "View Details →" link in the Action column
    onViewDetails: function (e) {
      const ctx = e.getSource().getBindingContext();
      if (ctx) { this._goManagePO(ctx.getProperty("ID")); }
    }
  });
});