const { toVercel } = require('../../lib/adapter');
const { handler } = require('../../lib/inventory/add');

module.exports = toVercel(handler);
