const { toVercel } = require('../../lib/adapter');
const { handler } = require('../../lib/household/leave');

module.exports = toVercel(handler);
