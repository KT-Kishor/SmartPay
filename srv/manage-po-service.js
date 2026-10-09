const cds = require('@sap/cds');
const { now, addHistory, audit, SELECT, INSERT, UPDATE } = require('./lib/po-helpers');

const LOCKED = ['SENT_TO_SUPPLIER', 'ACKNOWLEDGED', 'CANCELLED'];
const r2 = n => Math.round(n * 100) / 100;

// Required to SAVE a draft / required to SEND (field -> label used in messages)
const SAVE_REQUIRED = {
  supplier_ID: 'Supplier', company_ID: 'Company', purchasingOrg_ID: 'Purchasing Organization',
  deliveryDate: 'Delivery Date', shipTo_ID: 'Ship-To Location', buyer_ID: 'Buyer'
};
const SEND_REQUIRED = {
  ...SAVE_REQUIRED,
  poDate: 'PO Date', currency_code: 'Currency', paymentTerm_code: 'Payment Terms', poType_code: 'PO Type'
};

const missing = (fields, d) =>
  Object.keys(fields).filter(f => d[f] == null || d[f] === '').map(f => fields[f]);

// Every rule a PO must satisfy before it may be sent. Used by the send action
// (to reject) and by after-READ (to expose isReady to the UI).
const sendIssues = (po, lines, sup) => {
  const e = missing(SEND_REQUIRED, po).map(l => `${l} is required`);

  if (!sup || sup.status !== 'ACTIVE') { e.push('Supplier must be ACTIVE'); }
  else if (!sup.poEmail) { e.push('Supplier has no PO email'); }

  if (!lines.length) { e.push('At least one line item is required'); }

  if (po.deliveryDate && po.poDate && po.deliveryDate < po.poDate) {
    e.push('Delivery date must be on/after PO date');
  }
  if (!/^[A-Z]{3}$/.test(po.currency_code || '')) { e.push('Invalid currency'); }

  lines.forEach(l => {
    if (!(Number(l.orderedQuantity) > 0)) { e.push(`Line ${l.lineNumber}: qty must be > 0`); }
    if (!l.uom_code || !l.materialCode || !l.plant_ID) {
      e.push(`Line ${l.lineNumber}: material, UOM and plant required`);
    }
    if (l.deliveryDate && po.poDate && l.deliveryDate < po.poDate) {
      e.push(`Line ${l.lineNumber}: delivery date before PO date`);
    }
  });
  return e;
};

