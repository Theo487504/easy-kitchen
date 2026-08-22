const { toVercel } = require('../../lib/adapter');
const { handler } = require('../../lib/household/join');

module.exports = toVercel(handler);
