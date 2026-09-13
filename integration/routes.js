const fs = require('fs');
const path = require('path');
const express = require('express');

module.exports = function mountBlueprint(app, upload) {
  const example = path.join(__dirname, '../vendor/blueprint3d/example');
  // The shipped application remains upstream; only the input bridge is injected.
  app.get(['/blueprint3d/', '/blueprint3d/index.html'], (req, res) => {
    res.type('html').send(fs.readFileSync(path.join(example, 'index.html'), 'utf8')
      .replace('<script src="js/example.js"></script>', '<script src="/native-cad-properties.js"></script><script src="/blueprint-bridge.js"></script>\n    <script src="js/example.js"></script>'));
  });
  app.use('/blueprint3d', express.static(example));
  const receiveFile = (req, res, next) => upload.single('file')(req, res, error => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Upload inválido. Envie um único CAD de até 50 MB.' });
    next();
  });
  require('./jobs')(app, receiveFile, { config: () => {
    const humanizer = require('../humanizer');
    return { url: humanizer.nineRouterUrl, key: humanizer.nineRouterKey };
  } });
};