module.exports = class ManagePOService extends cds.ApplicationService {

  init() {

    const { PurchaseOrders, POLines } = this.entities;
    const db = cds.entities('smartpay');

    // run a query in the request transaction, through THIS project's cds instance
    const run = (req, query) => cds.tx(req).run(query);

    const assertEditable = async (poId, req) => {
      const po = await run(req, SELECT.one.from(db.PO_HEADER).columns('poStatus').where({ ID: poId }));
      if (po && LOCKED.includes(po.poStatus)) {
        req.reject(409, 'PO is locked after sending');
      }
    };

    // line value, tax, open quantity/value
    const fill = (d, req) => {
      const q = Number(d.orderedQuantity);
      const p = Number(d.unitPrice);
      const t = Number(d.taxRate || 0);

      if (!(q > 0)) { req.reject(400, 'Quantity must be > 0'); }
      if (!(p >= 0)) { req.reject(400, 'Unit price must be >= 0'); }

      d.lineValue = r2(q * p);
      d.taxAmount = r2(d.lineValue * t / 100);
      d.openQuantity = q;
      d.openValue = d.lineValue;
    };

    // header totals in the database, no lines loaded into memory
    const recalc = async (poId, req) => {
      const agg = await run(req,
        SELECT.one.from(db.PO_LINE)
          .columns('sum(lineValue) as sub', 'sum(taxAmount) as tax')
          .where({ po_ID: poId })
      );
      const sub = Number((agg && agg.sub) || 0);
      const tax = Number((agg && agg.tax) || 0);

      await run(req, UPDATE(db.PO_HEADER, poId).with({
        subtotalAmount: r2(sub),
        taxAmount: r2(tax),
        totalOrderValue: r2(sub + tax),
        openOrderValue: r2(sub + tax)
      }));
    };

    // ---------------------------------------------------------
    // HEADER
    // ---------------------------------------------------------

    this.before('CREATE', PurchaseOrders, async req => {
      const rows = await run(req, SELECT.from(db.PO_HEADER).columns('poNumber'));
      const max = rows.reduce(
        (m, x) => Math.max(m, parseInt((x.poNumber || '').replace(/\D/g, '')) || 0),
        500000
      );
      Object.assign(req.data, {
        poNumber: 'PO-' + (max + 1),
        poStatus: 'CREATED',
        invoicingStatus: 'OPEN',
        versionNo: 1
      });
    });

    // Validation on save: replaces the controller's _validatePO.
    // UPDATE is a partial payload, so validate it merged with the stored row.
    this.before(['CREATE', 'UPDATE'], PurchaseOrders, async req => {
      const cur = req.event === 'UPDATE'
        ? await run(req, SELECT.one.from(db.PO_HEADER).where({ ID: req.data.ID }))
        : null;
      const d = { ...cur, ...req.data };

      const m = missing(SAVE_REQUIRED, d);
      m.forEach(label => req.error(400, `${label} is required`));
      if (d.deliveryDate && d.poDate && d.deliveryDate < d.poDate) {
        return req.reject(400, 'Delivery date must be on/after PO date');
      }
    });

    this.before(['UPDATE', 'DELETE'], PurchaseOrders, req => assertEditable(req.data.ID, req));

    this.after('CREATE', PurchaseOrders, async (d, req) => {
      await addHistory(req, d.ID, 'CREATED');
      await audit(req, 'PO_HEADER', d.ID, 'PO_CREATED', null, d);
    });

    this.after('UPDATE', PurchaseOrders, (d, req) =>
      audit(req, 'PO_HEADER', req.data.ID, 'PO_UPDATED', null, req.data)
    );

    // Computed (virtual) fields: one batched query per table, never per row.
    // Needs the full row (no narrowing $select), which is how the UI reads it.
    this.after('READ', PurchaseOrders, async (rows, req) => {
      const list = (Array.isArray(rows) ? rows : [rows])
        .filter(r => r && r.ID && r.poStatus !== undefined);
      if (!list.length) { return; }

      const lines = await run(req,
        SELECT.from(db.PO_LINE)
          .columns('po_ID', 'lineNumber', 'materialCode', 'uom_code', 'plant_ID', 'orderedQuantity', 'deliveryDate')
          .where({ po_ID: { in: list.map(r => r.ID) } })
      );

      const supIds = [...new Set(list.map(r => r.supplier_ID).filter(Boolean))];
      const sups = supIds.length
        ? await run(req, SELECT.from(db.SUPPLIER_MASTER).where({ ID: { in: supIds } }))
        : [];

      list.forEach(r => {
        const sup = sups.find(s => s.ID === r.supplier_ID);
        r.supplierExtId = sup ? sup.sourceSupplierId : null;
        r.isLocked = LOCKED.includes(r.poStatus);
        r.isReady = !r.isLocked &&
          sendIssues(r, lines.filter(l => l.po_ID === r.ID), sup).length === 0;
      });
    });

    // ---------------------------------------------------------
    // PO LINES
    // ---------------------------------------------------------
    this.before('CREATE', POLines, async req => {
      const d = req.data || {};
      const poId = d.po_ID || d.poId;

      if (!poId) {
        return req.reject(400, 'Purchase Order is required for the line item');
      }
      d.po_ID = poId;
      req._poId = poId;

      await assertEditable(poId, req);

      // same Material / Service + Delivery Date + Plant / Location already on this PO
      const dup = await run(req, SELECT.one.from(db.PO_LINE).columns('ID').where({
        po_ID: poId,
        materialCode: d.materialCode,
        deliveryDate: d.deliveryDate || null,
        plant_ID: d.plant_ID || null
      }));
      if (dup) {
        return req.reject(400,
          `This line item already exists on the PO (same Material / Service, Delivery Date and Plant / Location): ${d.materialCode}, ${d.deliveryDate || 'no date'}`);
      }

      const given = d.lineNumber;
      if (given !== undefined && given !== null && given !== '') {
        const n = Number(given);
        if (!Number.isInteger(n) || n <= 0) {
          return req.reject(400, `Line number "${given}" is invalid. Use a whole number greater than 0`);
        }
        const same = await run(req,
          SELECT.one.from(db.PO_LINE).columns('ID').where({ po_ID: poId, lineNumber: n }));
        if (same) { return req.reject(400, `Line number ${n} already exists for this PO`); }
        d.lineNumber = n;
      } else {
        const row = await run(req,
          SELECT.one.from(db.PO_LINE).columns('max(lineNumber) as max').where({ po_ID: poId }));
        d.lineNumber = ((row && row.max) || 0) + 10;
      }

      fill(d, req);
    });

    this.before('UPDATE', POLines, async req => {
      const cur = await run(req, SELECT.one.from(db.PO_LINE).where({ ID: req.data.ID }));
      if (!cur) { return req.reject(404, 'PO line not found'); }

      await assertEditable(cur.po_ID, req);
      req._poId = cur.po_ID;

      const ln = req.data.lineNumber;
      if (ln !== undefined && ln !== null && Number(ln) !== Number(cur.lineNumber)) {
        const dup = await run(req,
          SELECT.one.from(db.PO_LINE).columns('ID').where({ po_ID: cur.po_ID, lineNumber: Number(ln) })
        );
        if (dup) { return req.reject(400, `Line number ${ln} already exists for this PO`); }
      }

      const m = { ...cur, ...req.data };
      fill(m, req);

      Object.assign(req.data, {
        lineValue: m.lineValue,
        taxAmount: m.taxAmount,
        openQuantity: m.openQuantity,
        openValue: m.openValue
      });
    });

    this.before('DELETE', POLines, async req => {
      const cur = await run(req, SELECT.one.from(db.PO_LINE).where({ ID: req.data.ID }));
      if (!cur) { return req.reject(404, 'PO line not found'); }

      await assertEditable(cur.po_ID, req);
      req._poId = cur.po_ID;
    });

    this.after(['CREATE', 'UPDATE'], POLines, async (d, req) => {
      await recalc(req._poId, req);
      await audit(req, 'PO_LINE', (d && d.ID) || req.data.ID, 'LINE_' + req.event, null, req.data);
    });

    this.after('DELETE', POLines, async (_, req) => {
      await recalc(req._poId, req);
      await audit(req, 'PO_LINE', req.data.ID, 'LINE_DELETE');
    });

    // ---------------------------------------------------------
    // PREVIEW -> INTERNAL_REVIEW
    // ---------------------------------------------------------

    this.on('previewPO', async req => {
      const po = await run(req, SELECT.one.from(db.PO_HEADER).where({ ID: req.data.poId }));

      if (po && po.poStatus === 'CREATED') {
        await run(req, UPDATE(db.PO_HEADER, po.ID).with({ poStatus: 'INTERNAL_REVIEW' }));
        await addHistory(req, po.ID, 'INTERNAL_REVIEW');
        await audit(req, 'PO_HEADER', po.ID, 'PO_REVIEWED');
      }
    });

    // ---------------------------------------------------------
    // SEND TO SUPPLIER
    // ---------------------------------------------------------

    this.on('sendToSupplier', async req => {
      const po = await run(req, SELECT.one.from(db.PO_HEADER).where({ ID: req.data.poId }));
      if (!po) { return req.reject(404, 'PO not found'); }

      if (!['CREATED', 'INTERNAL_REVIEW'].includes(po.poStatus)) {
        return req.reject(409, 'PO already sent');
      }

      const lines = await run(req, SELECT.from(db.PO_LINE).where({ po_ID: po.ID }));
      const sup = po.supplier_ID
        ? await run(req, SELECT.one.from(db.SUPPLIER_MASTER).where({ ID: po.supplier_ID }))
        : null;

      const issues = sendIssues(po, lines, sup);
      if (issues.length) { return req.reject(400, issues.join('; ')); }

      const at = now();
      if (po.poStatus === 'CREATED') { await addHistory(req, po.ID, 'INTERNAL_REVIEW', at); }

      await run(req, UPDATE(db.PO_HEADER, po.ID).with({
        poStatus: 'SENT_TO_SUPPLIER',
        invoicingStatus: 'OPEN',
        sentAt: at,
        versionNo: po.versionNo + 1
      }));

      await addHistory(req, po.ID, 'SENT_TO_SUPPLIER', at);

      await run(req, INSERT.into(db.PO_COMMUNICATION).entries({
        po_ID: po.ID,
        channel: 'Supplier Portal',
        sentTo: sup.poEmail,
        sentAt: at,
        transmissionStatus: 'SENT',
        sentBy: req.user.id
      }));

      await audit(req, 'PO_HEADER', po.ID, 'PO_SENT',
        { poStatus: po.poStatus }, { poStatus: 'SENT_TO_SUPPLIER' });
    });

    return super.init();
  }
};