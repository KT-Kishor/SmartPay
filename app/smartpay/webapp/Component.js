sap.ui.define([
    "sap/ui/core/UIComponent",
    "smartpay/invoice/smartpay/model/models"
], (UIComponent, models) => {
    "use strict";

    return UIComponent.extend("smartpay.invoice.smartpay.Component", {
        metadata: {
            manifest: "json",
            interfaces: ["sap.ui.core.IAsyncContentCreation"]
        },

        init() {
            UIComponent.prototype.init.apply(this, arguments);
            this.setModel(models.createDeviceModel(), "device");
            this.getRouter().initialize();
        }
    });
});