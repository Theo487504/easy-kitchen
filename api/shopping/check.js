const { toVercel } = require('../../lib/adapter');
const { handler } = require('../../lib/shopping/check');

module.exports = toVercel(handler);
