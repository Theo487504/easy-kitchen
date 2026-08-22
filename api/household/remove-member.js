const { toVercel } = require('../../lib/adapter');
const { handler } = require('../../lib/household/remove-member');

module.exports = toVercel(handler);
