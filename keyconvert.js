const fs = require('fs');
const key = fs.readFileSync('./zap-shift-resources-firebase-adminsdk-fbsvc-0a75b5439c.json', 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)