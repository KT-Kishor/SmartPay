sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/Messaging",                                   // MSG
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/ui/core/Fragment",
  "sap/ui/core/format/DateFormat",
  "smartpay/invoice/smartpay/model/formatter"
], function (Controller, JSONModel, Messaging, MessageToast, MessageBox, Fragment, DateFormat, formatter) {
  "use strict";

  const STEPS = [
    ["CREATED", "PO Created"],
    ["INTERNAL_REVIEW", "Internal Review"],
    ["SENT_TO_SUPPLIER", "Sent to Supplier"],
    ["ACKNOWLEDGED", "Supplier Acknowledged"]
  ];

  const fDate = DateFormat.getDateInstance({ pattern: "dd MMM yyyy" });
  const fTime = DateFormat.getTimeInstance({ pattern: "hh:mm a" });
  const fBoth = DateFormat.getDateTimeInstance({ pattern: "dd MMM yyyy, hh:mm a" });

  const STATUS_TEXT = { SENT: "Sent Successfully", FAILED: "Failed", PENDING: "Pending" };

  const NEW_UI = {
    locked: false, saved: false, edit: true, currency: "USD",
    lineCount: 0, chipText: "Incomplete", chipState: "Warning"
  };

  // every association shown as text in the header form
  const EXPAND = "supplier,company,purchasingOrg,paymentTerm,shipTo,buyer,poType";

  return Controller.extend("smartpay.invoice.smartpay.controller.ManagePO", {
    formatter: formatter,

    onInit: function () {
      const v = this.getView();
      v.setModel(new JSONModel(Object.assign({}, NEW_UI)), "ui");
      v.setModel(new JSONModel({ steps: [], comm: {} }), "flow");

      // MSG: message model for the popover + automatic message handling for this view
      v.setModel(Messaging.getMessageModel(), "message");
      Messaging.registerObject(v, true);

      this.getOwnerComponent().getRouter()
        .getRoute("managePO").attachPatternMatched(this._onMatched, this);
    },

    // MSG
    onExit: function () {
      Messaging.unregisterObject(this.getView());
    },

    _m: function () { return this.getView().getModel(); },

    _ui: function (o) {
      const ui = this.getView().getModel("ui");
      Object.keys(o).forEach(function (k) { ui.setProperty("/" + k, o[k]); });
    },

    // ---- MSG: message popover
    // open only when there is something to show; anchor on the message button
    // if it is already rendered, otherwise on Save Draft (always visible)
    _showMessages: function () {
      if (!Messaging.getMessageModel().getData().length) { return; }

      const btn = this.byId("messagePopoverBtn");
      const anchor = btn.getDomRef() ? btn : this.byId("saveDraftBtn");

      if (!this._pMessages) {
        this._pMessages = this.loadFragment({ name: "smartpay.invoice.smartpay.view.MessagePopover" });
      }
      this._pMessages.then((pop) => { pop.openBy(anchor); });
    },

    // close the popover first, then empty the list, so "No data" is never shown
    _clearMessages: function () {
      if (this._pMessages) {
        this._pMessages.then((pop) => { pop.close(); });
      }
      Messaging.removeAllMessages();
    },

    onMessagesPress: function () {
      this._showMessages();
    },
    _refreshLines: function () {
      const st = this.byId("lineTable");
      const b = st.getTable().getBinding("items");
      if (b) { b.refresh(true); } else { st.rebindTable(true); }
    },

    _onMatched: function (e) {
      const poId = e.getParameter("arguments").poId;
      const m = this._m();
      const v = this.getView();

      m.metadataLoaded().then(() => {
        this._poId = poId;

        Messaging.removeAllMessages();                        // MSG: no stale messages from another PO
        m.resetChanges(undefined, undefined, true);
        v.unbindElement();

        if (poId) {
          const path = "/" + m.createKey("PurchaseOrders", { ID: poId });
          this._ui({ edit: false, locked: true, saved: true });
          v.bindElement({ path: path, parameters: { expand: EXPAND } });
          this._refresh(path);
        } else {
          const ctx = m.createEntry("/PurchaseOrders", {
            properties: {
              poDate: new Date(),
              currency_code: "USD",
              poType_code: "STANDARD",
              paymentTerm_code: "NET30"
            }
          });
          v.setBindingContext(ctx);
          this._ui(NEW_UI);
          v.getModel("flow").setData({ steps: this._steps([]), comm: {} });
        }
      });
    },

    // Status chip + lock state come from the server (isLocked / isReady are
    // computed in srv/manage-po-service.js); the controller only maps them to UI state.
    _refresh: function (path) {
      const m = this._m();
      const flow = this.getView().getModel("flow");

      m.read(path, {
        urlParameters: { "$expand": EXPAND },
        success: (po) => {
          const locked = !!po.isLocked;
          const ready = !!po.isReady;

          this._ui({
            saved: true,
            locked: locked,
            currency: po.currency_code || "USD",
            chipText: locked ? "Sent" : (ready ? "Ready to Send" : "Incomplete"),
            chipState: locked ? "Information" : (ready ? "Success" : "Warning")
          });

          // history is read after the header so "PO Created" can fall back to createdAt
          m.read(path + "/history", {
            urlParameters: { "$orderby": "statusAt asc" },
            success: (d) => {
              flow.setProperty("/steps", this._steps(d.results, po.createdAt));
            }
          });
        }
      });

      m.read(path + "/communications", {
        urlParameters: { "$orderby": "sentAt desc", "$top": "1" },
        success: (d) => {
          const c = d.results[0];
          flow.setProperty("/comm", c ? {
            channel: c.channel,
            sentTo: c.sentTo,
            sentAt: fBoth.format(c.sentAt),
            status: c.transmissionStatus,
            statusText: STATUS_TEXT[c.transmissionStatus] || c.transmissionStatus,
            error: c.errorMessage
          } : {});
        }
      });
    },

    // createdAt: the PO exists, so step 1 is always done when it is known
    _steps: function (rows, createdAt) {
      return STEPS.map(([code, title], i) => {
        const h = rows.filter(r => r.statusCode === code).pop();
        const at = h ? h.statusAt : (code === "CREATED" && createdAt ? new Date(createdAt) : null);
        return {
          n: i + 1,
          title: title,
          done: !!at,
          date: at ? fDate.format(at) : "Pending…",
          time: at ? fTime.format(at) : ""
        };
      });
    },

    // ---- header
    onToggleEdit: function () {
      const ui = this.getView().getModel("ui");
      ui.setProperty("/edit", !ui.getProperty("/edit"));
    },

    onSupplierInner: function (e) {
      const c = e.getSource().getInnerControls()[0];
      if (c && c.setValueHelpIconSrc) { c.setValueHelpIconSrc("sap-icon://search"); }
    },

    onLinesUpdated: function (e) {
      this._ui({ lineCount: e.getParameter("total") || 0 });
    },

    // ---- submit helpers
    _submit: function () {
      return new Promise((res, rej) => this._m().submitChanges({
        success: (d) => {
          const bad = ((d && d.__batchResponses) || []).find(
            x => x.response && x.response.statusCode >= 400
          );
          if (bad) {
            let t = "Request failed";
            try { t = JSON.parse(bad.response.body).error.message.value; } catch (e) { /* keep */ }
            rej(new Error(t));
          } else {
            res(d);
          }
        },
        error: rej
      }));
    },

    _call: function (fn, poId) {
      return new Promise((res, rej) => this._m().callFunction("/" + fn, {
        method: "POST",
        urlParameters: { poId: poId },
        success: res,
        error: (e) => {
          let t = "Request failed";
          try { t = JSON.parse(e.responseText).error.message.value; } catch (x) { /* keep */ }
          rej(new Error(t));
        }
      }));
    },

    // MSG: backend errors are already in the message model (added by the V2 model).
    // Show them in the popover; fall back to a MessageBox only if the model is empty
    // (for example a network failure).
    _fail: function (e) {
      this.getView().setBusy(false);
      if (Messaging.getMessageModel().getData().length) {
        this._showMessages();
      } else {
        MessageBox.error((e && e.message) || "Request failed");
      }
    },

    // reload header (with all texts), status chip, tracker and communication
    _reload: function () {
      const v = this.getView();
      const ctx = v.getBindingContext();
      if (!ctx) { return; }
      const path = ctx.getPath();
      const b = v.getElementBinding();
      if (b) { b.refresh(true); }
      this._refresh(path);
    },

    // Mandatory-field and date validation is enforced by the CAP service;
    // its messages land in the MessageManager and are shown in the popover.
    onSaveDraft: function () {
      const m = this._m();
      const v = this.getView();
      const creating = !this._poId;

      if (!m.hasPendingChanges()) {
        MessageToast.show("No changes to save");
        return;
      }

      Messaging.removeAllMessages();                          // MSG: start each save with a clean list
      v.setBusy(true);

      this._submit().then((d) => {
        v.setBusy(false);
        MessageToast.show("Draft saved");

        if (creating) {
          const id = d.__batchResponses[0].__changeResponses[0].data.ID;
          this.getOwnerComponent().getRouter().navTo("managePO", { poId: id }, true);
        } else {
          this._ui({ edit: false });
          this._reload();
        }
      }).catch(this._fail.bind(this));
    },
    onLinePress: function () {
      // UI5 router: query parameters are passed under the "?query" key
      this.getOwnerComponent().getRouter().navTo("viewPO", { "?query": { poId: this._poId } });
    },
    onPreview: function () {
      Messaging.removeAllMessages();                          // MSG
      this._call("previewPO", this._poId).then(() => {
        MessageToast.show("PO moved to Internal Review");
        this._reload();
      }).catch(this._fail.bind(this));
    },
    onSend: function () {
      Messaging.removeAllMessages();                          // MSG
      this.getView().setBusy(true);
      (this._m().hasPendingChanges() ? this._submit() : Promise.resolve())
        .then(() => this._call("sendToSupplier", this._poId))
        .then(() => {
          this.getView().setBusy(false);
          MessageToast.show("PO sent to supplier");
          this._reload();
        })
        .catch(this._fail.bind(this));
    },
    // ---- lines
    _openLine: function (ctx) {
      const open = (d) => { d.setBindingContext(ctx); d.open(); };
      if (this._dlg) { open(this._dlg); return; }
      Fragment.load({
        id: this.getView().getId(),
        name: "smartpay.invoice.smartpay.view.LineDialog",
        controller: this
      }).then((d) => {
        this.getView().addDependent(d);
        this._dlg = d;
        open(d);
      });
    },
    onAddLine: function () {
      if (!this._poId) {
        MessageBox.information("Please save the draft first.");
        return;
      }
      this._lineCtx = this._m().createEntry("/POLines", {
        properties: { po_ID: this._poId, taxRate: "8", orderedQuantity: "1" }
      });
      this._openLine(this._lineCtx);
    },
    onEditLine: function (e) {
      this._lineCtx = e.getSource().getBindingContext();
      this._openLine(this._lineCtx);
    },
    onSaveLine: function () {
      Messaging.removeAllMessages();
      this._submit().then(() => {
        this._dlg.close();
        this._refreshLines();          // was rebindTable()
        this._reload();
      }).catch(this._fail.bind(this));
    },
    onCancelLine: function () {
      const m = this._m();
      if (this._lineCtx.isTransient && this._lineCtx.isTransient()) {
        m.deleteCreatedEntry(this._lineCtx);
      } else {
        m.resetChanges([this._lineCtx.getPath()], true);
      }
      this._dlg.close();
    },
    onDeleteLine: function (e) {
      const path = e.getSource().getBindingContext().getPath();
      const m = this._m();
      MessageBox.confirm("Delete this line item?", {
        onClose: (a) => {
          if (a !== "OK") { return; }
          m.remove(path, {
            success: () => {
              this._refreshLines();
              this._reload();
            },
            error: () => { this._showMessages(); }
          });
        }
      });
    },
    onImport: function () {
      MessageToast.show("Import from Template: not implemented yet");
    },
    onOverflow: function () {
      MessageToast.show("Download template / Delete all lines: not implemented yet");
    }
  });
});