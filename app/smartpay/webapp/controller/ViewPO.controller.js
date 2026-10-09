sap.ui.define([
  "sap/ui/core/mvc/Controller", "sap/ui/model/json/JSONModel", "sap/ui/model/Sorter",
  "sap/ui/core/format/DateFormat", "sap/ui/core/Messaging", "sap/m/MessageBox",
  "smartpay/invoice/smartpay/model/formatter", "smartpay/invoice/smartpay/model/POImport"
], function (Controller, JSONModel, Sorter, DateFormat, Messaging, MessageBox, formatter, POImport) {
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
    },

    // =========================================================
    // IMPORT FROM EXCEL - PO header + line items together
    // Sheet "PO Header": one row per PO (PO Ref + header columns)
    // Sheet "PO Lines":  one row per line, linked to its PO by PO Ref
    // Creates the POs through the Manage PO service (needs a BUYER / AP_MANAGER / ADMIN user).
    // =========================================================
    _imp: function () {
      // the Manage PO model (component default model), not the View PO model of this view
      if (!this._poImport) { this._poImport = new POImport(this.getOwnerComponent().getModel()); }
      return this._poImport;
    },

    onDownloadTemplate: function () {
      this._imp().downloadTemplate(true);
    },

    onImport: function () {
      const imp = this._imp();
      imp.pickFile()
        .then((file) => imp.readFile(file))
        .then((data) => {
          if (!data.hdrs.length) {
            MessageBox.error("The PO Header sheet has no rows. Header and line items are imported together here.\n" +
              "To import only line items, open Manage PO and use Import there.");
            return;
          }
          return this._runImport(data);
        })
        .catch(() => MessageBox.error("The file could not be read. Please use the template."));
    },

    _runImport: async function (data) {
      const v = this.getView();
      v.setBusy(true);
      Messaging.removeAllMessages();
      try {
        // header validation: same Company + Delivery Date + Ship-To Location = duplicate PO
        const chk = await this._checkHeaderDuplicates(data.hdrs, data.rows);
        const dupMsgs = chk.dups.map((d) => d.msg);
        if (!chk.hdrs.length) {                              // every PO in the file is a duplicate
          v.setBusy(false);
          this._showErrors(dupMsgs);
          return;
        }

        const r = await this._imp().importPOs(chk.hdrs, chk.rows);
        v.setBusy(false);
        Messaging.removeAllMessages();
        if (r.errs) {                                        // nothing was created
          this._showErrors(dupMsgs.concat(r.errs));
          return;
        }
        r.failed = chk.dups.concat(r.failed || []);          // duplicates are listed as "Not imported"
        this._showSummary(r);
      } catch (e) {
        v.setBusy(false);
        MessageBox.error((e && e.message) || "Import failed");
      }
    },

    _showErrors: function (errs) {
      MessageBox.error(errs.slice(0, 15).join("\n") + (errs.length > 15 ? "\n…" : ""));
    },

    // A PO is a duplicate when Company + Delivery Date + Ship-To Location are all the same as
    // a PO already in HANA or an earlier PO in the file. If any one of the three differs it is imported.
    // Duplicate POs are removed (with their lines) and reported; the others go on to the import.
    _checkHeaderDuplicates: async function (hdrs, rows) {
      const m = this.getOwnerComponent().getModel();
      const read = (path, params) => new Promise((res, rej) => m.read(path, {
        urlParameters: params, success: (d) => res(d.results), error: rej
      }));
      const txt = (v) => (v === undefined || v === null) ? "" : String(v).trim();
      const same = (a, b) => txt(a).toLowerCase() === b.toLowerCase();
      const dayOf = (d) => d.toISOString().slice(0, 10);

      // Excel date: local calendar day; OData V2 date from the server: UTC day
      const excelDay = (v) => {
        const d = v instanceof Date ? v : new Date(v);
        return isNaN(d) ? null : dayOf(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
      };
      const serverDay = (v) => {
        if (!v) { return null; }
        const d = new Date(v);
        return isNaN(d) ? null : dayOf(d);
      };

      const [comps, ships, pos] = await Promise.all([
        read("/Companies", { "$top": "5000" }),
        read("/ShipToLocations", { "$top": "5000" }),
        read("/PurchaseOrders", { "$top": "5000", "$select": "ID,company_ID,shipTo_ID,deliveryDate" })
      ]);

      const taken = new Set();                               // keys of POs already in HANA
      pos.forEach((p) => {
        const day = serverDay(p.deliveryDate);
        if (p.company_ID && p.shipTo_ID && day) { taken.add([p.company_ID, p.shipTo_ID, day].join("|")); }
      });

      const seen = {};                                       // key -> PO Ref of the first PO in the file
      const keep = [], dups = [], dropRefs = new Set();

      hdrs.forEach((h, i) => {
        const ref = txt(h["PO Ref"]);
        const label = ref ? `PO "${ref}"` : `PO Header row ${i + 2}`;
        const comp = txt(h["Company Code"]) &&
          comps.find((x) => same(x.companyCode, txt(h["Company Code"])) ||
                            same(x.companyName, txt(h["Company Code"])) ||
                            same(x.name, txt(h["Company Code"])));
        const ship = txt(h["Ship-To Location"]) &&
          ships.find((x) => same(x.locationName, txt(h["Ship-To Location"])));
        const day = txt(h["Delivery Date"]) !== "" ? excelDay(h["Delivery Date"]) : null;

        // missing / unknown values are reported by the normal import; no duplicate check without all three
        if (!comp || !ship || !day) { keep.push(h); return; }

        const key = [comp.ID, ship.ID, day].join("|");
        if (taken.has(key)) {
          dups.push({ ref: ref || label, msg: `${label}: a PO with the same Company, Delivery Date and Ship-To Location already exists - not imported` });
          dropRefs.add(ref);
        } else if (seen[key] !== undefined) {
          dups.push({ ref: ref || label, msg: `${label}: same Company, Delivery Date and Ship-To Location as ${seen[key]} in this file - not imported` });
          dropRefs.add(ref);
        } else {
          seen[key] = label;
          keep.push(h);
        }
      });

      // lines of a skipped PO are not imported either (a single-PO file keeps no lines)
      const keptRows = keep.length ? rows.filter((r) => !dropRefs.has(txt(r["PO Ref"]))) : [];
      return { hdrs: keep, rows: keptRows, dups: dups };
    },

    _showSummary: function (r) {
      const total = r.done.reduce((s, p) => s + p.lines, 0);
      let t = `${r.done.length} PO(s) created with ${total} line item(s).`;
      r.done.forEach((p) => { t += `\n• ${p.ref} → ${p.number} (${p.lines} line item(s))`; });
      if (r.failed.length) { t += "\n\nNot imported:\n" + r.failed.map((f) => `• ${f.ref}: ${f.msg}`).join("\n"); }
      if (r.skipped.length) { t += "\n\nLine items skipped:\n" + r.skipped.join("\n"); }

      MessageBox[(r.failed.length || r.skipped.length) ? "warning" : "success"](t, {
        title: "Import result",
        onClose: () => {
          this.byId("poTable").rebindTable();                   // reload the list
        }
      });
    }
  });
});