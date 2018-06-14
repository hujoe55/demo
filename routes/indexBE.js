let express = require('express');
let router = express.Router();
let formidable = require('formidable');
let fs = require('fs');
let readLine = require('readline');
let Promise = require('promise');

/* GET home page. */
router.get('/', function (req, res, next) {
    res.render('index', {title: 'demo'});
});


module.exports = router;
