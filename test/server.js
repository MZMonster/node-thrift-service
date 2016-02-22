/**
 * Copyright (c) 2015 Meizu bigertech, All rights reserved.
 * http://www.bigertech.com/
 * @author zhangxun
 * @date  16/2/18
 * @description
 *
 */
'use strict';

const ThriftServer = require('../index').ThriftServer,
      utils        = require('../lib/util'),
      _            = require('lodash');

// test
let s = new ThriftServer({
  handler: [{
    alias : 'utils',
    handle: utils
  }, {
    alias : 'lo',
    handle: _
  }]
});

s.on('log', console.log);
s.on('error', console.error);
s.on('listening', console.log);