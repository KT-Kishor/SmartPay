sap.ui.define(["sap/ui/core/mvc/Controller", "sap/ui/model/json/JSONModel"], function (Controller, JSONModel) {
  "use strict";

  const PORTAL = {
    customer: { customer: true,  supplier: false, userName: "John Doe",      role: "AP Manager",       initials: "JD", company: "ABC Corporation" },
    supplier: { customer: false, supplier: true,  userName: "Supplier User", role: "ABC Supplies Ltd", initials: "SU", company: "ABC Supplies Ltd" }
  };

  // route name -> which portal / which left-menu item is highlighted
  const ROUTE_MAP = {
    home:     { portal: "supplier", navKey: "viewPO" },     // "" opens View PO
    viewPO:   { portal: "supplier", navKey: "viewPO" },
    managePO: { portal: "customer", navKey: "managePO" }
  };

  return Controller.extend("smartpay.invoice.smartpay.controller.App", {

    onInit: function () {
      const router = this.getOwnerComponent().getRouter();
      this._shell = new JSONModel(Object.assign({ navKey: "viewPO" }, PORTAL.supplier));
      this.getView().setModel(this._shell, "shell");

      // 1) react to every later navigation
      router.attachRouteMatched((e) => this._applyRoute(e.getParameter("name")));

      // 2) the first route may already have matched before this controller existed
      const info = router.getRouteInfoByHash(router.getHashChanger().getHash());
      this._applyRoute(info ? info.name : "home");
    },

    _applyRoute: function (name) {
      const cfg = ROUTE_MAP[name];
      if (!cfg) { return; }
      this._shell.setData(Object.assign({ navKey: cfg.navKey }, PORTAL[cfg.portal]));
    },

    onNavSelect: function (e) {
      const key = e.getParameter("item").getKey();
      if (key === "managePO" || key === "viewPO") {
        this.getOwnerComponent().getRouter().navTo(key);
      } else {
        // pages not built yet: keep the current item highlighted
        e.getSource().setSelectedKey(this._shell.getProperty("/navKey"));
      }
    }
  });
});