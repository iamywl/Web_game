// Local browser fixture only; production server does not expose the test folder.
const express = require('express');
const path = require('path');
const app = express();
app.use('/test', express.static(__dirname));
app.use(express.static(path.join(__dirname, '../public')));
app.listen(4175, '127.0.0.1', () => console.log('http://127.0.0.1:4175/test/garen_animation.html'));
