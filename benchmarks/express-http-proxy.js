'use strict'

const proxy = require('express-http-proxy')
const app = require('express')()

app.use('/', proxy('localhost:3001'))

app.listen(3000)
