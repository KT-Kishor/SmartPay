const cds = require('@sap/cds');
const { now, addHistory, audit, SELECT, UPDATE } = require('./lib/po-helpers');

module.exports = class ViewPOService extends cds.ApplicationService {
  init() {
    const { SupplierPOs } = this.entities;
    const { PO_HEADER } = cds.entities('smartpay');

    // Default ordering (newest first) unless the client asked for a sort.
    // poNumber is the tie-breaker so paging ($top/$skip) is stable.
    this.before('READ', SupplierPOs, req => {
      const q = req.query.SELECT;
      const aggregate = (q.columns || []).some(c => c.func);
      if (!q.orderBy && !q.groupBy && !aggregate) {
        req.query.orderBy('poDate desc', 'poNumber desc');
      }
    });

    this.on('acknowledge', async req => {
      const po = await cds.tx(req).run(SELECT.one.from(PO_HEADER).where({ ID: req.data.poId }));
      if (!po || po.supplier_ID !== (req.user.attr && req.user.attr.supplier)) {
        return req.reject(403, 'Not allowed');
      }
      if (po.poStatus !== 'SENT_TO_SUPPLIER') return;

      const at = now();
      await cds.tx(req).run(UPDATE(PO_HEADER, po.ID).with({ poStatus: 'ACKNOWLEDGED', acknowledgedAt: at }));
      await addHistory(req, po.ID, 'ACKNOWLEDGED', at);
      await audit(req, 'PO_HEADER', po.ID, 'PO_ACKNOWLEDGED', null, null, at);
    });

    return super.init();
  }
};