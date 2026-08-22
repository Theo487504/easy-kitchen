const { toVercel } = require('../../lib/adapter');
const { handler } = require('../../lib/shopping/add');

module.exports = toVercel(handler);
