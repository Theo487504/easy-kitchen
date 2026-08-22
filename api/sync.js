const { toVercel } = require('../lib/adapter');
const { handler } = require('../lib/sync');

module.exports = toVercel(handler);
