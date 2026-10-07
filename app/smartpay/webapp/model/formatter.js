sap.ui.define([], function () {
  "use strict";
  const money = (v, c, min) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: c || "USD", minimumFractionDigits: min, maximumFractionDigits: 2
  }).format(Number(v || 0));
  return {
    money2: (v, c) => money(v, c, 2),
    money0: (v, c) => money(v, c, 0),
    qty: v => v == null ? "" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(Number(v)),
    taxLabel: (sub, tax) => (Number(sub) > 0 && Number(tax) > 0)
      ? "Tax (" + (Math.round(Number(tax) / Number(sub) * 1000) / 10) + "%)" : "Tax",
    statusText: s => ({ OPEN: "Open", PARTIALLY_INVOICED: "Partially Invoiced", INVOICED: "Invoiced", CLOSED: "Closed" })[s] || s,
    statusState: s => ({ OPEN: "Information", PARTIALLY_INVOICED: "Warning", INVOICED: "Success", CLOSED: "None" })[s] || "None"
  };
});