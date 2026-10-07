const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;   // same cds instance as the service (not the global SELECT)

const now = () => new Date().toISOString();
const db = () => cds.entities('smartpay');   // resolved lazily: the model is loaded after this module

const addHistory = (req, poId, statusCode, at = now()) =>
  cds.tx(req).run(
    INSERT.into(db().PO_STATUS_HISTORY).entries({ po_ID: poId, statusCode, statusAt: at })
  );

const audit = (req, entityType, entityId, eventType, before, after, at = now()) =>
  cds.tx(req).run(
    INSERT.into(db().AUDIT_EVENT).entries({
      eventTime: at,
      entityType,
      entityId,
      eventType,
      actorType: 'USER',
      actorId: req.user.id,
      beforeJson: JSON.stringify(before || null),
      afterJson: JSON.stringify(after || null)
    })
  );

module.exports = { now, addHistory, audit, SELECT, INSERT, UPDATE };