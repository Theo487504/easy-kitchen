const { toVercel } = require('../../lib/adapter');
const { handler } = require('../../lib/household/create');

module.exports = toVercel(handler);
