sap.ui.define(["sap/ui/model/Filter"], function (Filter) {
  "use strict";

  const GROUP_LINES = "importLines";
  const GROUP_HDR = "importHeaders";

  // "PO Lines" sheet columns
  const LINE_COLS = [
    "Material Code", "Description", "Quantity", "UOM",
    "Unit Price", "Delivery Date", "Plant", "Tax %"
  ];
  // "PO Header" sheet columns: one row per PO, PO Ref links the lines to it
  const HEADER_COLS = [
    "PO Ref", "Supplier", "Company Code", "Purchasing Org", "PO Date", "Currency",
    "Payment Terms", "Delivery Date", "Ship-To Location", "Buyer", "PO Type"
  ];

  const txt = (v) => (v === undefined || v === null) ? "" : String(v).trim();

  class POImport {

    constructor(model) {
      this.m = model;                      // the Manage PO OData V2 model
      this.cache = null;
      [GROUP_LINES, GROUP_HDR].forEach((g) => {
        if (model.getDeferredGroups().indexOf(g) < 0) {
          model.setDeferredGroups(model.getDeferredGroups().concat([g]));
        }
      });
    }

    // identity of a line: Material / Service + Delivery Date + Plant / Location
    static key(material, date, plantId) {
      let d = "";
      if (date instanceof Date) { d = isNaN(date) ? "" : date.toISOString().slice(0, 10); }
      else if (date) { d = String(date).slice(0, 10); }
      return [txt(material), d, plantId || ""].join("|");
    }

    // ---------------- file handling ----------------
    downloadTemplate(withHeader) {
      const wb = XLSX.utils.book_new();
      const cols = withHeader ? ["PO Ref"].concat(LINE_COLS) : LINE_COLS;
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols]), "PO Lines");
      if (withHeader) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER_COLS]), "PO Header");
      }
      XLSX.writeFile(wb, withHeader ? "PO_Import_Template.xlsx" : "PO_Lines_Template.xlsx");
    }

    pickFile() {
      return new Promise((res) => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = ".xlsx,.xls";
        inp.onchange = () => { if (inp.files[0]) { res(inp.files[0]); } };
        inp.click();
      });
    }

    // -> { rows: line rows, hdrs: header rows }
    readFile(file) {
      return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onerror = () => rej(new Error("read failed"));
        reader.onload = (ev) => {
          try {
            const wb = XLSX.read(ev.target.result, { type: "array", cellDates: true });
            const toRows = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: "" });
            const filled = (r) => Object.keys(r).some((k) => txt(r[k]) !== "");
            const names = wb.SheetNames;
            const lines = names.find((n) => n.trim().toLowerCase() === "po lines")
              || names.find((n) => !["po header", "read me"].includes(n.trim().toLowerCase()));
            const hdr = names.find((n) => n.trim().toLowerCase() === "po header");
            res({
              rows: (lines ? toRows(lines) : []).filter(filled),
              hdrs: (hdr ? toRows(hdr) : []).filter(filled)
            });
          } catch (e) { rej(e); }
        };
        reader.readAsArrayBuffer(file);
      });
    }

    // ---------------- data access ----------------
    // master data is read only once per import while this.cache is set
    readAll(path, filters) {
      if (this.cache && !filters && this.cache[path]) { return this.cache[path]; }
      const p = new Promise((res, rej) => this.m.read(path, {
        filters: filters,
        urlParameters: { "$top": "5000" },
        success: (d) => res(d.results),
        error: rej
      }));
      if (this.cache && !filters) { this.cache[path] = p; }
      return p;
    }

    toUtcDate(v) {
      if (v instanceof Date) {
        return isNaN(v) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
      }
      const d = new Date(v);
      return isNaN(d) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }

    // keys of the lines that already exist on a saved PO
    async existingKeys(poId) {
      const lines = await this.readAll("/POLines", [new Filter("po_ID", "EQ", poId)]);
      return new Set(lines.map((l) => POImport.key(l.materialCode, l.deliveryDate, l.plant_ID)));
    }

    // ---------------- Excel -> OData values ----------------
    // header texts -> keys. Mapping problems go into errs; business rules stay in CAP.
    async resolveHeader(h, errs) {
      const t = (k) => txt(h[k]);
      const same = (a, b) => String(a || "").trim().toLowerCase() === b.toLowerCase();
      const props = {};

      const [sups, comps, orgs, terms, ships, buyers, types] = await Promise.all([
        t("Supplier") ? this.readAll("/Suppliers") : [],
        t("Company Code") ? this.readAll("/Companies") : [],
        t("Purchasing Org") ? this.readAll("/PurchasingOrgs") : [],
        t("Payment Terms") ? this.readAll("/PaymentTerms") : [],
        t("Ship-To Location") ? this.readAll("/ShipToLocations") : [],
        t("Buyer") ? this.readAll("/Buyers") : [],
        t("PO Type") ? this.readAll("/POTypes") : []
      ]);

      const pick = (col, list, test, apply) => {
        const val = t(col);
        if (!val) { return; }
        const hit = list.find((x) => test(x, val));
        if (hit) { apply(hit); } else { errs.push(`Header: unknown ${col} "${val}"`); }
      };

      let supCurrency = null;
      pick("Supplier", sups, (x, v) => same(x.legalName, v) || same(x.sourceSupplierId, v), (x) => {
        props.supplier_ID = x.ID;
        supCurrency = x.defaultCurrency;
      });
      pick("Company Code", comps, (x, v) => same(x.companyCode, v), (x) => { props.company_ID = x.ID; });
      pick("Purchasing Org", orgs, (x, v) => same(x.orgCode, v), (x) => { props.purchasingOrg_ID = x.ID; });
      pick("Payment Terms", terms, (x, v) => same(x.code, v) || same(x.description, v), (x) => { props.paymentTerm_code = x.code; });
      pick("Ship-To Location", ships, (x, v) => same(x.locationName, v), (x) => { props.shipTo_ID = x.ID; });
      pick("Buyer", buyers, (x, v) => same(x.userName, v), (x) => { props.buyer_ID = x.ID; });
      pick("PO Type", types, (x, v) => same(x.code, v) || same(x.name, v), (x) => { props.poType_code = x.code; });

      const cur = t("Currency").toUpperCase();
      if (cur) { props.currency_code = cur; }
      else if (supCurrency) { props.currency_code = supCurrency; }

      [["PO Date", "poDate"], ["Delivery Date", "deliveryDate"]].forEach(([col, prop]) => {
        if (t(col) === "") { return; }
        const d = this.toUtcDate(h[col]);
        if (d) { props[prop] = d; } else { errs.push(`Header: invalid ${col}`); }
      });

      return props;
    }

    // line rows -> [{ row, ref, props, plantName, dateText }]; mapping problems go into errs
    async buildLines(rows, errs) {
      const codes = [...new Set(rows.map((r) => txt(r["Material Code"])).filter(Boolean))];
      const [mats, plants] = await Promise.all([
        codes.length
          ? this.readAll("/Materials", [new Filter({
              filters: codes.map((c) => new Filter("materialCode", "EQ", c)), and: false })])
          : Promise.resolve([]),
        this.readAll("/PlantLocations")
      ]);

      return rows.map((r, i) => {
        const n = i + 2;                                       // Excel row number
        const code = txt(r["Material Code"]);
        const mat = mats.find((x) => x.materialCode === code);
        if (!mat) { errs.push(`PO Lines row ${n}: unknown material "${code}"`); }

        const pName = txt(r["Plant"]);
        const plant = plants.find((x) => x.locationName === pName);
        if (pName && !plant) { errs.push(`PO Lines row ${n}: unknown plant "${pName}"`); }

        const dd = txt(r["Delivery Date"]) === "" ? null : this.toUtcDate(r["Delivery Date"]);
        if (txt(r["Delivery Date"]) !== "" && !dd) { errs.push(`PO Lines row ${n}: invalid delivery date`); }

        const qty = r["Quantity"], price = r["Unit Price"];
        return {
          row: n,
          ref: txt(r["PO Ref"]),
          plantName: pName,
          dateText: dd ? dd.toISOString().slice(0, 10) : "",
          props: {
            materialCode: code,
            description: r["Description"] || (mat && mat.description) || "",
            orderedQuantity: String(qty),
            uom_code: String(r["UOM"] || (mat && mat.defaultUom_code) || ""),
            unitPrice: String(price === "" && mat ? mat.standardPrice : price),
            deliveryDate: dd,
            plant_ID: plant ? plant.ID : null,
            taxRate: String(txt(r["Tax %"]) === "" ? 8 : r["Tax %"])
          }
        };
      });
    }

    // Material / Service + Delivery Date + Plant already taken -> not imported
    // (taken = Set of keys: lines already on the PO, plus lines accepted earlier in the file)
    dropDuplicates(entries, taken, skipped, prefix) {
      return entries.filter((e) => {
        const k = POImport.key(e.props.materialCode, e.props.deliveryDate, e.props.plant_ID);
        if (taken.has(k)) {
          skipped.push(`${prefix}PO Lines row ${e.row}: Material ${e.props.materialCode}, ` +
            `delivery date ${e.dateText || "-"}, plant ${e.plantName || "-"} already exists - not imported`);
          return false;
        }
        taken.add(k);
        return true;
      });
    }

    // ---------------- sending ----------------
    submit(groupId) {
      return new Promise((res, rej) => this.m.submitChanges({
        groupId: groupId,
        success: (d) => {
          const bad = ((d && d.__batchResponses) || []).find((x) => x.response && x.response.statusCode >= 400);
          if (bad) {
            let t = "Request failed";
            try { t = JSON.parse(bad.response.body).error.message.value; } catch (e) { /* keep */ }
            rej(new Error(t));
          } else {
            res(d);
          }
        },
        error: (e) => rej(new Error((e && e.message) || "Request failed"))
      }));
    }

    createPO(props) {
      const data = Object.assign({
        poDate: this.toUtcDate(new Date()),
        currency_code: "USD", poType_code: "STANDARD", paymentTerm_code: "NET30"
      }, props);
      this.m.create("/PurchaseOrders", data, { groupId: GROUP_HDR });
      return this.submit(GROUP_HDR).then((d) => d.__batchResponses[0].__changeResponses[0].data);
    }

    createLines(poId, lines) {
      lines.forEach((e) => this.m.create("/POLines", Object.assign({}, e.props, { po_ID: poId }),
        { groupId: GROUP_LINES, changeSetId: "importChangeSet" }));
      return this.submit(GROUP_LINES);                       // all lines of this PO or none
    }

    removePO(id) {                                           // undo a header whose lines failed
      this.m.remove("/" + this.m.createKey("PurchaseOrders", { ID: id }), { groupId: GROUP_HDR });
      return this.submit(GROUP_HDR).catch(() => {});
    }

    // ---------------- header + lines -> new POs ----------------
    // returns { errs } (nothing created) or { done, failed, skipped }
    async importPOs(hdrs, rows) {
      this.cache = {};
      try {
        const errs = [];
        const skipped = [];
        const single = hdrs.length === 1;                    // one PO: PO Ref may stay empty

        // 1) header rows -> keys
        const pos = [];
        const refs = new Set();
        for (let i = 0; i < hdrs.length; i++) {
          const ref = txt(hdrs[i]["PO Ref"]) || (single ? "PO1" : "");
          if (!ref) { errs.push(`PO Header row ${i + 2}: PO Ref is required when several POs are imported`); continue; }
          if (refs.has(ref)) { errs.push(`PO Header row ${i + 2}: PO Ref "${ref}" is used twice`); continue; }
          refs.add(ref);
          const e2 = [];
          const props = await this.resolveHeader(hdrs[i], e2);
          e2.forEach((x) => errs.push(`PO "${ref}": ${x.replace(/^Header: /, "")}`));
          pos.push({ ref: ref, props: props });
        }

        // 2) line rows -> must point to one of the POs
        const entries = rows.length ? await this.buildLines(rows, errs) : [];
        entries.forEach((e) => {
          if (!e.ref && single && pos.length) { e.ref = pos[0].ref; }
          if (!e.ref) { errs.push(`PO Lines row ${e.row}: PO Ref is required`); }
          else if (!refs.has(e.ref)) { errs.push(`PO Lines row ${e.row}: PO Ref "${e.ref}" is not in the PO Header sheet`); }
        });

        if (errs.length) { return { errs: errs }; }          // nothing is created

        // 3) duplicates per PO: same Material + Delivery Date + Plant
        const byRef = {};
        entries.forEach((e) => { (byRef[e.ref] = byRef[e.ref] || []).push(e); });
        Object.keys(byRef).forEach((ref) => {
          byRef[ref] = this.dropDuplicates(byRef[ref], new Set(), skipped, `PO "${ref}": `);
        });

        // 4) create one PO after the other; CAP validates every PO
        const done = [], failed = [];
        for (const po of pos) {
          const lines = byRef[po.ref] || [];
          let created = null;
          try {
            created = await this.createPO(po.props);
            if (lines.length) { await this.createLines(created.ID, lines); }
            done.push({ ref: po.ref, id: created.ID, number: created.poNumber, lines: lines.length });
          } catch (e) {
            if (created) { await this.removePO(created.ID); }
            failed.push({ ref: po.ref, msg: e.message });
          }
        }
        return { done: done, failed: failed, skipped: skipped };
      } finally {
        this.cache = null;
      }
    }
  }

  return POImport;
});