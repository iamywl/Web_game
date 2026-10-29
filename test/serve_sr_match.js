// Isolated port; unmodified production game and normal lobby/draft flow.
process.env.PORT = '4178';
require('../server/server');
