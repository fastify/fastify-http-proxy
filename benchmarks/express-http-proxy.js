'use strict'

var proxy = require('express-http-proxy')
var app = require('express')()

app.use('/', proxy('localhost:3001'))

app.listen(3000)
